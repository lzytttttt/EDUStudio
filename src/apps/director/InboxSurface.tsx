/**
 * 战情台 · Inbox（v1.0「总指挥模式」原型）
 *
 * 少字策略：数量与准备度交给数字 / 圆环，动作只留 2-4 字动词；
 * 解释性文字只出现在 Sheet 的 note 与 title；进入节奏由 d-* 过渡与轮播占位符承担。
 */
import { useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronRight,
  Clock,
  Loader2,
  MoreHorizontal,
  Moon,
  Send,
  Sparkles,
  Timer,
} from 'lucide-react'
import { cn } from '../../lib/cn'
import { AGENT_MAP, COMPOSE_HINTS } from '../../harness/director/data'
import type { DecisionItem, MissionStatus } from '../../harness/director/types'
import { useDirectorStore } from '../../stores/directorStore'
import {
  AgentAvatar,
  Chip,
  IconButton,
  ReadyRing,
  Sheet,
  SoftButton,
  StatCell,
  TONE,
} from './shared'

/** 入场错峰：复用 director.css 的 d-delay-* */
const CARD_DELAY = ['d-delay-1', 'd-delay-2', 'd-delay-3', 'd-delay-4', 'd-delay-5', 'd-delay-6'] as const

/** 极短示例：点一下填进输入框，替代说明文字 */
const COMPOSE_EXAMPLES = ['家长会材料', '单元考诊断', '督导回执'] as const

/** 状态只说一个短词 */
const MISSION_WORD: Record<MissionStatus, string> = {
  idle: '',
  planning: '计划待确认',
  running: '在办',
  paused: '已暂停',
  waiting: '待你拍板',
  done: '已交付',
}

function greetingFor(hour: number): string {
  if (hour < 5) return '夜深了'
  if (hour < 11) return '早上好'
  if (hour < 13) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

/** 本地化：M月D日 · 周X */
function dateLabel(now: Date): string {
  const monthDay = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(now)
  const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(now)
  return `${monthDay} · ${weekday}`
}

/* ------------------------------------------------------------------ */
/* 决策卡                                                              */
/* ------------------------------------------------------------------ */

function DecisionCard({
  decision,
  index,
  guideTarget,
  onOpen,
  onSnooze,
}: {
  decision: DecisionItem
  index: number
  guideTarget?: string
  onOpen: (id: string) => void
  onSnooze: (id: string) => void
}) {
  const agent = AGENT_MAP[decision.agentId]
  const done = decision.status === 'done'
  const open = () => onOpen(decision.id)

  return (
    <article
      data-testid={`director-decision-${decision.id}`}
      data-guide={guideTarget}
      onClick={done ? undefined : open}
      className={cn(
        'group d-card d-rise relative flex flex-col overflow-hidden rounded-[24px] border border-line bg-surface/80 p-4 backdrop-blur-sm sm:p-5',
        done
          ? 'pointer-events-none border-line/60 bg-surface-2/50 saturate-50'
          : 'cursor-pointer shadow-card-next hover:border-primary/25',
        CARD_DELAY[index % CARD_DELAY.length],
      )}
    >
      {/* 成员色相只做顶部一层极淡的光，不抢标题 */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b opacity-90',
          done && 'hidden',
          TONE[agent.tone].grad,
        )}
      />

      {/* 整卡预览入口：空态 / 键盘都落在这里 */}
      {!done && (
        <button
          type="button"
          aria-label={`预览 ${decision.title}`}
          aria-haspopup="dialog"
          title="先看再做"
          onClick={(e) => {
            e.stopPropagation()
            open()
          }}
          className="absolute inset-0 z-0 rounded-[24px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
        />
      )}

      <div className="relative z-[1] flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <AgentAvatar agentId={decision.agentId} size="sm" />
          <span className="truncate text-[0.6875rem] font-medium tracking-wide text-ink-soft">
            {agent.name}
          </span>
        </span>
        {done ? (
          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-mint-soft text-mint">
            <Check size={16} strokeWidth={2.4} aria-hidden />
          </span>
        ) : (
          <ReadyRing value={decision.readiness} tone={agent.tone} />
        )}
      </div>

      <div className="relative z-[1] mt-3 flex-1 sm:mt-4">
        <h3
          className={cn(
            'text-[0.9375rem] font-semibold leading-snug tracking-tight',
            done && 'text-ink-soft',
          )}
        >
          {decision.title}
        </h3>
        <p className="mt-1 line-clamp-1 text-xs leading-relaxed text-ink-soft">{decision.subtitle}</p>
      </div>

      <div className="relative z-[1] mt-3 flex items-center justify-between gap-2 sm:mt-4">
        <span className="flex min-w-0 items-center gap-2">
          <Chip tone={agent.tone}>{decision.tag}</Chip>
          <span className="inline-flex shrink-0 items-center gap-1 text-[0.6875rem] tabular-nums text-ink-soft">
            <Clock size={14} strokeWidth={2} aria-hidden />
            {decision.minutes} 分钟
          </span>
        </span>
        {done ? (
          <span className="shrink-0 text-[0.6875rem] font-medium text-mint">已处理</span>
        ) : (
          <span
            className="flex shrink-0 items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <IconButton
              icon={MoreHorizontal}
              label="稍后"
              onClick={() => onSnooze(decision.id)}
              className="h-10 w-10"
            />
            <SoftButton size="md" onClick={open} title="先看再做">
              {decision.primaryLabel}
            </SoftButton>
          </span>
        )}
      </div>
    </article>
  )
}

