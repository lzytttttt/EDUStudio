/**
 * Loom 人工确认节点动作（v0.9.4 M6 → v1.2 M3b 统一）
 *
 * - 仅由任务卡在 `type === 'checkpoint'` 时渲染；
 * - `status === 'waiting'`（runner 暂停等待）：渲染**统一审批门卡** `ApprovalGateCard`（compact 变体）——
 *   gateId 口径 `loom:<boardId>:<nodeId>`（与 `integrations/studio/loomGates` 注册一致），
 *   继续 = resolveGate('continue')（无 resolver 时自动回落旧 `onContinue` → resumeCheckpoint），
 *   取消 = resolveGate('cancel')（同样回落旧 `onCancel` → resumeCheckpoint）；
 * - 其余状态保持旧紧凑动作行（继续禁用 / 取消可用），testid / 文案 / 行为零变化；
 * - 旧入口 testid `loom-checkpoint-actions` / `loom-checkpoint-continue` / `loom-checkpoint-cancel`
 *   与文案「继续」「取消」全部保留（旧 Loom E2E / 视觉零回归）。
 */
import { Play, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { useLoomStore } from '../../stores/loomStore'
import { loomApprovalGate } from '../../integrations/studio/loomGates'
import ApprovalGateCard from '../../components/ApprovalGateCard'

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

  /* waiting 态：取当前画布节点构造统一 ApprovalGate（gateId 与 loom 桥注册口径一致） */
  const board = useLoomStore((s) => s.boards.find((b) => b.id === s.activeBoardId) ?? null)
  const node = board?.nodes.find((n) => n.id === nodeId) ?? null
  const gate = board && node && waiting && !disabled ? loomApprovalGate(board, node) : null

  /* waiting 且未整体禁用：统一审批门卡（compact）——决策先走 gateRegistry 一次性出口，
     无 resolver（loom 桥未安装 / 节点门未注册）时 ApprovalGateCard 自动回退旧回调 resumeCheckpoint */
  if (gate) {
    return (
      <div
        data-testid="loom-checkpoint-actions"
        data-waiting="true"
        /* 画布层用 pointerdown 统一接管拖拽/连线（含指针捕获），节点内按钮必须截断，
           否则 click 会被画布重定向：这是旧动作行内联 stopPropagation 的等价处理 */
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className="mt-1.5 rounded-xl border border-coral/30 bg-coral-soft/50 px-1.5 py-1"
      >
        <ApprovalGateCard
          compact
          gate={gate}
          onApprove={() => onContinue(nodeId)}
          onReject={() => onCancel(nodeId)}
          approveLabel="继续"
          rejectLabel="取消"
          showSensitive={false}
          approveTestId="loom-checkpoint-continue"
          rejectTestId="loom-checkpoint-cancel"
        />
      </div>
    )
  }

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
