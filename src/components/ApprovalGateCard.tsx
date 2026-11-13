/**
 * v1.2 M3b · 统一审批门决策卡（主 chunk，roadmap §3.8 / §4.4）
 *
 * mission gate（来源 badge「战队」）与 Loom checkpoint（「画布」）在 StudioBus / 决策卡层面是
 * 同一个 `ApprovalGate`：同一张卡、同一个一次性出口 `resolveGate(gateId, action)`，
 * 保证「同一件事不会两处各点一次」（roadmap §3.4 / §4.4）。
 *
 * 决策路径（可单测纯函数 `decideGateAction`，本仓无 React 测试环境）：
 * 1. 先 `resolveGate(gateId, action)`：runner / loom bridge 注册过 resolver 时走统一出口；
 * 2. 返回 false（legacy ?v1=1 旧路径没有 resolver）才回退调用方传入的旧回调。
 */
import { Check, ShieldAlert, X } from 'lucide-react'
import type { ApprovalGate } from '../studio/contracts'
import { DIRECTOR_AGENT_LABELS } from '../studio/contracts'
import { resolveGate } from '../studio/gateRegistry'
import { cn } from '../lib/cn'

export type GateDecisionAction = 'continue' | 'cancel'
export type GateDecisionOutcome = 'resolved' | 'fallback' | 'unhandled'

export interface GateDecisionHandlers {
  /** 统一出口（缺省使用 gateRegistry.resolveGate；测试可注入替身） */
  resolve?: (gateId: string, action: GateDecisionAction) => boolean
  /** 旧路径回退（legacy / 无 resolver 时） */
  fallback?: () => void
}

/**
 * 「先走统一出口，再回退旧回调」的纯函数决策（单测覆盖）：
 * - resolver 返回 true → 'resolved'（一次成功出口，不再触发旧回调）；
 * - 无 resolver / 返回 false → 'fallback'（调旧回调）；
 * - 两者都不存在 → 'unhandled'。
 * gateId 为空（历史脏数据）时跳过统一出口，直接回退，保证旧流程可用。
 */
export function decideGateAction(
  gateId: string,
  action: GateDecisionAction,
  handlers: GateDecisionHandlers = {},
): GateDecisionOutcome {
  if (gateId && handlers.resolve) {
    try {
      if (handlers.resolve(gateId, action)) return 'resolved'
    } catch (error) {
      /* 统一出口异常不能让决策卡失效：隔离后回退旧路径 */
      console.error('[ApprovalGateCard] resolveGate 异常已隔离:', error)
    }
  }
  if (handlers.fallback) {
    handlers.fallback()
    return 'fallback'
  }
  return 'unhandled'
}

/** 来源 badge 文案：mission = 战队，loom = 画布 */
export function gateSourceLabel(source: ApprovalGate['source']): string {
  return source === 'loom' ? '画布' : '战队'
}

/** 门后动作文案 */
export function gateActionLabel(requiredAction: ApprovalGate['requiredAction']): string {
  if (requiredAction === 'approve') return '需拍板'
  if (requiredAction === 'edit') return '需修改'
  return '需确认'
}

export interface GateEvidenceChip {
  key: string
  label: string
  tone: 'mute' | 'ok' | 'warn'
}

/**
 * 「依据」chips 派生（纯函数）：
 * citations 数 + 证据链校验汇总；有冲突 / 待核时标 warn（待核产物不进硬门自动放行）。
 */
export function gateEvidenceChips(evidence?: ApprovalGate['evidence']): GateEvidenceChip[] {
  if (!evidence) return []
  const chips: GateEvidenceChip[] = []
  const citations = evidence.citations?.length ?? 0
  if (citations > 0) chips.push({ key: 'citations', label: `依据 ${citations} 条`, tone: 'mute' })

  const verification = evidence.verification
  if (verification && verification.total > 0) {
    const warn = verification.conflict > 0 || verification.unverified > 0
    chips.push({
      key: 'verified',
      label: `已核 ${verification.verified + verification.derived}/${verification.total}`,
      tone: warn ? 'warn' : 'ok',
    })
    if (verification.conflict > 0) chips.push({ key: 'conflict', label: `冲突 ${verification.conflict}`, tone: 'warn' })
    if (verification.unverified > 0) chips.push({ key: 'unverified', label: `待核 ${verification.unverified}`, tone: 'warn' })
  }
  return chips
}

export interface ApprovalGateCardProps {
  gate: ApprovalGate
  onApprove: () => void
  onReject: () => void
  approveLabel?: string
  rejectLabel?: string
  /** 是否展示 sensitive 硬门警告（缺省 true；嵌入窄卡片时可关） */
  showSensitive?: boolean
  /**
   * 紧凑变体（v1.2 M3b 收口）：嵌入画布节点动作行——只渲染来源 badge + 统一按钮，
   * 标题 / 依据由宿主（Loom 节点卡）承载；决策仍走同一 resolveGate → 旧回调回退。
   */
  compact?: boolean
  /** 按钮 testid 覆盖（兼容旧入口，如 loom-checkpoint-continue / loom-checkpoint-cancel） */
  approveTestId?: string
  rejectTestId?: string
}