/* ------------------------------------------------------------------ */
/* 预览 Sheet：先看再做                                                 */
/* ------------------------------------------------------------------ */

function PreviewSheet({
  decision,
  onClose,
  onSnooze,
}: {
  decision: DecisionItem | null
  onClose: () => void
  onSnooze: (id: string) => void
}) {
  const accept = useDirectorStore((s) => s.acceptDecision)
  const resolve = useDirectorStore((s) => s.resolveConflict)
  const agent = decision ? AGENT_MAP[decision.agentId] : null
  const conflict = decision?.kind === 'conflict' ? decision.conflict : undefined

  return (
    <Sheet open={!!decision} onClose={onClose} label="预览">
      {decision && agent && (
        <div>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <AgentAvatar agentId={decision.agentId} size="md" />
              <div className="min-w-0">
                <p className="text-[0.6875rem] font-medium tracking-wide text-ink-soft">
                  {agent.name} · {agent.role}
                </p>
                <h2 className="mt-1 text-[1.0625rem] font-semibold leading-snug tracking-tight">
                  {decision.title}
                </h2>
              </div>
            </div>
            <span className="mt-1 shrink-0">
              <ReadyRing value={decision.readiness} size={38} tone={agent.tone} />
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink-soft">{decision.subtitle}</p>

          <div className="mt-4 overflow-hidden rounded-2xl border border-line/70 bg-surface-2/50">
            {decision.preview.rows.map((row, i) => (
              <div
                key={row.label}
                className={cn(
                  'flex items-start justify-between gap-4 px-4 py-2.5',
                  i > 0 && 'border-t border-line/60',
                )}
              >
                <span className="shrink-0 pt-px text-[0.6875rem] text-ink-soft">{row.label}</span>
                <span className="text-right text-xs font-medium leading-snug text-ink">{row.value}</span>
              </div>
            ))}
          </div>

          {decision.preview.note && (
            <p className="mt-3 px-1 text-[0.6875rem] leading-relaxed text-ink-soft">{decision.preview.note}</p>
          )}

          {conflict ? (
            <div className="mt-5">
              <p className="text-[0.8125rem] font-semibold leading-snug text-ink">{conflict.question}</p>
              <div className="mt-2.5 space-y-2">
                {conflict.options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      resolve(decision.id, option.id)
                      onClose()
                    }}
                    className="group flex w-full items-start gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 active:scale-[0.99]"
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-ink-soft transition-colors group-hover:border-primary group-hover:bg-primary-soft group-hover:text-primary">
                      <ArrowUpRight size={14} strokeWidth={2.2} aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[0.8125rem] font-semibold leading-snug text-ink">
                        {option.label}
                      </span>
                      <span className="mt-0.5 block text-[0.6875rem] leading-relaxed text-ink-soft">
                        {option.detail}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="mt-4 flex justify-center">
                <SoftButton variant="ghost" size="md" icon={Clock} onClick={() => onSnooze(decision.id)}>
                  稍后
                </SoftButton>
              </div>
            </div>
          ) : (
            <div className="mt-5 flex items-center gap-2">
              <SoftButton
                variant="soft"
                icon={Clock}
                onClick={() => onSnooze(decision.id)}
                className="h-11 flex-1"
              >
                稍后
              </SoftButton>
              <SoftButton
                variant={decision.kind === 'approve' ? 'coral' : 'primary'}
                icon={decision.kind === 'approve' ? Send : Check}
                onClick={() => {
                  accept(decision.id)
                  onClose()
                }}
                className="h-11 flex-[1.4]"
              >
                {decision.primaryLabel}
              </SoftButton>
            </div>
          )}
        </div>
      )}
    </Sheet>
  )
}

