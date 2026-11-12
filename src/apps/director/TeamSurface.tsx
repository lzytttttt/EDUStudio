/**
 * 战队（Team）—— v1.0「总指挥模式」原型
 *
 * 少字策略：
 * - 周报只留 3 个数字；成员卡只留 名字 / 岗位 / 2 个专长 / 1 行战绩；
 * - 状态交给头像上的点与颜色，不写状态句；
 * - 授权是这一屏唯一「厚」交互：4 段滑杆点一下即生效，其余解释交给 GuideBar 与 toast；
 * - 全局唯一的说明句是详情里的 boundary。
 */
import { useState } from 'react'
import { Check, ChevronRight, Lock, Sparkles, Target, type LucideIcon } from 'lucide-react'
import { AGENTS, AGENT_MAP, WEEKLY } from '../../harness/director/data'
import type {
  AgentProfile,
  AutonomyLevel,
  DirectorAgentId,
  GateId,
  MissionState,
  Tone,
} from '../../harness/director/types'
import { useDirectorStore } from '../../stores/directorStore'
import { cn } from '../../lib/cn'
import { AgentAvatar, Chip, Sheet, StatCell, TONE, type AgentStatus } from './shared'

/** 4 档授权的短词与色调：L0 只建议 → L3 全权 */
const AUTONOMY_ORDER: AutonomyLevel[] = ['L0', 'L1', 'L2', 'L3']
const AUTONOMY: Record<AutonomyLevel, { word: string; tone: Tone }> = {
  L0: { word: '只建议', tone: 'graphite' },
  L1: { word: '草稿', tone: 'amber' },
  L2: { word: '代办', tone: 'primary' },
  L3: { word: '全权', tone: 'mint' },
}

/** 审批门 → 被卡住的成员（与 store.rejectGate 的归因保持一致；M3 起统一由 data.ts 导出） */
const GATE_OWNER: Record<GateId, DirectorAgentId> = {
  speech: 'curriculum',
  letters: 'communicator',
  worksheet: 'assessor',
  lesson: 'curriculum',
}

/** 任何等级下都不能自动越过的边界；锁提示只出现在详情，卡片保持干净 */
const LOCK_HINT: Partial<Record<DirectorAgentId, string>> = {
  communicator: '发送仍需你拍板',
  steward: '对外回执仍需拍板',
}

const STATUS_TEXT: Record<AgentStatus, string> = {
  idle: '空闲',
  running: '执行中',
  waiting: '待你拍板',
  done: '已完成',
}

/** 状态只用颜色表达：被门卡住 → waiting；最近 4 条动态里出现 → running；否则 idle */
function agentStatus(agentId: DirectorAgentId, mission: MissionState): AgentStatus {
  if (mission.gate && GATE_OWNER[mission.gate] === agentId) return 'waiting'
  if (mission.status !== 'running') return 'idle'
  const recent = mission.feed.slice(-4)
  return recent.some((item) => item.agentId === agentId && item.kind === 'step') ? 'running' : 'idle'
}

