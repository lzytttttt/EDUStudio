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
  BookOpenCheck,
  ChevronLeft,
  ClipboardList,
  Eye,
  FileCheck,
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
import { AGENT_MAP, MISSION_TEMPLATES } from '../../harness/director/data'
import { PLAN_REASON_LABELS } from '../../harness/director/planner'
import type {
  ArtifactTile,
  DirectorAgentId,
  FeedItem,
  GateId,
  MissionPlanTask,
  MissionState,
  MissionTemplate,
  PlanSource,
  Tone,
} from '../../harness/director/types'
import { useDirectorStore } from '../../stores/directorStore'
import { AgentAvatar, Chip, IconButton, SoftButton, StatCell, TONE } from './shared'

type IconType = ComponentType<{ size?: number | string; className?: string; strokeWidth?: number | string }>

/** 计划中带审批门的环节由 plan.tasks 派生（v1.1：不写死 t2/t3） */
/** 逐行浮现：director.css 已提供 d-delay-1..8 */
const RISE_DELAYS = ['d-delay-1', 'd-delay-2', 'd-delay-3', 'd-delay-4', 'd-delay-5', 'd-delay-6', 'd-delay-7', 'd-delay-8'] as const
const riseDelay = (index: number): string => RISE_DELAYS[Math.min(index, RISE_DELAYS.length - 1)]

const ARTIFACT_ICON: Record<ArtifactTile['kind'], IconType> = {
  简报: BarChart3,
  讲稿: Megaphone,
  大纲: ListTree,
  信件: Mail,
  练习单: ClipboardList,
  教案: BookOpenCheck,
  摘要: FileCheck,
}

const GATE_META: Record<
  GateId,
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
  worksheet: {
    agentId: 'assessor',
    title: '分层练习待过目',
    primary: '放行',
    rows: [{ id: 'a-drill', label: '分层练习单 · 12 题', icon: ClipboardList }],
  },
  lesson: {
    agentId: 'curriculum',
    title: '习题课教案待过目',
    primary: '放行',
    rows: [{ id: 'a-lesson', label: '习题课教案 · 45 分钟', icon: BookOpenCheck }],
  },
}

