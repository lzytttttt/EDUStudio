/**
 * 作战室 MissionSurface（v1.0 总指挥模式 · 前端原型）
 *
 * 少字原则：正文只留动作词（2-4 字）与状态词（2-4 字），
 * 其余信息交给图形、色彩、节奏与 title 兜底。
 *
 * 四种视图共用本文件与同一屏容器，过渡全部复用 director.css：
 * - planning → running / running ⇄ waiting / → done：挂载 d-rise（prefers-reduced-motion 时自动关闭）；
 * - 审批门出现：d-sheet 上滑 + d-guide-ring 呼吸光圈（唯一在等你的那一件）；
 * - 状态词切换：d-fade；动态流逐条：d-feed-in；进度：SVG 环 + stroke-dasharray 过渡。
 *
 * 只消费既有 store 动作与 data 常量，不新增依赖 / 不改其他文件。
 */
import { useEffect, useRef, type ComponentType } from 'react'
import {
  ArrowUpRight,
  BarChart3,
  ChevronLeft,
  Eye,
  FileText,
  ListTree,
  Mail,
  Megaphone,
  Moon,
  Play,
  Presentation,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react'
import { cn } from '../../lib/cn'
import { AGENT_MAP, ARTIFACTS, MISSION_PLAN } from '../../harness/director/data'
import type {
  ArtifactTile,
  DirectorAgentId,
  FeedItem,
  MissionGate,
  MissionPlanTask,
  MissionState,
  Tone,
} from '../../harness/director/types'
import { useDirectorStore } from '../../stores/directorStore'
import { AgentAvatar, Chip, IconButton, SoftButton, StatCell, TONE } from './shared'

type IconType = ComponentType<{ size?: number | string; className?: string; strokeWidth?: number | string }>

/** 计划中带审批门的两个环节（与 MISSION_SCRIPT 的 speech / letters 一一对应） */
const GATE_STEP_IDS: ReadonlySet<string> = new Set(['t2', 't3'])

/** 逐行浮现：director.css 已提供 d-delay-1..8 */
const RISE_DELAYS = ['d-delay-1', 'd-delay-2', 'd-delay-3', 'd-delay-4', 'd-delay-5', 'd-delay-6', 'd-delay-7', 'd-delay-8'] as const
const riseDelay = (index: number): string => RISE_DELAYS[Math.min(index, RISE_DELAYS.length - 1)]

const ARTIFACT_ICON: Record<ArtifactTile['kind'], IconType> = {
  简报: BarChart3,
  讲稿: Megaphone,
  大纲: ListTree,
  信件: Mail,
}

const GATE_META: Record<
  MissionGate,
  { agentId: DirectorAgentId; title: string; primary: string; rows: { id: string; label: string; icon: IconType }[] }
> = {
  speech: {
    agentId: 'curriculum',
    title: '发言稿 + PPT 待过目',
    primary: '放行',
    rows: [
      { id: 'a-speech', label: '发言稿', icon: FileText },
      { id: 'a-ppt', label: 'PPT 大纲', icon: Presentation },
    ],
  },
  letters: {
    agentId: 'communicator',
    title: '3 封信待发送',
    primary: '发送',
    rows: [{ id: 'a-letters', label: '收件人 3 · 语气已校准', icon: Mail }],
  },
}

/* ------------------------------------------------------------------ */
/* 小件                                                                */
/* ------------------------------------------------------------------ */

const RING_RADIUS = 44
const RING_CIRC = 2 * Math.PI * RING_RADIUS

/** 自绘进度环：中心只留 progress 小数字 */
function ProgressRing({ value, tone }: { value: number; tone: Tone }) {
  const safe = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div className="relative flex h-[92px] w-[92px] items-center justify-center sm:h-[116px] sm:w-[116px]">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={RING_RADIUS} fill="none" stroke="rgb(var(--line))" strokeWidth="4.5" />
        <circle
          cx="50"
          cy="50"
          r={RING_RADIUS}
          fill="none"
          stroke={TONE[tone].hex}
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeDasharray={`${(safe / 100) * RING_CIRC} ${RING_CIRC}`}
          style={{ transition: 'stroke-dasharray .7s cubic-bezier(.22,1,.36,1), stroke .4s ease' }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex items-baseline gap-0.5">
          <span className="d-num text-[1.375rem] font-semibold leading-none text-ink sm:text-2xl">{safe}</span>
          <span className="text-[0.625rem] font-medium text-ink-mute">%</span>
        </span>
      </span>
    </div>
  )
}

/** 动态流一行：头像 + 短句 + 右端状态点（不换行） */
function FeedRow({ item }: { item: FeedItem }) {
  const agent = AGENT_MAP[item.agentId]
  const isGate = item.kind === 'gate'
  const dotTone = item.kind === 'system' ? 'bg-mint' : TONE[agent.tone].dot
  const clock = new Date(item.at).toLocaleTimeString('zh-CN', { hour12: false })

  return (
    <div
      className="d-feed-in flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors duration-300 hover:bg-surface-2/60"
      title={`${agent.name} · ${clock}`}
    >
      <AgentAvatar agentId={item.agentId} size="xs" />
      <span className="min-w-0 flex-1 truncate whitespace-nowrap text-[0.75rem] text-ink-soft">{item.text}</span>
      <span
        title={isGate ? '等你拍板' : agent.name}
        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', isGate ? 'bg-amber animate-pulse' : dotTone)}
      />
    </div>
  )
}

/** 审批卡里的产物缩略行（点击打开 Artifact 预览，由 DirectorApp 统一接管） */
function GateRow({ icon: Icon, label, onClick }: { icon: IconType; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="预览"
      className="group flex w-full items-center gap-2.5 rounded-xl border border-line/70 bg-surface/60 px-3 py-2 text-left transition-colors duration-300 hover:border-primary/25 hover:bg-surface-2/70"
    >
      <Icon size={14} strokeWidth={1.7} className="shrink-0 text-ink-mute" />
      <span className="min-w-0 flex-1 truncate text-[0.75rem] font-medium text-ink">{label}</span>
      <ArrowUpRight
        size={13}
        className="shrink-0 text-ink-mute transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary"
      />
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* 1. planning：计划确认                                                */
/* ------------------------------------------------------------------ */

function PlanningCard({
  title,
  plan,
  onConfirm,
  onCancel,
}: {
  title: string
  plan: MissionPlanTask[]
  onConfirm: () => void
  onCancel: () => void
}) {
  /* 执行成员 = 除总指挥外的去重成员；拍板次数 = 带审批门的环节数 */
  const memberCount = new Set(plan.filter((task) => task.agentId !== 'chief').map((task) => task.agentId)).size
  const gateCount = plan.filter((task) => GATE_STEP_IDS.has(task.id)).length

  return (
    <section data-testid="mission-plan" className="d-rise mx-auto w-full max-w-[620px] sm:pt-6">
      <div className="relative overflow-hidden rounded-[26px] border border-line/80 bg-surface/85 p-5 shadow-card backdrop-blur-xl sm:p-6">
        <span aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full bg-primary/10 blur-2xl" />
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-24 -left-16 h-40 w-40 rounded-full bg-amber/10 blur-2xl" />

        <div className="relative">
          <p className="text-[0.625rem] font-medium uppercase tracking-[0.18em] text-ink-mute">作战计划</p>
          <h1 className="mt-1.5 text-[1.375rem] font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Chip>{plan.length} 环节</Chip>
            <Chip tone="primary">{memberCount} 位成员</Chip>
            <Chip tone="amber">{gateCount} 次拍板</Chip>
          </div>

          <ul className="mt-4 divide-y divide-line/70 border-t border-line/70">
            {plan.map((task, index) => (
              <li key={task.id} className={cn('d-rise flex items-center gap-3 py-3', riseDelay(index))}>
                <AgentAvatar agentId={task.agentId} size="sm" />
                <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium text-ink">{task.title}</span>
                {GATE_STEP_IDS.has(task.id) && (
                  <span title="这一环节会停下来等你拍板" className={cn('inline-flex shrink-0', TONE.amber.text)}>
                    <ShieldCheck size={14} strokeWidth={1.9} />
                  </span>
                )}
                <span className="w-11 shrink-0 text-right text-[0.625rem] font-medium tabular-nums text-ink-mute">
                  ~{task.seconds}s
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line/70 pt-4">
            <SoftButton variant="primary" size="md" icon={Play} onClick={onConfirm}>
              开战
            </SoftButton>
            <SoftButton variant="ghost" size="md" onClick={onCancel}>
              先放着
            </SoftButton>
            <span className="ml-auto text-[0.6875rem] text-ink-mute" title="离开也没关系：回来只处理审批门">
              可以离开
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* 2 + 3. running / waiting：异步执行 + 审批门                          */
/* ------------------------------------------------------------------ */

function LiveRoom({
  mission,
  plan,
  onBack,
  onReset,
  onApprove,
  onReject,
  onOpenArtifact,
}: {
  mission: MissionState
  plan: MissionPlanTask[]
  onBack: () => void
  onReset: () => void
  onApprove: () => void
  onReject: () => void
  onOpenArtifact: (id: string) => void
}) {
  const waiting = mission.status === 'waiting'
  const feedRef = useRef<HTMLDivElement | null>(null)

  /* 动态流自动贴底；尊重 reduced-motion（直接跳转，不滚动动画） */
  useEffect(() => {
    const el = feedRef.current
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' })
    } else {
      el.scrollTop = el.scrollHeight
    }
  }, [mission.feed.length, mission.status])

  const doneTasks = new Set(mission.doneTasks)

  return (
    <div data-testid="mission-live" className="d-rise mx-auto w-full max-w-[900px]">
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
        <IconButton icon={ChevronLeft} label="回战情台" onClick={onBack} />
        <div className="flex min-w-0 items-center justify-center gap-2">
          <h1 className="truncate text-[0.9375rem] font-semibold tracking-tight text-ink sm:text-base">{mission.title}</h1>
          <Chip key={mission.status} tone={waiting ? 'amber' : 'primary'} dot className="d-fade shrink-0">
            {waiting ? '等你拍板' : '战队在跑'}
          </Chip>
        </div>
        <IconButton icon={RotateCcw} label="重来" onClick={onReset} />
      </header>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        {/* 进度卡：环承担主要信息，其余是极短一行字 + 五段环节条 */}
        <section className="d-rise d-delay-1 flex flex-col items-center justify-center gap-3 rounded-[26px] border border-line/80 bg-surface/80 p-5 shadow-card backdrop-blur-xl">
          <ProgressRing value={mission.progress} tone={waiting ? 'amber' : 'primary'} />
          <div
            className="flex items-center gap-1.5 text-[0.6875rem] font-medium text-ink-soft"
            title={waiting ? '只需这一次拍板，改完自动继续' : '后台托管中，回来只处理审批门'}
          >
            {waiting ? <Eye size={12} strokeWidth={1.8} className="text-ink-mute" /> : <Moon size={12} strokeWidth={1.8} className="text-ink-mute" />}
            {waiting ? '看一眼就好' : '你可以先离开'}
          </div>
          <div className="mt-0.5 flex w-full items-center gap-1.5">
            {plan.map((task) => (
              <span
                key={task.id}
                title={`${AGENT_MAP[task.agentId].name} · ${task.title}`}
                className={cn(
                  'h-1.5 flex-1 rounded-full transition-colors duration-500',
                  doneTasks.has(task.id) ? 'bg-primary' : 'bg-line',
                )}
              />
            ))}
          </div>
        </section>

        {/* 动态流：每条一行，最新在底部 */}
        <section className="d-rise d-delay-2 overflow-hidden rounded-[26px] border border-line/80 bg-surface/80 shadow-card backdrop-blur-xl">
          <div className="flex items-center justify-between px-4 pb-1 pt-3.5">
            <span className="text-[0.625rem] font-medium tracking-[0.16em] text-ink-mute">战队动态</span>
            <span
              className={cn('h-1.5 w-1.5 rounded-full', waiting ? 'bg-amber animate-pulse' : 'bg-mint animate-pulse')}
              title={waiting ? '已暂停，等你拍板' : '后台执行中'}
            />
          </div>
          <div
            ref={feedRef}
            aria-live="polite"
            aria-label="战队动态"
            className={cn(
              'd-scrollbar-thin overflow-y-auto px-2 pb-2',
              waiting ? 'max-h-[132px] sm:max-h-[156px]' : 'max-h-[200px] sm:max-h-[236px]',
            )}
          >
            {mission.feed.length === 0 ? (
              <p className="px-2 py-6 text-center text-[0.75rem] text-ink-mute">战队准备中</p>
            ) : (
              mission.feed.map((item) => <FeedRow key={item.id} item={item} />)
            )}
          </div>
        </section>
      </div>

      {/* 审批门：内联卡 + 呼吸光圈，只有这一件在等你 */}
      {waiting && mission.gate && (
        <div className="d-guide-ring mx-auto mt-3 w-full max-w-[560px] rounded-3xl sm:mt-4">
          <GateCard gate={mission.gate} onApprove={onApprove} onReject={onReject} onOpenArtifact={onOpenArtifact} />
        </div>
      )}

      <div className="mt-4 flex justify-center">
        <SoftButton variant="ghost" size="sm" onClick={onBack}>
          回战情台
        </SoftButton>
      </div>
    </div>
  )
}

function GateCard({
  gate,
  onApprove,
  onReject,
  onOpenArtifact,
}: {
  gate: MissionGate
  onApprove: () => void
  onReject: () => void
  onOpenArtifact: (id: string) => void
}) {
  const meta = GATE_META[gate]
  const agent = AGENT_MAP[meta.agentId]

  return (
    <section
      data-testid="mission-gate"
      data-gate={gate}
      role="group"
      aria-label={meta.title}
      className="d-sheet relative overflow-hidden rounded-3xl border border-amber/35 bg-surface/95 p-4 shadow-card backdrop-blur-xl sm:p-5"
    >
      <span aria-hidden="true" className="pointer-events-none absolute -right-12 -top-16 h-36 w-36 rounded-full bg-amber/15 blur-2xl" />

      <div className="relative">
        <div className="flex items-start gap-3">
          <AgentAvatar agentId={meta.agentId} size="md" status="waiting" breathing />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Chip tone="amber" dot>
                仅此一件
              </Chip>
              <span className="truncate text-[0.625rem] text-ink-mute">{agent.name}</span>
            </div>
            <h2 className="mt-1.5 truncate text-[1.0625rem] font-semibold tracking-tight text-ink sm:text-lg">{meta.title}</h2>
          </div>
        </div>

        <div className="mt-3 space-y-1.5">
          {meta.rows.map((row) => (
            <GateRow key={row.id} icon={row.icon} label={row.label} onClick={() => onOpenArtifact(row.id)} />
          ))}
        </div>

        <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-line/70 pt-3.5">
          <SoftButton variant="primary" size="md" onClick={onApprove}>
            {meta.primary}
          </SoftButton>
          <SoftButton variant="soft" size="md" onClick={onReject} title="退回重写这一段">
            改一改
          </SoftButton>
          {gate === 'speech' ? (
            <button
              type="button"
              onClick={onReject}
              title="退回重写（演示与「改一改」同一分支）"
              className="ml-auto rounded-full px-2 py-1 text-[0.6875rem] font-medium text-ink-mute transition-colors duration-300 hover:text-ink"
            >
              退回
            </button>
          ) : (
            <span className="ml-auto text-[0.6875rem] text-ink-mute" title="演示不会真实外发">
              仅登记
            </span>
          )}
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* 4. done：作战包交付                                                  */
/* ------------------------------------------------------------------ */

function ArtifactCard({
  tile,
  delayClass,
  onOpen,
}: {
  tile: ArtifactTile
  delayClass: string
  onOpen: () => void
}) {
  const agent = AGENT_MAP[tile.owner]
  const tone = TONE[agent.tone]
  const Icon = ARTIFACT_ICON[tile.kind]

  return (
    <button
      type="button"
      data-testid={`mission-artifact-${tile.id}`}
      onClick={onOpen}
      title={`打开 · ${agent.name}`}
      className={cn(
        'd-card d-rise group relative flex w-full flex-col items-start gap-3 rounded-2xl border border-line/80 bg-surface/85 p-4 text-left shadow-soft backdrop-blur-xl sm:p-5',
        delayClass,
      )}
    >
      <span className="flex w-full items-start justify-between">
        <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl ring-1', tone.soft, tone.ring)}>
          <Icon size={18} strokeWidth={1.7} className={tone.text} />
        </span>
        <ArrowUpRight
          size={15}
          className="text-ink-mute transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary"
        />
      </span>

      <span className="w-full">
        <span className="block truncate text-[0.875rem] font-medium text-ink">{tile.title}</span>
        <span className="mt-2.5 flex items-center" title={agent.name}>
          <AgentAvatar agentId={tile.owner} size="xs" />
        </span>
      </span>
    </button>
  )
}

function DonePackage({
  title,
  onBack,
  onReplay,
  onOpenArtifact,
}: {
  title: string
  onBack: () => void
  onReplay: () => void
  onOpenArtifact: (id: string) => void
}) {
  return (
    <div data-testid="mission-done" className="d-rise mx-auto w-full max-w-[880px]">
      <header>
        <div className="flex items-center gap-2">
          <span className="text-[0.625rem] font-medium uppercase tracking-[0.18em] text-ink-mute">作战包</span>
          <Chip tone="mint" dot>
            已交付
          </Chip>
        </div>
        <div className="mt-1.5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="truncate text-[1.375rem] font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
            <p className="mt-1 text-[0.6875rem] text-ink-mute">你只做了 2 个决定</p>
          </div>
          {/* 6 件交付 = 简报 / 发言稿 / PPT 大纲 / 家长信 ×3（演示口径） */}
          <div className="flex items-center gap-6 sm:gap-10">
            <StatCell value={6} label="件交付" tone="primary" />
            <StatCell value={GATE_STEP_IDS.size} label="次拍板" tone="mint" />
            <StatCell value={9} label="演示加速" suffix="s" tone="amber" />
          </div>
        </div>
      </header>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ARTIFACTS.map((tile, index) => (
          <ArtifactCard
            key={tile.id}
            tile={tile}
            delayClass={riseDelay(index)}
            onOpen={() => onOpenArtifact(tile.id)}
          />
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <SoftButton variant="primary" size="md" onClick={onBack}>
          回战情台
        </SoftButton>
        <SoftButton variant="ghost" size="md" onClick={onReplay}>
          再演一次
        </SoftButton>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 5. idle：理论不出现的空态                                            */
/* ------------------------------------------------------------------ */

function IdleState({ onBack }: { onBack: () => void }) {
  return (
    <div data-testid="mission-idle" className="d-fade flex min-h-[56vh] flex-col items-center justify-center gap-4 text-center">
      <AgentAvatar agentId="chief" size="lg" breathing />
      <p className="text-[0.8125rem] font-medium text-ink-soft">还没有作战</p>
      <SoftButton variant="soft" size="md" onClick={onBack}>
        回战情台
      </SoftButton>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 屏容器                                                               */
/* ------------------------------------------------------------------ */

export default function MissionSurface() {
  const mission = useDirectorStore((state) => state.mission)
  const confirmPlan = useDirectorStore((state) => state.confirmPlan)
  const cancelPlan = useDirectorStore((state) => state.cancelPlan)
  const approveGate = useDirectorStore((state) => state.approveGate)
  const rejectGate = useDirectorStore((state) => state.rejectGate)
  const openArtifact = useDirectorStore((state) => state.openArtifact)
  const setScreen = useDirectorStore((state) => state.setScreen)
  const resetDemo = useDirectorStore((state) => state.resetDemo)

  const backToInbox = () => setScreen('inbox')
  /* 计划以 store 为准；极端情况下回落到 data 常量，保证计划卡永不空 */
  const plan = mission.plan.length > 0 ? mission.plan : MISSION_PLAN

  return (
    <div data-testid="mission-surface" className="h-full w-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1120px] px-4 pb-36 pt-4 sm:px-6 sm:pb-28 sm:pt-6">
        {mission.status === 'planning' && (
          <PlanningCard title={mission.title} plan={plan} onConfirm={confirmPlan} onCancel={cancelPlan} />
        )}

        {(mission.status === 'running' || mission.status === 'waiting') && (
          <LiveRoom
            mission={mission}
            plan={plan}
            onBack={backToInbox}
            onReset={resetDemo}
            onApprove={approveGate}
            onReject={rejectGate}
            onOpenArtifact={openArtifact}
          />
        )}

        {mission.status === 'done' && (
          <DonePackage
            title={mission.title}
            onBack={backToInbox}
            onReplay={resetDemo}
            onOpenArtifact={openArtifact}
          />
        )}

        {mission.status === 'idle' && <IdleState onBack={backToInbox} />}
      </div>
    </div>
  )
}
