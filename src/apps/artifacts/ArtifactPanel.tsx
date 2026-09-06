import { useCallback, useMemo, useRef, useState } from 'react'
import {
  Eye, Pencil, Copy, Trash2, FileText, Check, X, Download, History, Save, Plus, RotateCcw, LayoutTemplate, Share2, Link2,
  MessageSquare, RefreshCw, Crosshair, ChevronLeft, ChevronRight, ChevronDown,
} from 'lucide-react'
import { useArtifactStore } from '../../stores/artifactStore'
import { useAuthStore } from '../../stores/authStore'
import { useNotificationStore } from '../../stores/notificationStore'
import { renderMarkdown } from '../../lib/markdown'
import { copyText } from '../../lib/clipboard'
import { exportDoc, type ExportFormat } from '../../lib/exporters'
import { buildShareUrl, type ShareAnnotation, type ShareSnapshot } from '../../lib/share'
import { getApiBase, apiJson } from '../../lib/api'
import { listTemplates } from '../../harness/scripts/artifacts'
import { cn } from '../../lib/cn'

const KIND_LABEL: Record<string, string> = {
  lessonPlan: '教案',
  report: '报告',
  notice: '通知',
  analysis: '分析',
  generic: '文档',
}

const EXPORT_ITEMS: { format: ExportFormat; label: string; hint: string }[] = [
  { format: 'md', label: 'Markdown', hint: '.md 源文件' },
  { format: 'docx', label: 'Word 文档', hint: '.doc 兼容格式' },
  { format: 'pdf', label: 'PDF', hint: '浏览器打印导出' },
]

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function ArtifactPanel() {
  const role = useAuthStore((s) => s.role)
  const { docs, revisions, shareRefs, setShareRef, activeId, setActive, updateContent, remove, createManual, saveRevision, restoreRevision, removeRevision } =
    useArtifactStore()
  const doc = docs.find((d) => d.id === activeId)
  const [editing, setEditing] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle')
  const [exportOpen, setExportOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  // 文档清单下拉（v0.8.1）：多文档间快速跳转，无需经侧栏/抽屉
  const [listOpen, setListOpen] = useState(false)
  // 分享弹层（v0.4 M2①）：生成只读快照链接
  const [shareOpen, setShareOpen] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const [shareState, setShareState] = useState<'idle' | 'generating' | 'ready' | 'too-long' | 'fail'>('idle')
  const [shareCopied, setShareCopied] = useState(false)
  const [shareMode, setShareMode] = useState<'short' | 'inline'>('inline')
  // 收到的批注（v0.5 M2②）：短链登记后从轻后端拉取评审回传
  const [annoList, setAnnoList] = useState<ShareAnnotation[]>([])
  const [annoLoading, setAnnoLoading] = useState(false)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const html = useMemo(() => (doc ? renderMarkdown(doc.content) : ''), [doc?.content])
  const docRevisions = doc ? revisions[doc.id] ?? [] : []
  const templates = role ? listTemplates(role) : []

  /* 多文档切换（v0.8.1）：专注模式批量生成后逐份查看，上一份/下一份 + 清单直达 */
  const docIndex = docs.findIndex((d) => d.id === activeId)
  const stepDoc = (dir: -1 | 1) => {
    if (docIndex < 0) return
    const next = docs[docIndex + dir]
    if (next) setActive(next.id)
  }
  const titleCluster = (
    <>
      <FileText size={15} className="shrink-0 text-ink-mute" />
      <h2 className="truncate text-sm font-semibold">{doc?.title ?? '文档工作区'}</h2>
      {doc && (
        <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-[0.625rem] font-medium text-primary">
          {KIND_LABEL[doc.kind] ?? '文档'}
        </span>
      )}
    </>
  )

  const copy = async () => {
    if (!doc) return
    const ok = await copyText(doc.content)
    setCopyState(ok ? 'ok' : 'fail')
    window.setTimeout(() => setCopyState('idle'), 1500)
  }

  const doExport = (format: ExportFormat) => {
    if (doc?.content) exportDoc(doc.content, doc.title, format)
    setExportOpen(false)
  }

  /* 拉取收到的批注（v0.5 M2②）：短链登记后从轻后端读取评审回传；新批注进通知中心 */
  const fetchAnnotations = useCallback(async () => {
    if (!doc) return
    const ref = useArtifactStore.getState().shareRefs[doc.id]
    if (!ref) return
    setAnnoLoading(true)
    try {
      const j = await apiJson<{ snapshot: ShareSnapshot; annotations: ShareAnnotation[] }>(
        ref.apiBase,
        `/v1/share/${encodeURIComponent(ref.id)}`,
      )
      const list = j.annotations ?? []
      setAnnoList(list)
      const seen = ref.seenAnnotations ?? 0
      if (list.length > seen) {
        useNotificationStore.getState().push({
          kind: 'annotation',
          title: `《${doc.title}》收到 ${list.length - seen} 条新批注`,
          body: list[list.length - 1]?.text.slice(0, 60) ?? '',
          docId: doc.id,
        })
        useArtifactStore.getState().setShareRef(doc.id, { ...ref, seenAnnotations: list.length })
      }
    } catch {
      /* 服务不可用：保留上次结果，不打断 */
    } finally {
      setAnnoLoading(false)
    }
  }, [doc])

  /* 批注定位（v0.5 M2②）：切到编辑器并滚动选中引用片段 */
  const locateInEditor = (quote: string) => {
    if (!doc) return
    setEditing(true)
    window.setTimeout(() => {
      const el = editorRef.current
      if (!el) return
      const idx = quote ? doc.content.indexOf(quote) : -1
      if (idx >= 0) {
        const line = doc.content.slice(0, idx).split('\n').length
        el.scrollTop = Math.max(0, (line - 3) * 21)
        el.focus()
        el.setSelectionRange(idx, idx + quote.length)
      } else {
        el.focus()
      }
    }, 60)
  }

  /* 生成分享链接（v0.4 M2① → v0.5 M2① 短链优先）：快照存轻后端，接收方免登录只读查看 */
  const openShare = async () => {
    if (!doc?.content) return
    setShareOpen(true)
    setShareState('generating')
    setShareCopied(false)
    const hadRef = !!shareRefs[doc.id]
    const apiBase = getApiBase()
    const res = await buildShareUrl(
      {
        v: 1,
        title: doc.title,
        kind: doc.kind,
        role: doc.role,
        content: doc.content,
        createdAt: doc.createdAt,
        author: role ? { bureau: '教育局', schoolAdmin: '校长', teacher: '教师' }[role] : undefined,
      },
      { apiBase },
    )
    if (res.ok) {
      setShareUrl(res.url)
      setShareMode(res.mode)
      setShareState('ready')
      if (res.mode === 'short' && res.shareId && apiBase) {
        setShareRef(doc.id, {
          id: res.shareId,
          apiBase,
          sharedAt: Date.now(),
          seenAnnotations: shareRefs[doc.id]?.seenAnnotations ?? 0,
        })
      }
      if (hadRef) void fetchAnnotations()
    } else {
      setShareState(res.reason === 'too-long' ? 'too-long' : 'fail')
    }
  }

  const copyShareUrl = async () => {
    const ok = await copyText(shareUrl)
    setShareCopied(ok)
    window.setTimeout(() => setShareCopied(false), 1800)
  }

  return (
    <div className="relative flex h-full w-full flex-col">
      {/* 头部 */}
      <header className="relative flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-1.5">
          {/* 上一份/下一份（v0.8.1）：多文档时显示，边界禁用 */}
          {docs.length > 1 && (
            <>
              <button
                onClick={() => stepDoc(-1)}
                disabled={docIndex <= 0}
                data-testid="doc-switch-prev"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-30"
                title="上一份文档"
                aria-label="上一份文档"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => stepDoc(1)}
                disabled={docIndex < 0 || docIndex >= docs.length - 1}
                data-testid="doc-switch-next"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-30"
                title="下一份文档"
                aria-label="下一份文档"
              >
                <ChevronRight size={14} />
              </button>
              <span className="minor-info shrink-0 text-[0.625rem] tabular-nums text-ink-mute">
                {docIndex >= 0 ? docIndex + 1 : '–'}/{docs.length}
              </span>
            </>
          )}
          {/* 标题区（v0.8.1）：多文档时点击展开全部文档清单，单文档保持纯展示 */}
          {docs.length > 1 ? (
            <button
              onClick={() => setListOpen((v) => !v)}
              data-testid="doc-list-btn"
              aria-expanded={listOpen}
              className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-surface-2"
              title="查看全部文档"
              aria-label="查看全部文档"
            >
              {titleCluster}
              <ChevronDown size={12} className={cn('shrink-0 text-ink-mute transition-transform', listOpen && 'rotate-180')} />
            </button>
          ) : (
            <div className="flex min-w-0 items-center gap-2">{titleCluster}</div>
          )}
        </div>
        {doc && (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              onClick={() => setEditing(!editing)}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                editing ? 'bg-primary-soft text-primary' : 'text-ink-mute hover:bg-surface-2 hover:text-ink',
              )}
              title={editing ? '切换预览' : '切换编辑'}
              aria-label={editing ? '切换预览' : '切换编辑'}
            >
              {editing ? <Eye size={15} /> : <Pencil size={15} />}
            </button>
            <button
              onClick={copy}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                copyState === 'fail' ? 'text-danger' : 'text-ink-mute hover:bg-surface-2 hover:text-ink',
              )}
              title={copyState === 'fail' ? '复制失败，请手动选择文本复制' : '复制全文'}
              aria-label="复制全文"
            >
              {copyState === 'ok' ? <Check size={15} className="text-mint" /> : copyState === 'fail' ? <X size={15} /> : <Copy size={15} />}
            </button>

            {/* 分享（v0.4 M2①）：只读快照链接 */}
            <button
              onClick={() => void openShare()}
              disabled={!doc.content}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40"
              title="生成分享链接"
              aria-label="生成分享链接"
            >
              <Share2 size={15} />
            </button>

            {/* 导出菜单 */}
            <div className="relative">
              <button
                onClick={() => setExportOpen((v) => !v)}
                disabled={!doc.content}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40"
                title="导出文档"
                aria-label="导出文档"
              >
                <Download size={15} />
              </button>
              {exportOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
                  <div className="animate-fade-up absolute right-0 top-9 z-20 w-44 overflow-hidden rounded-2xl border border-line bg-surface shadow-xl">
                    {EXPORT_ITEMS.map((item) => (
                      <button
                        key={item.format}
                        onClick={() => doExport(item.format)}
                        className="flex w-full items-center justify-between px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
                      >
                        <span className="text-xs font-medium text-ink">{item.label}</span>
                        <span className="minor-info text-[0.625rem] text-ink-mute">{item.hint}</span>
                      </button>
                    ))}
                    {/* 导出附注（v0.9 M3③）：不强制写页脚，水印仍由用户配置 */}
                    <p className="border-t border-line px-3 py-2 text-[0.625rem] leading-relaxed text-ink-mute">
                      导出内容含 AI 生成部分，请复核后使用
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* 版本历史 */}
            <button
              onClick={() => setHistoryOpen(true)}
              className="relative flex h-8 w-8 items-center justify-center rounded-lg text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink"
              title="版本历史"
              aria-label="版本历史"
            >
              <History size={15} />
              {docRevisions.length > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[0.5625rem] font-medium text-white">
                  {docRevisions.length}
                </span>
              )}
            </button>

            <button
              onClick={() => remove(doc.id)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-mute transition-colors hover:bg-danger/10 hover:text-danger"
              title="删除文档"
              aria-label="删除文档"
            >
              <Trash2 size={15} />
            </button>
          </div>
        )}

        {/* 文档清单下拉（v0.8.1）：列出全部文档直达切换，生成中的文档有标注 */}
        {listOpen && docs.length > 1 && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setListOpen(false)} />
            <div
              data-testid="doc-list-panel"
              className="animate-fade-up absolute left-3 top-[calc(100%+4px)] z-20 max-h-80 w-72 overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-xl"
            >
              <p className="px-2.5 pb-1 pt-2 text-[0.625rem] font-semibold text-ink-mute">全部文档（{docs.length}）</p>
              {docs.map((d) => {
                const active = d.id === activeId
                return (
                  <button
                    key={d.id}
                    onClick={() => {
                      setActive(d.id)
                      setListOpen(false)
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors',
                      active ? 'bg-primary-soft' : 'hover:bg-surface-2',
                    )}
                  >
                    <FileText size={13} className={cn('shrink-0', active ? 'text-primary' : 'text-ink-mute')} />
                    <div className="min-w-0 flex-1">
                      <p className={cn('truncate text-xs font-medium', active && 'text-primary')}>{d.title}</p>
                      <p className="minor-info mt-0.5 text-[0.625rem] text-ink-mute">
                        {KIND_LABEL[d.kind] ?? '文档'} · {fmtTime(d.createdAt)}
                        {!d.content && ' · 生成中'}
                      </p>
                    </div>
                    {active && <Check size={12} className="shrink-0 text-primary" />}
                  </button>
                )
              })}
            </div>
          </>
        )}
      </header>

      {/* 内容 */}
      {!doc ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-surface-2 text-ink-mute">
            <LayoutTemplate size={24} />
          </div>
          <p className="mt-4 text-sm font-medium">从模板开始，或等 Agent 生成</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-mute">
            Agent 生成的教案、报告、通知会自动出现在这里
          </p>
          <div className="mt-5 grid w-full max-w-xs gap-2">
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => role && createManual(role, t.id)}
                className="group flex items-center justify-between rounded-2xl border border-line bg-surface-2 px-4 py-3 text-left transition-all hover:border-primary/50 hover:bg-primary-soft"
              >
                <span>
                  <span className="block text-xs font-semibold text-ink group-hover:text-primary">{t.name}</span>
                  <span className="mt-0.5 block text-[0.625rem] text-ink-mute">{t.desc}</span>
                </span>
                <Plus size={14} className="shrink-0 text-ink-mute group-hover:text-primary" />
              </button>
            ))}
            <button
              onClick={() => role && createManual(role)}
              className="rounded-2xl border border-dashed border-line px-4 py-2.5 text-xs font-medium text-ink-soft transition-colors hover:border-primary/50 hover:text-primary"
              data-testid="new-doc-btn"
            >
              空白文档
            </button>
          </div>
        </div>
      ) : editing ? (
        <textarea
          ref={editorRef}
          value={doc.content}
          onChange={(e) => updateContent(doc.id, e.target.value)}
          spellCheck={false}
          className="doc-editor min-h-0 flex-1 resize-none bg-surface-2 p-4 font-mono leading-relaxed outline-none"
        />
      ) : (
        <div
          className="md-body min-h-0 flex-1 overflow-y-auto px-5 py-4"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}

      {/* 底部元信息（超大字号档隐藏） */}
      {doc && (
        <footer className="minor-info flex items-center justify-between border-t border-line px-4 py-2 text-[0.625rem] text-ink-mute">
          <span>{doc.source === 'agent' ? 'Agent 生成' : doc.source === 'manual' ? '手动创建' : '简报采纳'}</span>
          <span>{doc.content.length} 字 · 可编辑 / 导出</span>
        </footer>
      )}

      {/* 分享弹层（v0.4 M2①） */}
      {shareOpen && doc && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink/30 p-4 backdrop-blur-sm" onClick={() => setShareOpen(false)}>
          <div
            className="animate-fade-up w-full max-w-sm rounded-3xl border border-line bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Share2 size={14} className="text-primary" />
                分享文档
              </h3>
              <button
                onClick={() => setShareOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink"
                aria-label="关闭"
              >
                <X size={14} />
              </button>
            </div>

            {shareState === 'generating' && <p className="mt-4 text-xs text-ink-mute">正在生成分享链接…</p>}

            {shareState === 'ready' && (
              <>
                <p className="mt-3 text-xs leading-relaxed text-ink-soft">
                  {shareMode === 'short'
                    ? '短链模式：内容已存到轻后端，链接短且不受长度限制；评审人在分享页添加的批注会回传到下方。'
                    : '链接包含文档只读快照，接收方无需登录即可查看；校长/局角色可在分享页添加批注后回传。'}
                </p>
                <div className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2">
                  <Link2 size={13} className="shrink-0 text-ink-mute" />
                  <input
                    readOnly
                    value={shareUrl}
                    onFocus={(e) => e.target.select()}
                    className="min-w-0 flex-1 bg-transparent text-[0.6875rem] text-ink-soft outline-none"
                    aria-label="分享链接"
                  />
                </div>
                <button
                  onClick={copyShareUrl}
                  className={cn(
                    'mt-3 flex w-full items-center justify-center gap-1.5 rounded-full py-2.5 text-xs font-medium transition-all active:scale-[0.98]',
                    shareCopied ? 'bg-mint-soft text-mint' : 'bg-primary text-white hover:bg-primary-deep',
                  )}
                >
                  {shareCopied ? <Check size={13} /> : <Link2 size={13} />}
                  {shareCopied ? '已复制到剪贴板' : '复制链接'}
                </button>

                {/* 收到的批注（v0.5 M2②）：短链登记后可拉取评审回传并定位 */}
                {shareRefs[doc.id] && (
                  <div className="mt-4 rounded-2xl border border-line bg-surface-2 px-3 py-3">
                    <div className="flex items-center justify-between">
                      <p className="flex items-center gap-1.5 text-[0.6875rem] font-semibold text-ink">
                        <MessageSquare size={12} className="text-primary" />
                        收到的批注
                        <span className="font-normal text-ink-mute">（{annoList.length}）</span>
                      </p>
                      <button
                        onClick={() => void fetchAnnotations()}
                        disabled={annoLoading}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[0.625rem] text-primary transition-colors hover:bg-primary-soft disabled:opacity-40"
                      >
                        <RefreshCw size={10} className={cn(annoLoading && 'animate-spin')} />
                        刷新
                      </button>
                    </div>
                    {annoLoading ? (
                      <p className="mt-2 text-[0.625rem] text-ink-mute">正在拉取批注…</p>
                    ) : annoList.length === 0 ? (
                      <p className="mt-2 text-[0.625rem] leading-relaxed text-ink-mute">
                        暂无批注。评审人在分享页添加批注后会回传到这里，点击「刷新」即可查看。
                      </p>
                    ) : (
                      <ul className="mt-2 max-h-44 space-y-1.5 overflow-y-auto">
                        {annoList.map((a) => (
                          <li key={a.id} className="rounded-xl bg-surface px-2.5 py-2">
                            <p className="text-[0.625rem] text-ink-mute">
                              {a.author} · {fmtTime(a.createdAt)}
                            </p>
                            {a.quote && <p className="mt-0.5 truncate text-[0.625rem] text-ink-soft">「{a.quote}」</p>}
                            <div className="mt-0.5 flex items-start justify-between gap-2">
                              <p className="text-[0.6875rem] leading-relaxed text-ink">{a.text}</p>
                              <button
                                onClick={() => locateInEditor(a.quote)}
                                className="inline-flex shrink-0 items-center gap-0.5 text-[0.625rem] text-primary hover:underline"
                                title="跳到编辑器对应位置"
                              >
                                <Crosshair size={10} />
                                定位
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}

            {shareState === 'too-long' && (
              <div className="mt-4 rounded-2xl bg-amber-soft px-4 py-3">
                <p className="text-xs font-medium text-ink">文档过长，无法生成链接</p>
                <p className="mt-1 text-[0.6875rem] leading-relaxed text-ink-soft">
                  分享链接有长度限制，建议改用「导出 Word / PDF」后通过文件分享。
                </p>
              </div>
            )}

            {shareState === 'fail' && (
              <p className="mt-4 rounded-2xl bg-coral-soft px-4 py-3 text-xs text-coral">链接生成失败，请重试或改用导出文件分享。</p>
            )}
          </div>
        </div>
      )}

      {/* 版本历史抽屉 */}
      {historyOpen && doc && (
        <div className="absolute inset-0 z-30 flex flex-col bg-surface/95 backdrop-blur-sm" onClick={() => setHistoryOpen(false)}>
          <div
            className="animate-fade-up flex min-h-0 flex-1 flex-col border-l border-line bg-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="flex items-center gap-2">
                <History size={14} className="text-primary" />
                <h3 className="text-sm font-semibold text-ink">版本历史</h3>
                <span className="text-[0.625rem] text-ink-mute">{docRevisions.length}/20</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => saveRevision(doc.id)}
                  disabled={!doc.content}
                  className="inline-flex items-center gap-1 rounded-lg bg-primary-soft px-2.5 py-1.5 text-[0.6875rem] font-medium text-primary transition-colors hover:bg-primary/15 disabled:opacity-40"
                >
                  <Save size={11} />
                  保存当前版本
                </button>
                <button
                  onClick={() => setHistoryOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink"
                  aria-label="关闭"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {docRevisions.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-ink-mute">
                  暂无历史版本。生成完成、手动保存或大幅修改时会自动记录快照。
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {[...docRevisions].reverse().map((rev, idx) => (
                    <li
                      key={rev.id}
                      className="flex items-center justify-between rounded-xl border border-line bg-surface-2 px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-xs font-medium text-ink">
                          {rev.label}
                          {idx === 0 && (
                            <span className="rounded-full bg-mint/15 px-1.5 py-0.5 text-[0.5625rem] font-medium text-mint">最新</span>
                          )}
                        </p>
                        <p className="minor-info mt-0.5 text-[0.625rem] text-ink-mute">
                          {fmtTime(rev.createdAt)} · {rev.content.length} 字
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => restoreRevision(doc.id, rev.id)}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[0.6875rem] text-primary transition-colors hover:bg-primary-soft"
                          title="恢复此版本（当前内容会先自动保存）"
                        >
                          <RotateCcw size={11} />
                          恢复
                        </button>
                        <button
                          onClick={() => removeRevision(doc.id, rev.id)}
                          className="flex h-6 w-6 items-center justify-center rounded-lg text-ink-mute transition-colors hover:bg-danger/10 hover:text-danger"
                          aria-label="删除此版本"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