/** 计划来源角标（roadmap §4.5）：模板兜底必须可见；reason 文案复用 planner 的映射表 */
const planReasonText = (reason?: string): string => (reason ? PLAN_REASON_LABELS[reason] ?? reason : '')

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
          style={{ transition: 'stroke-dasharray 240ms cubic-bezier(.22,1,.36,1), stroke 160ms ease' }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex items-baseline gap-0.5">
          <span className="d-num text-[1.375rem] font-semibold leading-none text-ink sm:text-2xl">{safe}</span>
          <span className="text-[0.6875rem] font-medium text-ink-soft">%</span>
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
      title={`${agent.name} · ${clock} · ${item.text}`}
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
      className="group flex min-h-[40px] w-full items-center gap-2.5 rounded-xl border border-line/70 bg-surface/60 px-3 py-2 text-left transition-colors duration-300 hover:border-primary/25 hover:bg-surface-2/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <Icon size={14} strokeWidth={1.7} className="shrink-0 text-ink-soft" />
      <span className="min-w-0 flex-1 truncate text-[0.75rem] font-medium text-ink">{label}</span>
      <ArrowUpRight
        size={14}
        className="shrink-0 text-ink-soft transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary"
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
  planSource,
  planReason,
  onConfirm,
  onCancel,
}: {
  title: string
  plan: MissionPlanTask[]
  planSource: PlanSource
  planReason?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  /* 执行成员 = 除总指挥外的去重成员；拍板次数 = 带审批门的环节数（从计划派生） */
  const memberCount = new Set(plan.filter((task) => task.agentId !== 'chief').map((task) => task.agentId)).size
  const gateCount = plan.filter((task) => task.gate).length

  return (
    <section data-testid="mission-plan" className="d-rise mx-auto w-full max-w-[720px]">
      <div className="relative overflow-hidden rounded-[26px] border border-line/80 bg-surface/85 p-5 shadow-card backdrop-blur-xl sm:p-6">
        <span aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full bg-primary/10 blur-2xl" />
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-24 -left-16 h-40 w-40 rounded-full bg-amber/10 blur-2xl" />

        <div className="relative">
          <p className="text-[0.6875rem] font-medium uppercase tracking-[0.18em] text-ink-soft">作战计划</p>
          <h1 className="mt-1.5 text-[1.375rem] font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Chip>{plan.length} 环节</Chip>
            <Chip tone="primary">{memberCount} 位成员</Chip>
            <Chip tone="amber">{gateCount} 次拍板</Chip>
            <span
              data-testid="plan-source"
              title={planSource === 'llm' ? '本次计划由真模型拆解' : '本次计划使用本地模板兜底'}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ring-1',
                planSource === 'llm'
                  ? 'bg-mint-soft text-mint-ink ring-mint/30'
                  : 'bg-surface-2 text-ink-soft ring-line',
              )}
            >
              <span aria-hidden className={cn('h-1 w-1 rounded-full', planSource === 'llm' ? 'bg-mint' : 'bg-ink-mute')} />
              {planSource === 'llm' ? '真 LLM' : '模板兜底'}
              {planSource !== 'llm' && planReason && (
                <span data-testid="plan-reason" className="font-normal text-ink-soft">
                  · {planReasonText(planReason)}
                </span>
              )}
            </span>
          </div>

          <ul className="mt-4 divide-y divide-line/70 border-t border-line/70">
            {plan.map((task, index) => (
              <li key={task.id} className={cn('d-rise flex items-center gap-3 py-2.5 sm:py-3', riseDelay(index))}>
                <AgentAvatar agentId={task.agentId} size="sm" />
                <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium text-ink">{task.title}</span>
                {task.gate && (
                  <span title="这一环节会停下来等你拍板" className={cn('inline-flex shrink-0', TONE.amber.text)}>
                    <ShieldCheck size={14} strokeWidth={1.9} />
                  </span>
                )}
                <span className="w-11 shrink-0 text-right text-[0.6875rem] font-medium tabular-nums text-ink-soft">
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
            <span className="ml-auto text-[0.6875rem] text-ink-soft" title="离开也没关系：回来只处理审批门">
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
  onResume,
  onApprove,
  onReject,
  onOpenArtifact,
}: {
  mission: MissionState
  plan: MissionPlanTask[]
  onBack: () => void
  onReset: () => void
  onResume: () => void
  onApprove: () => void
  onReject: () => void
  onOpenArtifact: (id: string) => void
}) {
  const waiting = mission.status === 'waiting'
  const paused = mission.status === 'paused'
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
      {/* a11y：审批门出现时给读屏播报一次（视觉上隐藏，不占正文） */}
      <p className="sr-only" role="status" aria-live="polite">
        {waiting ? '1 件待拍板' : ''}
      </p>
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
        <IconButton icon={ChevronLeft} label="回战情台" onClick={onBack} />
        <div className="flex min-w-0 items-center justify-center gap-2">
          <h1 className="truncate text-[0.9375rem] font-semibold tracking-tight text-ink sm:text-base">{mission.title}</h1>
          <Chip key={mission.status} tone={waiting || paused ? 'amber' : 'primary'} dot className="d-fade shrink-0">
            {waiting ? '等你拍板' : paused ? '已暂停' : '战队在跑'}
          </Chip>
        </div>
        <IconButton icon={RotateCcw} label="重来" onClick={onReset} />
      </header>

      {/* V2：右列固定 640，审批卡/暂停卡与右列同宽对齐（左列进度卡自适应） */}
      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,640px)]">
        {/* 进度卡：环承担主要信息，其余是极短一行字 + 五段环节条 */}
        <section className="d-rise d-delay-1 flex flex-col items-center justify-center gap-3 rounded-[26px] border border-line/80 bg-surface/80 p-5 shadow-card backdrop-blur-xl">
          <ProgressRing value={mission.progress} tone={waiting || paused ? 'amber' : 'primary'} />
          <div
            className="flex items-center gap-1.5 text-[0.6875rem] font-medium text-ink-soft"
            title={waiting ? '只需这一次拍板，改完自动继续' : paused ? '刷新后已暂停；点继续从断点接着跑' : '后台托管中，回来只处理审批门'}
          >
            {waiting ? <Eye size={14} strokeWidth={1.8} className="text-ink-soft" /> : <Moon size={14} strokeWidth={1.8} className="text-ink-soft" />}
            {waiting ? '看一眼就好' : paused ? '进度已保存' : '你可以先离开'}
          </div>
          <div className="mt-0.5 flex w-full items-center gap-1.5">
            {plan.map((task) => (
              <span
                key={task.id}
                title={`${AGENT_MAP[task.agentId].name} · ${task.title}`}
                className={cn(
                  'h-1.5 flex-1 rounded-full transition-colors duration-300',
                  doneTasks.has(task.id) ? 'bg-primary' : 'bg-line',
                )}
              />
            ))}
          </div>
        </section>

        {/* 动态流：每条一行，最新在底部 */}
        <section className="d-rise d-delay-2 overflow-hidden rounded-[26px] border border-line/80 bg-surface/80 shadow-card backdrop-blur-xl">
          <div className="flex items-center justify-between px-4 pb-1 pt-3.5">
            <span className="text-[0.6875rem] font-medium tracking-[0.16em] text-ink-soft">战队动态</span>
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                waiting ? 'bg-amber animate-pulse' : paused ? 'bg-ink-mute' : 'bg-mint animate-pulse',
              )}
              title={waiting ? '已暂停，等你拍板' : paused ? '已暂停，进度已保存' : '后台执行中'}
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
              <p className="px-2 py-6 text-center text-[0.75rem] text-ink-soft">战队准备中</p>
            ) : (
              mission.feed.map((item) => <FeedRow key={item.id} item={item} />)
            )}
          </div>
        </section>
      </div>

      {/* v1.1：刷新后 running → paused；点继续从断点续跑，不重放已完成 feed。
          V2：暂停卡与右列（640）同宽对齐，不再居中漂移。 */}
      {paused && (
        <div className="mt-3 grid gap-3 lg:mt-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,640px)]">
          <section
            data-testid="mission-paused"
            role="group"
            aria-label="已暂停"
            className="d-sheet rounded-3xl border border-amber/35 bg-surface/95 p-4 shadow-card backdrop-blur-xl sm:p-5 lg:col-start-2"
          >
            <div className="flex items-start gap-3">
              <AgentAvatar agentId="chief" size="md" status="waiting" breathing />
              <div className="min-w-0 flex-1">
                <p className="text-[0.6875rem] text-ink-soft">页面刷新后已暂停 · 进度已保留</p>
                <h2 className="mt-1 text-[1.0625rem] font-semibold tracking-tight text-ink sm:text-lg">已暂停 · 继续</h2>
              </div>
            </div>
            <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-line/70 pt-3.5">
              <SoftButton variant="primary" size="md" icon={Play} onClick={onResume}>
                继续
              </SoftButton>
              <span className="ml-auto text-[0.6875rem] text-ink-soft" title="不重跑已完成的环节">
                不重跑已完成环节
              </span>
            </div>
          </section>
        </div>
      )}

      {/* 审批门：内联卡 + 呼吸光圈，只有这一件在等你；卡宽与右列 640 对齐 */}
      {waiting && mission.gate && (
        <div className="mt-3 grid gap-3 lg:mt-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,640px)]">
          <div className="d-guide-ring rounded-3xl lg:col-start-2">
            <GateCard gate={mission.gate} onApprove={onApprove} onReject={onReject} onOpenArtifact={onOpenArtifact} />
          </div>
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
  gate: GateId
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
              <span className="truncate text-[0.6875rem] text-ink-soft">{agent.name}</span>
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
          <span className="ml-auto text-[0.6875rem] text-ink-soft" title="演示不会真实外发">
            {gate === 'letters' ? '仅登记' : '改完自动继续'}
          </span>
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
  layoutClass,
  onOpen,
}: {
  tile: ArtifactTile
  delayClass: string
  layoutClass?: string
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
        /* V3：卡内 ≥2 行信息（标题 + 归属/类型），lg 3 列 */
        'd-card d-rise group relative flex w-full flex-col items-start gap-3 rounded-2xl border border-line/80 bg-surface/85 p-4 text-left shadow-soft backdrop-blur-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 sm:p-5',
        delayClass,
        layoutClass,
      )}
    >
      <span className="flex w-full items-start justify-between">
        <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl ring-1', tone.soft, tone.ring)}>
          <Icon size={18} strokeWidth={1.7} className={tone.text} aria-hidden />
        </span>
        <ArrowUpRight
          size={14}
          aria-hidden
          className="text-ink-soft transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary"
        />
      </span>

      <span className="w-full">
        <span className="block line-clamp-2 text-[0.875rem] font-medium leading-snug text-ink">{tile.title}</span>
        <span className="mt-2 flex items-center gap-2" title={agent.name}>
          <AgentAvatar agentId={tile.owner} size="xs" />
          <span className="truncate text-[0.6875rem] text-ink-soft">
            {agent.name} · {tile.kind}
          </span>
        </span>
      </span>
    </button>
  )
}

