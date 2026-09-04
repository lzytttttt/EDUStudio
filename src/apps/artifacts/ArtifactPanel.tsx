import { useMemo, useState } from 'react'
import { Eye, Pencil, Copy, Trash2, FileText, Check, X } from 'lucide-react'
import { useArtifactStore } from '../../stores/artifactStore'
import { useAuthStore } from '../../stores/authStore'
import { renderMarkdown } from '../../lib/markdown'
import { copyText } from '../../lib/clipboard'
import { cn } from '../../lib/cn'

const KIND_LABEL: Record<string, string> = {
  lessonPlan: '教案',
  report: '报告',
  notice: '通知',
  analysis: '分析',
  generic: '文档',
}

export default function ArtifactPanel() {
  const role = useAuthStore((s) => s.role)
  const { docs, activeId, setActive, updateContent, remove, createManual } = useArtifactStore()
  const doc = docs.find((d) => d.id === activeId)
  const [editing, setEditing] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle')
  const html = useMemo(() => (doc ? renderMarkdown(doc.content) : ''), [doc?.content])

  const copy = async () => {
    if (!doc) return
    const ok = await copyText(doc.content)
    setCopyState(ok ? 'ok' : 'fail')
    window.setTimeout(() => setCopyState('idle'), 1500)
  }

  return (
    <div className="flex h-full w-full flex-col">
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
          <div className="flex shrink-0 items-center gap-1">
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
                copyState === 'fail'
                  ? 'text-danger'
                  : 'text-ink-mute hover:bg-surface-2 hover:text-ink',
              )}
              title={copyState === 'fail' ? '复制失败，请手动选择文本复制' : '复制全文'}
              aria-label="复制全文"
            >
              {copyState === 'ok' ? <Check size={15} className="text-mint" /> : copyState === 'fail' ? <X size={15} /> : <Copy size={15} />}
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
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-surface-2 text-ink-mute">
            <FileText size={24} />
          </div>
          <p className="mt-4 text-sm font-medium">暂无打开的文档</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-mute">
            Agent 生成的教案、报告、通知会自动出现在这里
          </p>
          <button
            onClick={() => role && createManual(role)}
            className="mt-5 rounded-full border border-line px-4 py-2 text-xs font-medium text-ink-soft transition-colors hover:border-primary/50 hover:text-primary"
          >
            新建空白文档
          </button>
        </div>
      ) : editing ? (
        <textarea
          value={doc.content}
          onChange={(e) => updateContent(doc.id, e.target.value)}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none bg-surface-2 p-4 font-mono text-xs leading-relaxed outline-none"
        />
      ) : (
        <div
          className="md-body min-h-0 flex-1 overflow-y-auto px-5 py-4"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}

      {/* 底部元信息 */}
      {doc && (
        <footer className="flex items-center justify-between border-t border-line px-4 py-2 text-[10px] text-ink-mute">
          <span>{doc.source === 'agent' ? 'Agent 生成' : doc.source === 'manual' ? '手动创建' : '简报采纳'}</span>
          <span>{doc.content.length} 字 · 可直接编辑导出</span>
        </footer>
      )}
    </div>
  )
}