/* ------------------------------------------------------------------ */
/* 在办任务条                                                          */
/* ------------------------------------------------------------------ */

function MissionStrip() {
  const mission = useDirectorStore((s) => s.mission)
  const openMission = useDirectorStore((s) => s.openMission)
  const status = mission.status
  if (status === 'idle') return null

  const done = status === 'done'
  const running = status === 'running'
  const waiting = status === 'waiting'
  const planning = status === 'planning'
  const paused = status === 'paused'
  const tone = done ? TONE.mint : running ? TONE.primary : paused ? TONE.graphite : TONE.amber
  const barTone = done ? 'bg-mint' : running ? 'bg-primary' : paused ? 'bg-ink-mute/60' : 'bg-amber'
  const progress = Math.min(100, Math.max(0, mission.progress))
  /* 计划里出现的成员按顺序取前 4 位叠放，不额外铺文字 */
  const crew = Array.from(new Set(mission.plan.map((task) => task.agentId))).slice(0, 4)

  return (
    <section className="mt-7" aria-label="在办任务">
      <button
        type="button"
        data-guide="mission-strip"
        data-testid="director-mission-strip"
        onClick={openMission}
        title={done ? '查看作战包' : '查看作战室'}
        className={cn(
          'group d-rise d-delay-4 flex w-full items-center gap-3 rounded-[24px] border bg-surface/75 p-3.5 text-left shadow-card-next backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-card active:scale-[0.995] sm:p-4',
          done
            ? 'border-mint/30 hover:border-mint/50'
            : waiting
              ? 'border-amber/40 hover:border-amber/60'
              : 'border-line hover:border-primary/30',
        )}
      >
        <span className="flex shrink-0 -space-x-2">
          {crew.map((agentId) => (
            <AgentAvatar key={agentId} agentId={agentId} size="xs" className="rounded-full ring-2 ring-surface" />
          ))}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[0.8125rem] font-semibold tracking-tight">
              {done ? '查看作战包' : mission.title}
            </span>
            <span
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium',
                tone.soft,
                tone.text,
              )}
            >
              {MISSION_WORD[status]}
            </span>
          </span>
          <span className="mt-2 flex items-center gap-2">
            {planning ? (
              <span className="text-[0.6875rem] font-medium text-ink-soft">待确认 · 计划还没开跑</span>
            ) : (
              <>
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-line/80">
                  <span
                    className={cn('block h-full rounded-full d-progress-glow', barTone)}
                    style={{ width: `${progress}%` }}
                  />
                </span>
                <span className="shrink-0 text-[0.6875rem] tabular-nums text-ink-soft">{progress}%</span>
              </>
            )}
          </span>
        </span>

        <ChevronRight
          size={16}
          strokeWidth={2}
          aria-hidden
          className="shrink-0 text-ink-soft transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-primary"
        />
      </button>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* 空态：只留一行字与一圈柔光                                          */
/* ------------------------------------------------------------------ */

