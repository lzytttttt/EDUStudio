import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FileText, Link2, Check, X, Download, MessageSquarePlus, MessageSquare, Trash2, Users, AlertCircle, Copy,
} from 'lucide-react'
import { renderMarkdown } from '../../lib/markdown'
import { exportDoc } from '../../lib/exporters'
import { copyText } from '../../lib/clipboard'
import {
  buildShareUrl, parseShareUrl, snapshotKey, newAnnotationId,
  decodeShortPayload, pushShareAnnotations,
  type ShareAnnotation, type ShareSnapshot,
} from '../../lib/share'
import { loadJSON, saveJSON } from '../../lib/storage'
import { cn } from '../../lib/cn'

const KIND_LABEL: Record<string, string> = {
  lessonPlan: '教案',
  report: '报告',
  notice: '通知',
  analysis: '分析',
  generic: '文档',
}

const ROLE_LABEL: Record<string, string> = {
  bureau: '教育局',
  schoolAdmin: '校长',
  teacher: '教师',
  guest: '访客',
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 批注本地持久化 key（同一浏览器再次打开恢复） */
function annoStorageKey(key: string): string {
  return `share-anno-${key}`
}

export default function ShareView() {
  const [snapshot, setSnapshot] = useState<ShareSnapshot | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'invalid'>('loading')
  const [annotations, setAnnotations] = useState<ShareAnnotation[]>([])
  const [linkState, setLinkState] = useState<'idle' | 'ok' | 'fail'>('idle')
  const [annoLinkState, setAnnoLinkState] = useState<'idle' | 'ok' | 'fail' | 'too-long'>('idle')
  // 短链模式（v0.5 M2②）：批注可回传到轻后端，作者端刷新即可看到
  const [serverRef, setServerRef] = useState<{ id: string; apiBase: string } | null>(null)
  const [syncState, setSyncState] = useState<'local' | 'syncing' | 'synced' | 'fail'>('local')

  // 批注表单
  const [formOpen, setFormOpen] = useState(false)
  const [formQuote, setFormQuote] = useState('')
  const [formText, setFormText] = useState('')
  const [formAuthor, setFormAuthor] = useState('')

  // 选区浮动按钮
  const [selBtn, setSelBtn] = useState<{ x: number; y: number } | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  /* 解析分享链接 */
  useEffect(() => {
    let cancelled = false
    parseShareUrl(location.hash).then((snap) => {
      if (cancelled) return
      if (!snap) {
        setStatus('invalid')
        return
      }
      setSnapshot(snap)
      const key = snapshotKey(snap)
      setAnnotations(loadJSON<ShareAnnotation[]>(annoStorageKey(key), snap.annotations ?? []))
      // 短链模式：记录服务端登记，批注可回传给作者（v0.5 M2②）
      if (location.hash.startsWith('#s=')) {
        setServerRef(decodeShortPayload(location.hash.slice('#s='.length)))
      }
      setStatus('ready')
    })
    return () => {
      cancelled = true
    }
  }, [])

  const html = useMemo(() => (snapshot ? renderMarkdown(snapshot.content) : ''), [snapshot?.content])

  /* 批注变更 → 本地持久化 */
  const persistAnnotations = useCallback(
    (next: ShareAnnotation[]) => {
      setAnnotations(next)
      if (snapshot) saveJSON(annoStorageKey(snapshotKey(snapshot)), next)
    },
    [snapshot],
  )

  /* 选中文本 → 浮动「添加批注」按钮 */
  useEffect(() => {
    if (status !== 'ready') return
    const onSelectionChange = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || !bodyRef.current) {
        setSelBtn(null)
        return
      }
      const node = sel.anchorNode
      if (!node || !bodyRef.current.contains(node)) {
        setSelBtn(null)
        return
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      if (!rect.width && !rect.height) {
        setSelBtn(null)
        return
      }
      setSelBtn({ x: rect.left + rect.width / 2, y: rect.top - 8 })
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [status])

  const openForm = () => {
    const sel = window.getSelection()
    const quote = sel?.toString().trim() ?? ''
    if (!quote) return
    setFormQuote(quote.slice(0, 120))
    setFormText('')
    setFormOpen(true)
    setSelBtn(null)
    sel?.removeAllRanges()
  }

  const submitAnnotation = () => {
    const text = formText.trim()
    if (!text) return
    const anno: ShareAnnotation = {
      id: newAnnotationId(),
      author: formAuthor.trim() || '评审人',
      role: 'guest',
      quote: formQuote,
      text,
      createdAt: Date.now(),
    }
    const next = [...annotations, anno]
    persistAnnotations(next)
    setFormOpen(false)
    // 短链模式：批注回传服务端，作者端刷新即可看到（v0.5 M2②）；失败不丢数据（本地已存）
    if (serverRef) {
      setSyncState('syncing')
      void pushShareAnnotations(serverRef.apiBase, serverRef.id, next).then((ok) => {
        setSyncState(ok ? 'synced' : 'fail')
        window.setTimeout(() => setSyncState('local'), 3000)
      })
    }
  }

  /* 复制原始分享链接 */
  const copyLink = async () => {
    if (!snapshot) return
    const res = await buildShareUrl(snapshot)
    if (!res.ok) {
      setLinkState('fail')
      window.setTimeout(() => setLinkState('idle'), 1800)
      return
    }
    const ok = await copyText(res.url)
    setLinkState(ok ? 'ok' : 'fail')
    window.setTimeout(() => setLinkState('idle'), 1800)
  }

  /* 复制带批注的链接（批注回传链路） */
  const copyAnnotatedLink = async () => {
    if (!snapshot || annotations.length === 0) return
    const res = await buildShareUrl({ ...snapshot, annotations })
    if (!res.ok) {
      setAnnoLinkState(res.reason === 'too-long' ? 'too-long' : 'fail')
      window.setTimeout(() => setAnnoLinkState('idle'), 2400)
      return
    }
    const ok = await copyText(res.url)
    setAnnoLinkState(ok ? 'ok' : 'fail')
    window.setTimeout(() => setAnnoLinkState('idle'), 1800)
  }

  if (status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center bg-bg">
        <p className="text-sm text-ink-mute">正在解析分享内容…</p>
      </div>
    )
  }

  if (status === 'invalid' || !snapshot) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-bg px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-coral-soft text-coral">
          <AlertCircle size={26} />
        </div>
        <p className="mt-4 text-sm font-semibold">链接无效或已损坏</p>
        <p className="mt-1 max-w-xs text-xs leading-relaxed text-ink-mute">
          分享内容可能被截断或格式不受支持。请让分享者重新生成链接，或改用导出文件分享。
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-bg">
      {/* 顶栏 */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <FileText size={15} />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-ink">{snapshot.title}</h1>
            <p className="minor-info truncate text-[0.625rem] text-ink-mute">
              {snapshot.author ? `${snapshot.author} · ` : ''}
              {fmtTime(snapshot.createdAt)} · 只读分享
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-[0.625rem] font-medium text-primary">
            {KIND_LABEL[snapshot.kind] ?? '文档'}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={copyLink}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all active:scale-95',
              linkState === 'ok'
                ? 'bg-mint-soft text-mint'
                : linkState === 'fail'
                  ? 'bg-coral-soft text-coral'
                  : 'bg-surface-2 text-ink-soft hover:bg-surface-2/70 hover:text-ink',
            )}
            title="复制分享链接"
          >
            {linkState === 'ok' ? <Check size={13} /> : linkState === 'fail' ? <X size={13} /> : <Link2 size={13} />}
            {linkState === 'ok' ? '已复制' : linkState === 'fail' ? '失败' : '复制链接'}
          </button>
          <button
            onClick={() => exportDoc(snapshot.content, snapshot.title, 'docx', { annotations })}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink"
            title="导出 Word（含批注）"
            aria-label="导出 Word"
          >
            <Download size={15} />
          </button>
          <button
            onClick={() => exportDoc(snapshot.content, snapshot.title, 'pdf', { annotations })}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink"
            title="打印 / 导出 PDF"
            aria-label="打印导出"
          >
            <Copy size={15} />
          </button>
        </div>
      </header>

      {/* 正文 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-5 py-6">
          <div ref={bodyRef} className="md-body rounded-3xl border border-line bg-surface px-6 py-5 shadow-soft" data-testid="share-body">
            <div dangerouslySetInnerHTML={{ __html: html }} />
          </div>

          {/* 评审批注区 */}
          <section className="mt-5 rounded-3xl border border-line bg-surface px-6 py-5 shadow-soft">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <MessageSquare size={14} className="text-primary" />
                评审批注
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[0.625rem] font-medium text-ink-mute">
                  {annotations.length}
                </span>
                {serverRef && syncState !== 'local' && (
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[0.625rem] font-medium',
                      syncState === 'synced'
                        ? 'bg-mint-soft text-mint'
                        : syncState === 'fail'
                          ? 'bg-coral-soft text-coral'
                          : 'bg-surface-2 text-ink-mute',
                    )}
                  >
                    {syncState === 'synced' ? '已同步给作者' : syncState === 'fail' ? '同步失败（本地已保存）' : '同步中…'}
                  </span>
                )}
              </h2>
              {annotations.length > 0 && (
                <button
                  onClick={copyAnnotatedLink}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.6875rem] font-medium transition-all active:scale-95',
                    annoLinkState === 'ok'
                      ? 'bg-mint-soft text-mint'
                      : annoLinkState === 'fail'
                        ? 'bg-coral-soft text-coral'
                        : 'bg-primary-soft text-primary hover:bg-primary/15',
                  )}
                  title="复制包含批注的分享链接，发回给作者即可同步评审意见"
                >
                  {annoLinkState === 'ok' ? <Check size={12} /> : <Users size={12} />}
                  {annoLinkState === 'ok'
                    ? '已复制'
                    : annoLinkState === 'too-long'
                      ? '批注过多，链接超长'
                      : annoLinkState === 'fail'
                        ? '复制失败'
                        : '复制带批注的链接'}
                </button>
              )}
            </div>

            {annotations.length === 0 ? (
              <p className="mt-3 rounded-2xl bg-surface-2 px-4 py-3 text-xs leading-relaxed text-ink-mute">
                暂无批注。选中正文任意文字，点击浮动「批注」按钮即可添加评审意见；完成后可复制带批注的链接回传给作者。
              </p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {annotations.map((a) => (
                  <li key={a.id} className="rounded-2xl border border-line bg-surface-2 px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                          {a.author}
                          <span className="rounded-full bg-primary-soft px-1.5 py-0.5 text-[0.5625rem] font-medium text-primary">
                            {ROLE_LABEL[a.role] ?? '访客'}
                          </span>
                        </p>
                        <p className="minor-info mt-0.5 text-[0.625rem] text-ink-mute">{fmtTime(a.createdAt)}</p>
                      </div>
                      <button
                        onClick={() => persistAnnotations(annotations.filter((x) => x.id !== a.id))}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-ink-mute transition-colors hover:bg-danger/10 hover:text-danger"
                        aria-label="删除批注"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    {a.quote && (
                      <blockquote className="mt-2 rounded-lg border-l-2 border-primary/40 bg-surface px-3 py-1.5 text-[0.6875rem] leading-relaxed text-ink-soft">
                        「{a.quote}」
                      </blockquote>
                    )}
                    <p className="mt-2 text-xs leading-relaxed text-ink">{a.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="minor-info mt-4 pb-6 text-center text-[0.625rem] text-ink-mute">
            由智教工坊（EDUStudio）生成 · 内容为分享时的只读快照
          </p>
        </div>
      </div>

      {/* 选区浮动批注按钮 */}
      {selBtn && !formOpen && (
        <button
          onClick={openForm}
          style={{ left: selBtn.x, top: selBtn.y }}
          className="animate-fade-up fixed z-40 -translate-x-1/2 -translate-y-full rounded-full bg-ink px-3 py-1.5 text-[0.6875rem] font-medium text-white shadow-lg transition-transform active:scale-95"
        >
          <span className="inline-flex items-center gap-1">
            <MessageSquarePlus size={12} />
            批注
          </span>
        </button>
      )}

      {/* 批注表单 */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 p-4 backdrop-blur-sm sm:items-center" onClick={() => setFormOpen(false)}>
          <div
            className="animate-fade-up w-full max-w-md rounded-3xl border border-line bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <MessageSquarePlus size={14} className="text-primary" />
                添加批注
              </h3>
              <button
                onClick={() => setFormOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink"
                aria-label="关闭"
              >
                <X size={14} />
              </button>
            </div>
            {formQuote && (
              <blockquote className="mt-3 rounded-xl border-l-2 border-primary/40 bg-surface-2 px-3 py-2 text-[0.6875rem] leading-relaxed text-ink-soft">
                「{formQuote}」
              </blockquote>
            )}
            <input
              value={formAuthor}
              onChange={(e) => setFormAuthor(e.target.value)}
              placeholder="批注人（可选，默认「评审人」）"
              className="mt-3 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs outline-none transition-colors focus:border-primary/50"
            />
            <textarea
              value={formText}
              onChange={(e) => setFormText(e.target.value)}
              placeholder="写下你的评审意见…"
              rows={3}
              autoFocus
              className="mt-2 w-full resize-none rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs leading-relaxed outline-none transition-colors focus:border-primary/50"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setFormOpen(false)}
                className="rounded-full px-4 py-2 text-xs font-medium text-ink-soft transition-colors hover:bg-surface-2"
              >
                取消
              </button>
              <button
                onClick={submitAnnotation}
                disabled={!formText.trim()}
                className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-white transition-all hover:bg-primary-deep active:scale-95 disabled:opacity-40"
              >
                提交批注
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