export default function TeamSurface() {
  const autonomy = useDirectorStore((s) => s.autonomy)
  const mission = useDirectorStore((s) => s.mission)
  const setAutonomy = useDirectorStore((s) => s.setAutonomy)
  const toast = useDirectorStore((s) => s.toast)
  const [activeId, setActiveId] = useState<DirectorAgentId | null>(null)

  const activeAgent = activeId ? AGENT_MAP[activeId] : null
  const onDuty = AGENTS.filter((agent) => agentStatus(agent.id, mission) !== 'idle').length

  return (
    <div className="d-scrollbar-thin h-full w-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1120px] px-4 pb-36 pt-6 sm:px-6 sm:pb-28 sm:pt-8">
        {/* ① 周报条：一行小字 + 三个大数字，不做图表墙 */}
        <section
          aria-label="本周周报"
          className="d-rise flex items-center justify-between gap-3 rounded-[22px] bg-surface/75 px-4 py-3 shadow-soft backdrop-blur-sm sm:px-6 sm:py-4"
        >
          <span className="inline-flex items-center gap-1.5 text-[0.625rem] font-medium tracking-[0.18em] text-ink-mute">
            <Sparkles size={12} strokeWidth={1.9} className="text-primary" aria-hidden />
            本周
          </span>
          <div className="flex items-center gap-5 sm:gap-8">
            <StatCell value={WEEKLY.done} label="完成" tone="primary" />
            <StatCell value={WEEKLY.acceptRate} suffix="%" label="采纳" tone="mint" />
            <StatCell value={WEEKLY.savedHours} suffix="h" label="省时" tone="amber" />
          </div>
        </section>

        {/* ② 成员网格：桌面 3 列 / 平板 2 列 / 手机 1 列 */}
        <section className="mt-5 sm:mt-6" aria-label="战队成员">
          <div className="mb-2.5 flex items-baseline justify-between px-1">
            <h2 className="text-[0.6875rem] font-medium tracking-[0.18em] text-ink-mute">战队</h2>
            <span className="d-num text-[0.625rem] text-ink-mute">
              {onDuty > 0 ? `${onDuty} 在办` : `${AGENTS.length} 人`}
            </span>
          </div>

          <div
            data-guide="roster"
            className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 lg:gap-5"
          >
            {AGENTS.map((agent, index) => {
              const level = autonomy[agent.id]
              const status = agentStatus(agent.id, mission)
              return (
                <div key={agent.id} className={cn('d-rise', `d-delay-${index + 1}`)}>
                  <button
                    type="button"
                    onClick={() => setActiveId(agent.id)}
                    data-testid={`team-agent-${agent.id}`}
                    aria-haspopup="dialog"
                    aria-label={`${agent.name} · ${agent.role} · 授权 ${level} · ${STATUS_TEXT[status]} · 打开详情`}
                    className={cn(
                      'd-card group flex h-full w-full flex-col rounded-[26px] bg-surface/90 p-5 text-left shadow-card-next',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45',
                      status === 'waiting' && 'ring-1 ring-amber/35',
                      status === 'running' && 'ring-1 ring-primary/20',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <AgentAvatar
                        agentId={agent.id}
                        size="lg"
                        status={status}
                        breathing={status === 'running'}
                      />
                      <span title={`授权 ${level} · ${AUTONOMY[level].word}`} className="mt-0.5 shrink-0">
                        <AutonomyChip level={level} />
                      </span>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <span className="text-[0.9375rem] font-semibold tracking-tight text-ink">
                        {agent.name}
                      </span>
                      <Chip tone={agent.tone}>{agent.role}</Chip>
                    </div>

                    <div className="mt-auto flex flex-wrap items-end justify-between gap-x-3 gap-y-2 pt-4">
                      <span className="flex flex-wrap gap-1.5">
                        {agent.expertise.map((word) => (
                          <span
                            key={word}
                            className="rounded-full bg-surface-2 px-2 py-0.5 text-[0.625rem] font-medium text-ink-soft"
                          >
                            {word}
                          </span>
                        ))}
                      </span>
                      <span className="d-num flex shrink-0 items-center gap-2 text-[0.6875rem] font-semibold text-ink-mute">
                        <span className="inline-flex items-center gap-1">
                          <Check size={12} className="text-mint" strokeWidth={2.8} aria-hidden />
                          {agent.stats.done}
                        </span>
                        <span aria-hidden className="h-3 w-px bg-line" />
                        <span className="inline-flex items-center gap-1">
                          <Target size={12} strokeWidth={2} aria-hidden />
                          {agent.stats.rate}%
                        </span>
                      </span>
                    </div>
                  </button>
                </div>
              )
            })}
          </div>
        </section>

        {/* ④ 本周复盘：一条紧凑行，点一下只记一笔，不做新页面 */}
        <div className="d-rise d-delay-7 mt-5">
          <button
            type="button"
            onClick={() => toast('已记录', 'mint')}
            data-testid="team-weekly-review"
            className="group flex min-h-[44px] w-full items-center justify-between gap-3 rounded-2xl bg-surface/60 px-4 py-3 text-left shadow-soft transition-colors duration-300 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none"
          >
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.75rem]">
              <span className="font-medium text-ink">本周复盘</span>
              <span className="text-ink-mute">
                退回 {WEEKLY.declined} 次 · 主因：语气
              </span>
            </span>
            <ChevronRight
              size={15}
              strokeWidth={2}
              aria-hidden
              className="shrink-0 text-ink-mute transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none"
            />
          </button>
        </div>
      </div>

      {/* ③ 成员详情：唯一的说明句 + 4 段授权滑杆 */}
      <Sheet open={activeAgent !== null} onClose={() => setActiveId(null)} label="成员">
        {activeAgent && (
          <AgentDetail
            agent={activeAgent}
            level={autonomy[activeAgent.id]}
            status={agentStatus(activeAgent.id, mission)}
            onSetLevel={(level) => setAutonomy(activeAgent.id, level)}
          />
        )}
      </Sheet>
    </div>
  )
}

function AgentDetail({
  agent,
  level,
  status,
  onSetLevel,
}: {
  agent: AgentProfile
  level: AutonomyLevel
  status: AgentStatus
  onSetLevel: (level: AutonomyLevel) => void
}) {
  const index = AUTONOMY_ORDER.indexOf(level)
  const lockHint = LOCK_HINT[agent.id]

  return (
    <div data-testid="team-detail" className="pt-1">
      {/* 头部：头像 + 名字 + 岗位 + 当前授权 */}
      <div className="flex items-center gap-3">
        <AgentAvatar agentId={agent.id} size="lg" status={status} breathing={status === 'running'} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[1.0625rem] font-semibold leading-tight tracking-tight text-ink">
              {agent.name}
            </span>
            <Chip tone={agent.tone}>{agent.role}</Chip>
          </div>
        </div>
        <AutonomyChip level={level} word className="shrink-0 px-2.5 py-1 text-[0.6875rem]" />
      </div>

      {/* 详情页唯一允许的一句说明（≤30 字） */}
      <p className="mt-4 text-[0.6875rem] leading-relaxed text-ink-mute">{agent.boundary}</p>

      {/* 授权滑杆：4 段，点选即生效；白色 pill 滑动 + 颜色渐入 */}
      <section className="mt-6" aria-label="授权等级设置">
        <div className="mb-2 flex min-h-[22px] items-center justify-between gap-2">
          <h3 className="text-[0.6875rem] font-medium tracking-[0.18em] text-ink-mute">授权</h3>
          {lockHint && (
            <Chip tone="coral" className="gap-1 px-2 py-0.5 text-[0.625rem]">
              <Lock size={10} strokeWidth={2.4} aria-hidden />
              {lockHint}
            </Chip>
          )}
        </div>

        <div role="radiogroup" aria-label="授权等级" className="relative rounded-full bg-surface-2 p-1">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-1 left-1 rounded-full bg-surface shadow-soft ring-1 ring-line/60 transition-transform duration-300 ease-out motion-reduce:transition-none"
            style={{ width: 'calc(25% - 2px)', transform: `translateX(${index * 100}%)` }}
          />
          <div className="relative grid grid-cols-4">
            {AUTONOMY_ORDER.map((option) => {
              const selected = option === level
              const meta = AUTONOMY[option]
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`${option} · ${meta.word}`}
                  data-testid={`team-autonomy-${option}`}
                  onClick={() => onSetLevel(option)}
                  className={cn(
                    'relative flex h-11 flex-col items-center justify-center gap-0.5 rounded-full',
                    'transition-colors duration-300 motion-reduce:transition-none',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                    selected ? TONE[meta.tone].text : 'text-ink-mute hover:text-ink-soft',
                  )}
                >
                  <span className="text-[0.5625rem] font-medium tracking-[0.14em] opacity-70">
                    {option}
                  </span>
                  <span className="text-[0.6875rem] font-semibold">{meta.word}</span>
                </button>
              )
            })}
          </div>
        </div>
      </section>

      {/* 战绩：两个小数字 */}
      <div className="mt-5 grid grid-cols-2 gap-2.5">
        <MiniStat icon={Check} value={agent.stats.done} label="产出" tone="mint" />
        <MiniStat icon={Target} value={`${agent.stats.rate}%`} label="一次通过" tone={agent.tone} />
      </div>
    </div>
  )
}

/** 小号授权徽标：L0-L3，色调随等级 */
function AutonomyChip({
  level,
  word = false,
  className,
}: {
  level: AutonomyLevel
  word?: boolean
  className?: string
}) {
  const meta = AUTONOMY[level]
  return (
    <Chip tone={meta.tone} className={cn('px-2 py-0.5 text-[0.625rem] font-semibold', className)}>
      {level}
      {word && <span className="font-normal opacity-75">{meta.word}</span>}
    </Chip>
  )
}

function MiniStat({
  icon: Icon,
  value,
  label,
  tone,
}: {
  icon: LucideIcon
  value: string | number
  label: string
  tone: Tone
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-2xl bg-surface-2/70 px-3 py-2.5">
      <Icon size={15} strokeWidth={2} className={TONE[tone].text} aria-hidden />
      <div className="flex items-baseline gap-1.5">
        <span className="d-num text-[1.0625rem] font-semibold leading-none text-ink">{value}</span>
        <span className="text-[0.625rem] text-ink-mute">{label}</span>
      </div>
    </div>
  )
}
