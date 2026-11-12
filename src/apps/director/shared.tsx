/**
 * Director 原型共用视觉件（v1 实验场）
 *
 * 设计约束（用户硬要求）：界面少字、干练；状态与动作尽量由图形、颜色、动效承担。
 * 所有颜色映射到现有 design token；不引入新依赖。
 *
 * v1.1 视觉 P0/P1（roadmap §7）：
 * - 对比度：文字用加深变体（amber-ink / coral-ink / mint-ink），coral 本体只作图标/圆点/底色；
 *   ink-mute 只用于大号文字，小号标签/说明改用 ink-soft；
 * - 字号最小 11px；图标三档（行内 14 / 按钮 16–18 / dock 18）；触控 icon ≥40、主按钮 ≥44；
 * - Sheet 焦点管理：初始聚焦关闭钮、Tab 焦点循环、Esc 关闭、关闭后焦点还原。
 */
import { useEffect, useRef, type ComponentType, type ReactNode } from 'react'
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

type IconType = ComponentType<{
  size?: number | string
  className?: string
  strokeWidth?: number | string
  'aria-hidden'?: boolean | 'true' | 'false'
}>

/** v1.1 图标三档（roadmap §7.3）：行内 14 / 按钮 16–18 / dock 18 */
export const ICON_SIZE = { inline: 14, button: 18, dock: 18 } as const

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
    /* 文本用加深变体（白底 5.16:1）；mint 本体留给圆点/图形 */
    text: 'text-mint-ink',
    soft: 'bg-mint-soft',
    ring: 'ring-mint/30',
    grad: 'from-mint/20 via-mint/6 to-transparent',
    dot: 'bg-mint',
    hex: '#2a9d8f',
    label: '数据',
  },
  coral: {
    /* coral 本体 2.52:1 只作图标/圆点；文字一律 coral-ink（4.64:1） */
    text: 'text-coral-ink',
    soft: 'bg-coral-soft',
    ring: 'ring-coral/30',
    grad: 'from-coral/18 via-coral/6 to-transparent',
    dot: 'bg-coral',
    hex: '#ff6b6b',
    label: '沟通',
  },
  amber: {
    /* 原 text-[#9a7417] 4.00:1 → amber-ink 5.92:1 */
    text: 'text-amber-ink',
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
        <Icon size={dims.icon} className={tone.text} strokeWidth={1.7} aria-hidden />
      </span>
      {status && (
        <span
          aria-hidden
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

/** 准备度环：数字极小，圆环承担主要信息；<80 时自动转 amber（图形色，文字用 ink-soft 保对比度） */
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
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
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
          style={{ transition: 'stroke-dasharray 240ms cubic-bezier(.22,1,.36,1)' }}
        />
      </svg>
      {showValue && (
        /* 字号下限 11px（原 9px），ink-soft 保证小字对比度 */
        <span className="absolute text-[0.6875rem] font-semibold tabular-nums text-ink-soft">{safe}</span>
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
    /* 白字在 coral 本体上只有 2.78:1 → 用同色相加深底 coral-ink（4.64:1） */
    coral: 'bg-coral-ink text-white shadow-soft hover:brightness-95 hover:shadow-pop',
    soft: 'border border-line bg-surface text-ink hover:border-ink-mute/40 hover:shadow-soft',
    ghost: 'text-ink-soft hover:bg-surface-2',
  }
  /* 触控：主按钮 ≥44（md/lg）；sm 作次要动作保持 ≥40 */
  const sizes = {
    sm: 'h-10 gap-1.5 px-3 text-xs',
    md: 'h-11 gap-2 px-4 text-[0.8125rem]',
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
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {Icon && <Icon size={size === 'sm' ? ICON_SIZE.inline : size === 'lg' ? ICON_SIZE.dock : 16} strokeWidth={2} aria-hidden />}
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
  buttonRef,
}: {
  label: string
  onClick?: () => void
  icon: IconType
  active?: boolean
  className?: string
  /** Sheet 需要把初始焦点放到关闭钮上（不改变组件对外的其余行为） */
  buttonRef?: React.Ref<HTMLButtonElement>
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      /* 触控 icon ≥40（roadmap §7.3）；焦点环 2px/45 + offset，与键盘走查统一 */
      className={cn(
        'inline-flex h-10 w-10 items-center justify-center rounded-full text-ink-soft transition-all duration-300 hover:bg-surface-2 hover:text-ink active:scale-95',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        active && 'bg-surface-2 text-ink',
        className,
      )}
    >
      <Icon size={ICON_SIZE.button} strokeWidth={1.8} aria-hidden />
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
      {dot && <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', t.dot)} />}
      {children}
    </span>
  )
}

/** 可聚焦元素选择器：Sheet 焦点循环用 */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

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
  const panelRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  /* onClose 常是内联箭头函数：经 ref 转发，避免父级重渲染导致焦点被反复重置 */
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    /* 打开：记住来源焦点，初始聚焦关闭钮（等面板挂载后一帧） */
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 0)

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      /* 焦点循环：Tab / Shift+Tab 限制在面板内 */
      const panel = panelRef.current
      if (!panel) return
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      )
      if (focusables.length === 0) {
        e.preventDefault()
        panel.focus()
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const activeEl = document.activeElement as HTMLElement | null
      const inside = activeEl ? panel.contains(activeEl) : false
      if (e.shiftKey && (!inside || activeEl === first)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (!inside || activeEl === last)) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(focusTimer)
      window.removeEventListener('keydown', onKey)
      /* 关闭：焦点还原到打开前的元素（元素被卸掉时 focus 无副作用） */
      restoreRef.current?.focus()
      restoreRef.current = null
    }
  }, [open])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={label}>
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink/25 backdrop-blur-[2px] d-fade"
        tabIndex={-1}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        data-testid="director-sheet"
        className={cn(
          'relative z-10 w-full rounded-t-[28px] border border-line bg-surface p-5 shadow-card sm:rounded-[28px] sm:p-6 d-sheet focus-visible:outline-none',
          wide ? 'sm:max-w-[640px]' : 'sm:max-w-[460px]',
          'max-h-[88vh] overflow-y-auto',
        )}
      >
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[0.6875rem] font-medium uppercase tracking-[0.18em] text-ink-soft">{label}</span>
          <IconButton icon={XIcon} label="关闭" onClick={onClose} buttonRef={closeRef} />
        </div>
        {children}
      </div>
    </div>
  )
}

function XIcon({ size = 16, className, strokeWidth = 2 }: { size?: number | string; className?: string; strokeWidth?: number | string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} className={className} aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}

/** 战情条大数字：数字大、标签小且极短；小号标签用 ink-soft，避免 ink-mute 小字低对比 */
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
        {suffix && <span className="ml-0.5 text-[0.6875rem] font-medium text-ink-soft">{suffix}</span>}
      </span>
      <span className="text-[0.6875rem] font-medium tracking-wide text-ink-soft">{label}</span>
    </div>
  )
}