export default function ApprovalGateCard({
  gate,
  onApprove,
  onReject,
  approveLabel,
  rejectLabel,
  showSensitive,
  compact,
  approveTestId,
  rejectTestId,
}: ApprovalGateCardProps) {
  const chips = gateEvidenceChips(gate.evidence)
  const sensitive = showSensitive !== false && gate.sensitive
  const owner = gate.ownerAgentId ? DIRECTOR_AGENT_LABELS[gate.ownerAgentId] : null

  const decide = (action: GateDecisionAction) => {
    decideGateAction(gate.gateId, action, {
      resolve: resolveGate,
      fallback: action === 'continue' ? onApprove : onReject,
    })
  }

  /* 紧凑变体：画布节点内使用（不放标题/依据，避免与节点卡信息重复） */
  if (compact) {
    return (
      <section
        data-testid="approval-gate-card"
        data-gate-id={gate.gateId}
        data-source={gate.source}
        data-compact="true"
        role="group"
        aria-label={`审批门：${gate.title}`}
        className="flex w-full items-center gap-1.5"
      >
        <span
          data-testid="approval-gate-source"
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.625rem] font-medium',
            gate.source === 'loom' ? 'bg-primary-soft text-primary' : 'bg-amber-soft text-ink-soft',
          )}
        >
          {gateSourceLabel(gate.source)}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            data-testid={approveTestId ?? 'approval-gate-approve'}
            onClick={() => decide('continue')}
            className="inline-flex min-h-11 items-center gap-1 rounded-full bg-primary px-3 text-[0.6875rem] font-medium text-white shadow-soft transition-colors hover:bg-primary-deep"
          >
            <Check size={12} aria-hidden />
            {approveLabel ?? '通过'}
          </button>
          <button
            type="button"
            data-testid={rejectTestId ?? 'approval-gate-reject'}
            onClick={() => decide('cancel')}
            className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line bg-surface px-3 text-[0.6875rem] font-medium text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <X size={12} aria-hidden />
            {rejectLabel ?? '退回'}
          </button>
        </span>
      </section>
    )
  }

  return (
    <section
      data-testid="approval-gate-card"
      data-gate-id={gate.gateId}
      data-source={gate.source}
      data-sensitive={gate.sensitive ? 'true' : undefined}
      role="group"
      aria-label={`审批门：${gate.title}`}
      className="w-full rounded-2xl border border-amber/35 bg-surface/95 p-4 text-left shadow-card backdrop-blur-xl"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          data-testid="approval-gate-source"
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.625rem] font-medium',
            gate.source === 'loom' ? 'bg-primary-soft text-primary' : 'bg-amber-soft text-ink-soft',
          )}
        >
          {gateSourceLabel(gate.source)}
        </span>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[0.625rem] text-ink-soft">
          {gateActionLabel(gate.requiredAction)}
        </span>
        {owner && <span className="truncate text-[0.625rem] text-ink-mute">{owner}</span>}
        <span className="ml-auto text-[0.625rem] font-medium text-ink-mute">只此一件</span>
      </div>

      <h2 className="mt-1.5 text-[1.0625rem] font-semibold tracking-tight text-ink">{gate.title}</h2>

      {sensitive && (
        <p
          data-testid="approval-gate-sensitive"
          className="mt-2 flex items-start gap-1.5 rounded-xl bg-amber-soft px-2.5 py-1.5 text-[0.6875rem] leading-relaxed text-ink-soft"
        >
          <ShieldAlert size={13} className="mt-0.5 shrink-0 text-amber-ink" aria-hidden />
          硬门：对外发送 / 不可逆操作，永不自动放行，需你明确确认。
        </p>
      )}

      {chips.length > 0 && (
        <div data-testid="approval-gate-evidence" className="mt-2 flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <span
              key={chip.key}
              data-chip={chip.key}
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[0.625rem] font-medium',
                chip.tone === 'ok' ? 'bg-mint-soft text-mint-ink' : chip.tone === 'warn' ? 'bg-coral-soft text-coral-ink' : 'bg-surface-2 text-ink-soft',
              )}
            >
              {chip.label}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line/70 pt-3">
        <button
          type="button"
          data-testid={approveTestId ?? 'approval-gate-approve'}
          onClick={() => decide('continue')}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-medium text-white shadow-soft transition-all hover:bg-primary-deep active:scale-[0.98]"
        >
          <Check size={14} aria-hidden />
          {approveLabel ?? '通过'}
        </button>
        <button
          type="button"
          data-testid={rejectTestId ?? 'approval-gate-reject'}
          onClick={() => decide('cancel')}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-4 text-xs font-medium text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <X size={14} aria-hidden />
          {rejectLabel ?? '退回'}
        </button>
      </div>
    </section>
  )
}
