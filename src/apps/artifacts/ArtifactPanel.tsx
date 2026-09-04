import { useMemo, useState } from 'react'
import {
  Eye, Pencil, Copy, Trash2, FileText, Check, X, Download, History, Save, Plus, RotateCcw, LayoutTemplate,
} from 'lucide-react'
import { useArtifactStore } from '../../stores/artifactStore'
import { useAuthStore } from '../../stores/authStore'
import { renderMarkdown } from '../../lib/markdown'
import { copyText } from '../../lib/clipboard'
import { exportDoc, type ExportFormat } from '../../lib/exporters'
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
  const { docs, revisions, activeId, updateContent, remove, createManual, saveRevision, restoreRevision, removeRevision } =
    useArtifactStore()
  const doc = docs.find((d) => d.id === activeId)
  const [editing, setEditing] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle')
  const [exportOpen, setExportOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const html = useMemo(() => (doc ? renderMarkdown(doc.content) : ''), [doc?.content])
  const docRevisions = doc ? revisions[doc.id] ?? [] : []
  const templates = role ? listTemplates(role) : []

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

  return (
    <div className="relative flex h-full w-full flex-col">
      {/* 头部 */}
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileText size={15} className="shrink-0 text-ink-mute" />
          <h2 className="truncate text-sm font-semibold">{doc?.title ?? '文档工作区'}</h2>
          {doc && (
            <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-medium text-primary">
              {KIND_LABEL[doc.kind] ?? '文档'}
            </span>
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
                        <span className="minor-info text-[10px] text-ink-mute">{item.hint}</span>
                      </button>
                    ))}
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
                <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-medium text-white">
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
                  <span className="mt-0.5 block text-[10px] text-ink-mute">{t.desc}</span>
                </span>
                <Plus size={14} className="shrink-0 text-ink-mute group-hover:text-primary" />
              </button>
            ))}
            <button
              onClick={() => role && createManual(role)}
              className="rounded-2xl border border-dashed border-line px-4 py-2.5 text-xs font-medium text-ink-soft transition-colors hover:border-primary/50 hover:text-primary"
            >
              空白文档
            </button>
          </div>
        </div>
      ) : editing ? (
        <textarea
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
        <footer className="minor-info flex items-center justify-between border-t border-line px-4 py-2 text-[10px] text-ink-mute">
          <span>{doc.source === 'agent' ? 'Agent 生成' : doc.source === 'manual' ? '手动创建' : '简报采纳'}</span>
          <span>{doc.content.length} 字 · 可编辑 / 导出</span>
        </footer>
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
                <span className="text-[10px] text-ink-mute">{docRevisions.length}/20</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => saveRevision(doc.id)}
                  disabled={!doc.content}
                  className="inline-flex items-center gap-1 rounded-lg bg-primary-soft px-2.5 py-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15 disabled:opacity-40"
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
                            <span className="rounded-full bg-mint/15 px-1.5 py-0.5 text-[9px] font-medium text-mint">最新</span>
                          )}
                        </p>
                        <p className="minor-info mt-0.5 text-[10px] text-ink-mute">
                          {fmtTime(rev.createdAt)} · {rev.content.length} 字
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => restoreRevision(doc.id, rev.id)}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-primary transition-colors hover:bg-primary-soft"
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
