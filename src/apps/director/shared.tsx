/**
 * Director 原型共用视觉件（v1 实验场）
 *
 * 设计约束（用户硬要求）：界面少字、干练；状态与动作尽量由图形、颜色、动效承担。
 * 所有颜色映射到现有 design token；不引入新依赖。
 */
import { useEffect, type ComponentType, type ReactNode } from 'react'
import {
  BarChart3,
  BookOpen,
  CalendarClock,
  Compass,
  HeartHandshake,
  PenLine,
} from 'lucide-react'
import { cn } from '../../lib/cn'
import { AGENT_MAP } from '../../harness/director/data'
import type { DirectorAgentId, Tone } from '../../harness/director/types'

type IconType = ComponentType<{ size?: number | string; className?: string; strokeWidth?: number | string }>

export const AGENT_ICON: Record<DirectorAgentId, IconType> = {
  chief: Compass,
  analyst: BarChart3,
  assessor: PenLine,
  curriculum: BookOpen,
  communicator: HeartHandshake,
  steward: CalendarClock,
}

export const TONE: Record<
  Tone,
  { text: string; soft: string; ring: string; grad: string; dot: string; hex: string; label: string }
> = {
  primary: {
    text: 'text-primary',
    soft: 'bg-primary-soft',
    ring: 'ring-primary/25',
    grad: 'from-primary/18 via-primary/6 to-transparent',
    dot: 'bg-primary',
    hex: '#4f46e5',
    label: '编排',
  },
  mint: {
    text: 'text-mint',
    soft: 'bg-mint-soft',
    ring: 'ring-mint/30',
    grad: 'from-mint/20 via-mint/6 to-transparent',
    dot: 'bg-mint',
    hex: '#2a9d8f',
    label: '数据',
  },
  coral: {
    text: 'text-coral',
    soft: 'bg-coral-soft',
    ring: 'ring-coral/30',
    grad: 'from-coral/18 via-coral/6 to-transparent',
    dot: 'bg-coral',
    hex: '#ff6b6b',
    label: '沟通',
  },
  amber: {
    text: 'text-[#9a7417]',
    soft: 'bg-amber-soft',
    ring: 'ring-amber/40',
    grad: 'from-amber/25 via-amber/8 to-transparent',
    dot: 'bg-amber',
    hex: '#f6c453',
    label: '设计',
  },
  graphite: {
    text: 'text-ink-soft',
    soft: 'bg-surface-2',
    ring: 'ring-line',
    grad: 'from-ink/10 via-ink/4 to-transparent',
    dot: 'bg-ink-mute',
    hex: '#6b6660',
    label: '事务',
  },
}

export type AgentStatus = 'idle' | 'running' | 'waiting' | 'done'

const STATUS_DOT: Record<AgentStatus, string> = {
  idle: 'bg-ink-mute/40',
  running: 'bg-primary animate-pulse',
  waiting: 'bg-amber animate-pulse',
  done: 'bg-mint',
}

const AVATAR_SIZE = {
  xs: { box: 'h-6 w-6', icon: 11 },
  sm: { box: 'h-8 w-8', icon: 14 },
  md: { box: 'h-10 w-10', icon: 17 },
  lg: { box: 'h-14 w-14', icon: 24 },
  xl: { box: 'h-20 w-20', icon: 34 },
} as const

export function AgentAvatar({
  agentId,
  size = 'md',
  status,
  breathing = false,
  className,
}: {
  agentId: DirectorAgentId
  size?: keyof typeof AVATAR_SIZE
  status?: AgentStatus
  breathing?: boolean
  className?: string
}) {
  const agent = AGENT_MAP[agentId]
  const tone = TONE[agent.tone]
  const dims = AVATAR_SIZE[size]
  const Icon = AGENT_ICON[agentId]
  return (
    <span className={cn('relative inline-flex shrink-0', dims.box, className)}>
      <span
        className={cn(
          'flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br ring-1 backdrop-blur-sm',
          tone.grad,
          tone.ring,
          breathing && 'd-breathe',
        )}
      >
        <Icon size={dims.icon} className={tone.text} strokeWidth={1.7} />
      </span>
      {status && (
        <span
          className={cn(
            'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface',
            STATUS_DOT[status],
          )}
        />
      )}
    </span>
  )
}

/** 极简「头像 + 名字」组合；名字默认 12px，用于卡片角标 / 计划行 */
export function AgentTag({
  agentId,
  size = 'sm',
  className,
  hideName = false,
}: {
  agentId: DirectorAgentId
  size?: keyof typeof AVATAR_SIZE
  className?: string
  hideName?: boolean
}) {
  const agent = AGENT_MAP[agentId]
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <AgentAvatar agentId={agentId} size={size} />
      {!hideName && (
        <span className="text-[0.6875rem] font-medium tracking-wide text-ink-soft">{agent.name}</span>
      )}
    </span>
  )
}

