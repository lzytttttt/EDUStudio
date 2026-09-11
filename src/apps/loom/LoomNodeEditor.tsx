/**
 * Loom 节点编辑器（v0.9.4 M2/M3）
 *
 * - 采用节点旁的小浮层（popover）而非 Modal：不把人从空间里抽离（原方案十五）；
 * - AI 模块 / 便签可编辑名称与指令；任务 / 文档 / 人工确认展示绑定与上下游；
 * - 删除规则（原方案二十四）：人工模块可删；简报任务只「从画布移除」，不删 ChatSession。
 */
import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, Trash2, X } from 'lucide-react'
import { useLoomStore } from '../../stores/loomStore'
import { useUiStore } from '../../stores/uiStore'
import { downstreamNodes, upstreamNodes } from '../../lib/loomGraph'
import { LOOM_STATUS_META, LOOM_TYPE_META } from './loomNodeMeta'
import { cn } from '../../lib/cn'

interface LoomNodeEditorProps {
  nodeId: string
  onClose: () => void
  onDeleted: () => void
}

export default function LoomNodeEditor({ nodeId, onClose, onDeleted }: LoomNodeEditorProps) {
  const board = useLoomStore((s) => s.boards.find((b) => b.id === s.activeBoardId) ?? null)
  const node = board?.nodes.find((n) => n.id === nodeId) ?? null
  const updateNode = useLoomStore((s) => s.updateNode)
  const removeNode = useLoomStore((s) => s.removeNode)
  const pushLoomToast = useUiStore((s) => s.pushLoomToast)

  const [title, setTitle] = useState(node?.title ?? '')
  const [instruction, setInstruction] = useState(node?.instruction ?? '')

  /* 切换选中节点时同步初值 */
  useEffect(() => {
    setTitle(node?.title ?? '')
    setInstruction(node?.instruction ?? '')
  }, [nodeId, node?.title, node?.instruction])

  const relations = useMemo(() => {
    if (!board || !node) return { up: [], down: [] }
    return { up: upstreamNodes(board, node.id), down: downstreamNodes(board, node.id) }
  }, [board, node])

  if (!node || !board) return null

  const meta = LOOM_TYPE_META[node.type]
  const status = LOOM_STATUS_META[node.status]
  const editable = node.type === 'agent' || node.type === 'note'
  const running = node.status === 'running'
  const dirty = editable && (title !== node.title || instruction !== (node.instruction ?? ''))

  const save = () => {
    if (!dirty || running) return
    updateNode(node.id, {
      title: title.trim() || node.title,
      instruction: instruction.trim() || undefined,
    })
  }

  return (
    <div
      data-testid="loom-node-editor"
      /* 浮层不参与画布手势：阻止指针事件冒泡 */
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      className="animate-fade-up absolute bottom-14 right-3 z-20 w-[19rem] rounded-2xl border border-line bg-surface p-3 shadow-pop"
    >
      <div className="flex items-center gap-1.5">
        <span className="text-sm" aria-hidden>
          {meta.icon}
        </span>
        <span className="text-[0.6875rem] font-medium text-ink-mute">{meta.label}</span>
        <span className={cn('ml-1 h-1.5 w-1.5 rounded-full', status.dot)} />
        <span className="text-[0.625rem] text-ink-mute">{status.label}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="ml-auto flex h-6 w-6 items-center justify-center rounded-lg text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <X size={12} />
        </button>
      </div>

      {editable ? (
        <div className="mt-2.5 space-y-2.5">
          <label className="block">
            <span className="text-[0.625rem] font-medium text-ink-mute">名称</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={running}
              className="mt-1 w-full rounded-xl border border-line bg-bg px-2.5 py-1.5 text-xs text-ink outline-none transition-colors focus:border-primary/50 disabled:opacity-60"
            />
          </label>
          <label className="block">
            <span className="text-[0.625rem] font-medium text-ink-mute">
              {node.type === 'note' ? '记录点什么' : '要它做什么'}
            </span>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              disabled={running}
              rows={3}
              placeholder={node.type === 'agent' ? '例如：根据上游学情分析结果，生成三档分层练习' : '随手记下重点，不参与执行'}
              className="mt-1 w-full resize-none rounded-xl border border-line bg-bg px-2.5 py-1.5 text-xs leading-relaxed text-ink outline-none transition-colors placeholder:text-ink-mute/70 focus:border-primary/50 disabled:opacity-60"
            />
          </label>
          <div className="flex items-center gap-2">
            <span className="minor-info text-[0.5625rem] text-ink-mute">
              {node.type === 'agent' ? '需要上游结果时，会自动带上游输出执行' : '便签不参与执行'}
            </span>
            <button
              type="button"
              data-testid="loom-node-save"
              onClick={save}
              disabled={!dirty || running}
              className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-[0.6875rem] font-medium text-white shadow-soft transition-all hover:bg-primary-deep disabled:opacity-40"
            >
              <Check size={11} />
              保存
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2.5 space-y-1.5">
          <p className="text-xs font-semibold text-ink">{node.title}</p>
          {node.description && <p className="text-[0.6875rem] leading-relaxed text-ink-soft">{node.description}</p>}
          {node.status === 'error' && (
            <p className="rounded-xl border border-danger/25 bg-danger/5 px-2.5 py-1.5 text-[0.625rem] text-danger">
              执行失败，可在运行台「从这里重试」
            </p>
          )}
        </div>
      )}

      {/* 上下游概览（可视线索） */}
      {(relations.up.length > 0 || relations.down.length > 0) && (
        <div className="mt-2.5 border-t border-line pt-2">
          <p className="text-[0.5625rem] font-medium text-ink-mute">连接关系</p>
          <div className="mt-1 space-y-1">
            {relations.up.map((n) => (
              <RelationRow key={`up-${n.id}`} label="上游" title={n.title} />
            ))}
            {relations.down.map((n) => (
              <RelationRow key={`down-${n.id}`} label="下游" title={n.title} />
            ))}
          </div>
        </div>
      )}

      {/* 删除动作 */}
      <div className="mt-2.5 flex items-center gap-2 border-t border-line pt-2">
        {node.type === 'task' ? (
          <>
            <span className="minor-info min-w-0 flex-1 text-[0.5625rem] leading-snug text-ink-mute">
              只从画布移除，任务与产出一并保留
            </span>
            <button
              type="button"
              data-testid="loom-node-remove"
              onClick={() => {
                removeNode(node.id)
                pushLoomToast('info', '已从画布移除，任务与产出保留')
                onDeleted()
              }}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[0.625rem] font-medium text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink"
            >
              从画布移除
            </button>
          </>
        ) : (
          <>
            <span className="minor-info min-w-0 flex-1 text-[0.5625rem] leading-snug text-ink-mute">删除该模块</span>
            <button
              type="button"
              data-testid="loom-node-delete"
              onClick={() => {
                removeNode(node.id)
                pushLoomToast('info', '模块已删除')
                onDeleted()
              }}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-danger/25 px-2.5 py-1 text-[0.625rem] font-medium text-danger transition-colors hover:bg-danger/5"
            >
              <Trash2 size={11} />
              删除
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function RelationRow({ label, title }: { label: string; title: string }) {
  return (
    <p className="flex items-center gap-1.5 text-[0.625rem] text-ink-soft">
      <span className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-[0.5625rem] text-ink-mute">{label}</span>
      <ArrowRight size={9} className="shrink-0 text-ink-mute" />
      <span className="truncate">{title}</span>
    </p>
  )
}