function DonePackage({
  title,
  template,
  onBack,
  onReplay,
  onOpenArtifact,
}: {
  title: string
  template: MissionTemplate
  onBack: () => void
  onReplay: () => void
  onOpenArtifact: (id: string) => void
}) {
  return (
    <div data-testid="mission-done" className="d-rise mx-auto w-full max-w-[880px]">
      <header>
        <div className="flex items-center gap-2">
          <span className="text-[0.6875rem] font-medium uppercase tracking-[0.18em] text-ink-soft">作战包</span>
          <Chip tone="mint" dot>
            已交付
          </Chip>
        </div>
        <div className="mt-1.5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="truncate text-[1.375rem] font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
            <p className="mt-1 text-[0.6875rem] text-ink-soft">你只做了 {template.meta.decisions} 个决定</p>
          </div>
          {/* v1.1：统计一律取模板 meta，数字 = 可点卡数（V3） */}
          <div className="flex items-center gap-6 sm:gap-10">
            <StatCell value={template.artifacts.length} label="件交付" tone="primary" />
            <StatCell value={template.gates.length} label="次拍板" tone="mint" />
            <StatCell value={template.meta.demoSeconds} label="演示加速" suffix="s" tone="amber" />
          </div>
        </div>
      </header>

      {/* V3：lg 3 列；4 卡时最后一张居中到中列，避免落单左对齐 */}
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {template.artifacts.map((tile, index) => (
          <ArtifactCard
            key={tile.id}
            tile={tile}
            delayClass={riseDelay(index)}
            layoutClass={template.artifacts.length === 4 && index === 3 ? 'lg:col-start-2' : undefined}
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
  const resumeMission = useDirectorStore((state) => state.resumeMission)
  const openArtifact = useDirectorStore((state) => state.openArtifact)
  const setScreen = useDirectorStore((state) => state.setScreen)
  const resetDemo = useDirectorStore((state) => state.resetDemo)

  const backToInbox = () => setScreen('inbox')
  /* 剧本模板：交付物 / 统计 / 计划都按 mission.kind 取；计划极端为空时回落模板计划 */
  const template = MISSION_TEMPLATES[mission.kind]
  const plan = mission.plan.length > 0 ? mission.plan : template.plan

  return (
    <div data-testid="mission-surface" className="d-scrollbar-thin h-full w-full overflow-y-auto">
      <div
        className={cn(
          'mx-auto flex min-h-full w-full max-w-[1120px] flex-col px-4 sm:px-6',
          /* V6：滚动区底部让出 dock（≈52px）+ 安全区 + 24px */
          'pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:pb-28',
          /* V1：作战室首屏 56px 顶距，toast（top-4.75rem）不压 H1 */
          'pt-14',
          /* V3/V4：内容不足一屏时垂直居中（计划卡、live 区、done 均适用） */
          'justify-center',
        )}
      >
        {mission.status === 'planning' && (
          <PlanningCard
            title={mission.title}
            plan={plan}
            planSource={mission.planSource}
            planReason={mission.planReason}
            onConfirm={confirmPlan}
            onCancel={cancelPlan}
          />
        )}

        {(mission.status === 'running' || mission.status === 'waiting' || mission.status === 'paused') && (
          <LiveRoom
            mission={mission}
            plan={plan}
            onBack={backToInbox}
            onReset={resetDemo}
            onResume={resumeMission}
            onApprove={approveGate}
            onReject={rejectGate}
            onOpenArtifact={openArtifact}
          />
        )}

        {mission.status === 'done' && (
          <DonePackage
            title={mission.title}
            template={template}
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
