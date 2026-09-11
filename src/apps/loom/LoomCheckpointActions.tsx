/**
 * Loom 人工确认节点动作（v0.9.4 M6）
 *
 * - 仅由任务卡在 `type === 'checkpoint'` 时渲染；
 * - `status === 'waiting'`（runner 暂停等待）用 coral 视觉；其余状态弱化为中性禁用态；
 * - [继续] / [取消] 回调交给主线接入 runner 的 resume / cancel。
 */
import { Play, X } from 'lucide-react'
import { cn } from '../../lib/cn'

interface LoomCheckpointActionsProps {
  nodeId: string
  /** 是否处于 runner 暂停的 waiting 态 */
  waiting?: boolean
  /** 额外禁用（如批量执行中） */
  disabled?: boolean
  onContinue: (nodeId: string) => void
  onCancel: (nodeId: string) => void
}

export function LoomCheckpointActions({ nodeId, waiting, disabled, onContinue, onCancel }: LoomCheckpointActionsProps) {
  /* 未到 waiting 时「继续」不可用（避免越过前置任务）；取消始终可用 */
  const continueDisabled = disabled || !waiting

  return (
    <div
      data-testid="loom-checkpoint-actions"
      data-waiting={waiting ? 'true' : undefined}
      className={cn(
        'mt-1.5 flex items-center gap-1.5',
        waiting && 'rounded-xl border border-coral/30 bg-coral-soft/50 px-1.5 py-1',
      )}
    >
      <button
        type="button"
        data-testid="loom-checkpoint-continue"
        disabled={continueDisabled}
        onClick={(e) => {
          e.stopPropagation()
          onContinue(nodeId)
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className={cn(
          'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[0.5625rem] font-medium transition-colors',
          waiting
            ? 'bg-coral text-white hover:bg-coral/90 disabled:opacity-50'
            : 'border border-line text-ink-soft hover:bg-surface-2',
        )}
      >
        <Play size={9} />
        继续
      </button>
      <button
        type="button"
        data-testid="loom-checkpoint-cancel"
        onClick={(e) => {
          e.stopPropagation()
          onCancel(nodeId)
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className="ml-auto inline-flex items-center gap-0.5 rounded-full border border-line px-2 py-0.5 text-[0.5625rem] font-medium text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <X size={9} />
        取消
      </button>
    </div>
  )
}