function EmptyDecisions() {
  return (
    <div className="d-rise relative overflow-hidden rounded-[24px] border border-dashed border-line bg-surface/50 px-6 py-14 text-center sm:col-span-2 lg:col-span-3">
      <span aria-hidden className="d-orb absolute left-1/2 top-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 bg-primary/40" />
      <div className="relative flex flex-col items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface text-mint shadow-soft">
          <Check size={20} strokeWidth={2.2} />
        </span>
        <p className="text-sm font-medium text-ink-soft">今天的事都处理完了</p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 战情台                                                              */
/* ------------------------------------------------------------------ */

export default function InboxSurface() {
  const decisions = useDirectorStore((s) => s.decisions)
  const stats = useDirectorStore((s) => s.stats)
  const planMission = useDirectorStore((s) => s.planMission)
  const cancelPlanning = useDirectorStore((s) => s.cancelPlanning)
  const planLoading = useDirectorStore((s) => s.planLoading)
  const snoozeDecision = useDirectorStore((s) => s.snoozeDecision)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [hintIndex, setHintIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const now = new Date()
  const visible = decisions.filter((d) => d.status !== 'snoozed')
  const selected = decisions.find((d) => d.id === selectedId) ?? null

  /* 占位句轮播：一句话代替说明；偏好减弱动效时定格为第一句 */
  useEffect(() => {
    const reduceQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (reduceQuery?.matches) return
    const timer = window.setInterval(() => {
      setHintIndex((i) => (i + 1) % COMPOSE_HINTS.length)
    }, 3500)
    return () => window.clearInterval(timer)
  }, [])

  const openPreview = (id: string) => setSelectedId(id)
  const closePreview = () => setSelectedId(null)
  const snooze = (id: string) => {
    setSelectedId(null)
    snoozeDecision(id)
  }

  /* v1.1：原话交给 store 真拆解（路由 → 真 LLM / 模板兜底 → 计划待确认） */
  const dispatch = () => {
    const text = draft.trim()
    if (!text || planLoading) return
    setDraft('')
    void planMission(text)
  }
  const cancelDispatch = () => {
    cancelPlanning()
  }

  return (
    <div data-testid="director-inbox" className="d-scrollbar-thin h-full w-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-[1120px] flex-col px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-6 sm:px-6 sm:pb-28 sm:pt-8 lg:justify-between">
        {/* 1 · 问候 + 战情条：日期一行，数字三格 */}
        <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="d-rise">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] font-medium tracking-wide text-ink-soft">
              <span data-testid="director-date" className="inline-flex items-center gap-1">
                <CalendarDays size={14} strokeWidth={2} aria-hidden />
                {dateLabel(now)}
              </span>
              <span aria-hidden className="h-1 w-1 rounded-full bg-ink-mute/40" />
              <span data-testid="director-saved" className="inline-flex items-center gap-1">
                <Timer size={14} strokeWidth={2} className="text-mint" aria-hidden />
                省时 {stats.savedHours}h
              </span>
            </p>
            <h1 data-testid="director-greeting" className="mt-1.5 text-[1.0625rem] font-semibold tracking-tight sm:text-lg">
              {greetingFor(now.getHours())}，李老师
            </h1>
          </div>

          <div className="d-rise d-delay-1 flex items-center justify-between gap-4 rounded-[22px] border border-line bg-surface/70 px-4 py-3 shadow-card-next backdrop-blur-md sm:gap-6 sm:px-5">
            <StatCell value={stats.pending} label="待决策" tone="primary" />
            <span aria-hidden className="h-7 w-px shrink-0 bg-line/80" />
            <StatCell value={stats.running} label="在办" tone="mint" />
            <span aria-hidden className="h-7 w-px shrink-0 bg-line/80" />
            <StatCell value={stats.hosted} label="今日托管" tone="graphite" />
          </div>
        </header>

        {/* 2 · 决策卡：先看再做 */}
        <section className="mt-8" aria-labelledby="inbox-decisions-title">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2
              id="inbox-decisions-title"
              className="text-[0.6875rem] font-medium tracking-[0.16em] text-ink-soft"
            >
              {stats.pending > 0 ? '待你拍板' : '今日已清'}
            </h2>
            <span className="inline-flex items-center gap-1.5 text-[0.6875rem] tabular-nums text-ink-soft">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary/50" />
              {stats.pending} 件
            </span>
          </div>

          <div data-guide="decisions" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visible.length === 0 ? (
              <EmptyDecisions />
            ) : (
              visible.map((decision, index) => (
                <DecisionCard
                  key={decision.id}
                  decision={decision}
                  index={index}
                  guideTarget={index === 0 ? 'decision-first' : undefined}
                  onOpen={openPreview}
                  onSnooze={snooze}
                />
              ))
            )}
          </div>
        </section>

        {/* 3 · 一句话委托：占位符自己说明能做什么 */}
        <section className="mt-7 d-rise d-delay-2" aria-labelledby="inbox-compose-title">
          <h2
            id="inbox-compose-title"
            className="mb-2.5 text-[0.6875rem] font-medium tracking-[0.16em] text-ink-soft"
          >
            一句话委托
          </h2>

          <div
            data-guide="compose"
            className="flex items-center gap-2 rounded-[26px] border border-line bg-surface/70 py-1.5 pl-3 pr-1.5 shadow-card backdrop-blur-xl transition-all duration-300 focus-within:border-primary/40 focus-within:shadow-soft sm:gap-3 sm:pl-4"
          >
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"
            >
              <Sparkles size={16} strokeWidth={1.9} aria-hidden />
            </span>
            <input
              ref={inputRef}
              type="text"
              value={draft}
              disabled={planLoading}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  dispatch()
                }
              }}
              placeholder={planLoading ? '正在拆解计划…' : COMPOSE_HINTS[hintIndex]}
              aria-label="一句话委托"
              className="min-w-0 flex-1 bg-transparent py-2 text-[0.9375rem] text-ink outline-none placeholder:text-ink-soft disabled:cursor-wait disabled:opacity-70 sm:text-[0.8125rem]"
            />
            <button
              type="button"
              onClick={planLoading ? cancelDispatch : dispatch}
              aria-label={planLoading ? '取消拆解' : '交给战队'}
              title={planLoading ? '取消拆解' : '交给战队'}
              className={cn(
                'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white shadow-soft transition-all duration-300 hover:shadow-pop active:scale-95',
                planLoading ? 'bg-ink-mute hover:bg-ink-soft' : 'bg-primary hover:bg-primary-deep',
              )}
            >
              {planLoading ? (
                <Loader2 size={18} strokeWidth={2.2} className="animate-spin" aria-hidden />
              ) : (
                <ArrowUpRight size={18} strokeWidth={2.2} aria-hidden />
              )}
            </button>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {COMPOSE_EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => {
                  setDraft(example)
                  inputRef.current?.focus()
                }}
                className="inline-flex h-10 items-center rounded-full border border-line/80 bg-surface/60 px-3.5 text-[0.6875rem] font-medium text-ink-soft backdrop-blur transition-colors duration-300 hover:border-primary/30 hover:text-primary"
              >
                {example}
              </button>
            ))}
          </div>
        </section>

        {/* 4 · 在办任务条：点击回作战室 */}
        <MissionStrip />

        {/* 5 · 安静的收尾：晚间只汇总、不打扰 */}
        <div className="d-rise d-delay-5 mt-5 flex shrink-0 items-center justify-between px-2 text-[0.6875rem] text-ink-soft">
          <span className="inline-flex items-center gap-1.5">
            <Moon size={14} strokeWidth={1.8} aria-hidden />
            晚间战报 · 21:30
          </span>
          <span className="inline-flex items-center gap-1.5" title="战报只读，不要求动作">
            <span aria-hidden className="h-1 w-1 rounded-full bg-ink-mute/50" />
            不打扰
          </span>
        </div>

        <PreviewSheet decision={selected} onClose={closePreview} onSnooze={snooze} />
      </div>
    </div>
  )
}