/** 准备度环：数字极小，圆环承担主要信息；<80 时自动转 amber */
export function ReadyRing({
  value,
  size = 34,
  tone = 'primary',
  showValue = true,
}: {
  value: number
  size?: number
  tone?: Tone
  showValue?: boolean
}) {
  const stroke = 2.6
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const safe = Math.max(0, Math.min(100, value))
  const color = TONE[tone].hex
  const ringColor = safe < 80 ? '#f6c453' : color
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--line))" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={ringColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(safe / 100) * c} ${c}`}
          style={{ transition: 'stroke-dasharray .6s cubic-bezier(.22,1,.36,1)' }}
        />
      </svg>
      {showValue && (
        <span className="absolute text-[0.5625rem] font-semibold tabular-nums text-ink-soft">{safe}</span>
      )}
    </span>
  )
}

export function SoftButton({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  className,
  title,
  disabled,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'soft' | 'ghost' | 'coral'
  size?: 'sm' | 'md' | 'lg'
  icon?: IconType
  className?: string
  title?: string
  disabled?: boolean
  type?: 'button' | 'submit'
}) {
  const variants = {
    primary: 'bg-primary text-white shadow-soft hover:bg-primary-deep hover:shadow-pop',
    coral: 'bg-coral text-white shadow-soft hover:brightness-95 hover:shadow-pop',
    soft: 'border border-line bg-surface text-ink hover:border-ink-mute/40 hover:shadow-soft',
    ghost: 'text-ink-soft hover:bg-surface-2',
  }
  const sizes = {
    sm: 'h-8 gap-1.5 px-3 text-xs',
    md: 'h-10 gap-2 px-4 text-[0.8125rem]',
    lg: 'h-12 gap-2.5 px-6 text-sm',
  }
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center rounded-full font-medium transition-all duration-300 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40',
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {Icon && <Icon size={size === 'sm' ? 13 : 15} strokeWidth={2} />}
      {children}
    </button>
  )
}

export function IconButton({
  label,
  onClick,
  icon: Icon,
  active = false,
  className,
}: {
  label: string
  onClick?: () => void
  icon: IconType
  active?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-all duration-300 hover:bg-surface-2 hover:text-ink active:scale-95',
        active && 'bg-surface-2 text-ink',
        className,
      )}
    >
      <Icon size={17} strokeWidth={1.8} />
    </button>
  )
}

export function Chip({
  children,
  tone = 'graphite',
  className,
  dot = false,
}: {
  children: ReactNode
  tone?: Tone
  className?: string
  dot?: boolean
}) {
  const t = TONE[tone]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.6875rem] font-medium',
        t.soft,
        t.text,
        className,
      )}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', t.dot)} />}
      {children}
    </span>
  )
}

/** 底部上滑面板 / 桌面居中弹层；极简头部（标题 + 关闭），内容由调用方决定 */
export function Sheet({
  open,
  onClose,
  children,
  label,
  wide = false,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  label: string
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={label}>
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink/25 backdrop-blur-[2px] d-fade"
      />
      <div
        className={cn(
          'relative z-10 w-full rounded-t-[28px] border border-line bg-surface p-5 shadow-card sm:rounded-[28px] sm:p-6 d-sheet',
          wide ? 'sm:max-w-[640px]' : 'sm:max-w-[460px]',
          'max-h-[88vh] overflow-y-auto',
        )}
      >
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[0.625rem] font-medium uppercase tracking-[0.18em] text-ink-mute">{label}</span>
          <IconButton icon={XIcon} label="关闭" onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  )
}

function XIcon({ size = 16, className, strokeWidth = 2 }: { size?: number | string; className?: string; strokeWidth?: number | string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} className={className}>
      <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}

/** 战情条大数字：数字大、标签小且极短 */
export function StatCell({
  value,
  label,
  tone = 'graphite',
  suffix,
}: {
  value: number | string
  label: string
  tone?: Tone
  suffix?: string
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 sm:items-start">
      <span className={cn('d-num text-[1.375rem] font-semibold leading-none tracking-tight', TONE[tone].text)}>
        {value}
        {suffix && <span className="ml-0.5 text-[0.625rem] font-medium text-ink-mute">{suffix}</span>}
      </span>
      <span className="text-[0.625rem] font-medium tracking-wide text-ink-mute">{label}</span>
    </div>
  )
}
