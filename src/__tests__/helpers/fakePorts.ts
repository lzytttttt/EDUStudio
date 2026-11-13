/**
 * v1.2 M0 · DirectorPorts 测试替身（roadmap §3.10 可测试性）
 *
 * 8 个端口全部给最小可运行实现：返回可断言的固定值 / 空数组，写操作只记录不产生副作用；
 * `navigate` 用内存 NavigatorEnv（不依赖 window.history），并记录 open 的 target。
 * 只供测试使用（src/__tests__/helpers，不进入主 chunk / 不进生产代码）。
 */

import type { BriefingCard, MemoryEntry, RoleId } from '../../harness/types'
import type {
  AgentProfile,
  AutonomyLevel,
  DirectorAgentId,
  Fact,
  MissionPlanTask,
} from '../../harness/director/types'
import type {
  AgentMemoryEntry,
  AgentSpec,
  ArtifactRef,
  DecisionNotice,
  DeliverableDraft,
  DirectorPorts,
  ExecutionPlan,
  FactSnapshot,
  IntakeInput,
  MissionRunEvent,
  Navigator,
  ToastKind,
  WorkTarget,
} from '../../studio/contracts'
import { DIRECTOR_AGENT_IDS } from '../../studio/contracts'
import { createNavigator, type NavigatorEnv } from '../../studio/navigator'
import type { ExportFormat } from '../../lib/exporters'

/* ------------------------------------------------------------------ */
/* 内存导航环境（不依赖 window.history）                                */
/* ------------------------------------------------------------------ */

export interface MemoryNavigatorEnv extends NavigatorEnv {
  /** 写入历史（按发生顺序，含 back 事件；测试断言 push/replace 语义用） */
  entries: { type: 'push' | 'replace' | 'back'; url: string }[]
  /** 最近一次写入的 history.state（形如 `{ route }`） */
  state: unknown
}

export function createMemoryNavigatorEnv(initialLocation = '/'): MemoryNavigatorEnv {
  let location = initialLocation
  const env: MemoryNavigatorEnv = {
    entries: [],
    state: null,
    getLocation: () => location,
    pushState(state, url) {
      env.state = state
      location = url
      env.entries.push({ type: 'push', url })
    },
    replaceState(state, url) {
      env.state = state
      location = url
      env.entries.push({ type: 'replace', url })
    },
    back() {
      env.entries.push({ type: 'back', url: location })
    },
  }
  return env
}

/* ------------------------------------------------------------------ */
/* 调用记录                                                            */
/* ------------------------------------------------------------------ */

export interface FakePortCalls {
  intakes: IntakeInput[]
  confirmed: string[]
  startedMissions: string[]
  /** execution.start 通过 sink 产出的运行事件（按 seq 顺序） */
  runEvents: MissionRunEvent[]
  resumed: string[]
  cancelled: string[]
  published: DeliverableDraft[]
  opened: ArtifactRef[]
  exported: { ref: ArtifactRef; format: ExportFormat }[]
  shared: ArtifactRef[]
  snapshots: RoleId[]
  verifications: { markdown: string; snapshot: FactSnapshot }[]
  agentMemory: AgentMemoryEntry[]
  teacherFeedback: MemoryEntry[]
  granted: { agentId: DirectorAgentId; level: AutonomyLevel }[]
  decisions: DecisionNotice[]
  toasts: { text: string; kind?: ToastKind }[]
  navigations: WorkTarget[]
}

export interface FakePorts extends DirectorPorts {
  calls: FakePortCalls
  /** navigate 端口共用的内存环境（可断言实际写入的 URL） */
  navEnv: MemoryNavigatorEnv
}

/* ------------------------------------------------------------------ */
/* 固定夹具                                                            */
/* ------------------------------------------------------------------ */

export const FAKE_FACT: Fact = {
  factId: 'f-avg',
  key: 'physics.avg',
  value: 80.4,
  unit: '分',
  label: '物理单元考均分',
  source: '学情库 · 高一（3）班 · 单元考',
  asOf: '2026-11-06',
  derived: true,
}

export function createFakeFactSnapshot(overrides: Partial<FactSnapshot> = {}): FactSnapshot {
  return {
    missionId: 'm-fake',
    role: 'teacher',
    takenAt: 1760000000000,
    facts: [FAKE_FACT],
    ...overrides,
  }
}

const AGENT_META: Record<DirectorAgentId, { name: string; role: string; tone: AgentProfile['tone'] }> = {
  chief: { name: '总指挥', role: '统筹', tone: 'primary' },
  analyst: { name: '学情分析', role: '分析', tone: 'mint' },
  assessor: { name: '评测', role: '评测', tone: 'amber' },
  curriculum: { name: '课程设计', role: '备课', tone: 'coral' },
  communicator: { name: '沟通', role: '沟通', tone: 'primary' },
  steward: { name: '班务', role: '班务', tone: 'graphite' },
}

/** 6 名战队成员（字段与 §3.6 / v1.1 AgentProfile 一致） */
export function createFakeRoster(): AgentProfile[] {
  return DIRECTOR_AGENT_IDS.map((id) => ({
    id,
    name: AGENT_META[id].name,
    role: AGENT_META[id].role,
    tone: AGENT_META[id].tone,
    expertise: ['学情', '材料'],
    autonomy: 'L2',
    stats: { done: 0, rate: 0 },
    boundary: '只准备材料，不对外发送',
  }))
}

/** 6 个 AgentSpec（ExecutionPlan.agentSpecs 用） */
export function createFakeAgentSpecs(): Record<DirectorAgentId, AgentSpec> {
  const specs = {} as Record<DirectorAgentId, AgentSpec>
  for (const id of DIRECTOR_AGENT_IDS) {
    specs[id] = {
      id,
      name: AGENT_META[id].name,
      baseRole: 'inherit',
      tools: [],
      memoryNs: `teacher.agent.${id}`,
      skillNs: `teacher.agent.${id}.skill`,
      autonomy: { default: 'L2' },
      notDo: '不对外发送',
    }
  }
  return specs
}

export function createFakePlanTasks(): MissionPlanTask[] {
  return [
    { id: 't-analyst', agentId: 'analyst', title: '学情分析', seconds: 5, deps: [] },
    { id: 't-curriculum', agentId: 'curriculum', title: '分层练习', seconds: 5, deps: ['t-analyst'] },
    { id: 't-communicator', agentId: 'communicator', title: '家长会讲稿', seconds: 5, deps: ['t-analyst'] },
  ]
}

export function createFakeExecutionPlan(overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
  return {
    missionId: 'm-fake',
    kind: 'parent_meeting',
    execution: 'mock',
    tasks: createFakePlanTasks(),
    facts: createFakeFactSnapshot(),
    agentSpecs: createFakeAgentSpecs(),
    ...overrides,
  }
}

export function createFakeBriefingCard(overrides: Partial<BriefingCard> = {}): BriefingCard {
  return {
    id: 'card-1',
    role: 'teacher',
    type: 'decision',
    tag: 'd-drill',
    title: '分层练习比例待定',
    body: 'A 层 40% / B 层 40% / C 层 20%',
    confidence: 2,
    source: '学情库',
    ...overrides,
  }
}

export function createFakeDeliverableDraft(overrides: Partial<DeliverableDraft> = {}): DeliverableDraft {
  return {
    title: '家长会讲稿',
    kindCn: '讲稿',
    markdown: '# 家长会讲稿\n本次单元考均分 80.4 分。',
    provenance: {
      missionId: 'm-fake',
      taskId: 't-communicator',
      agentId: 'communicator',
      citations: [{ value: '80.4', source: '学情库', factId: 'f-avg' }],
      createdAt: 1760000000000,
    },
    citations: [{ value: '80.4', source: '学情库', factId: 'f-avg' }],
    ...overrides,
  }
}

/* ------------------------------------------------------------------ */
/* 工厂                                                                */
/* ------------------------------------------------------------------ */

/**
 * 创建 8 端口假实现（overrides 可只替换部分端口；calls 始终可断言）。
 * 例：`createFakePorts({ execution: fakeExecution })`。
 */
export function createFakePorts(overrides: Partial<DirectorPorts> = {}): FakePorts {
  const calls: FakePortCalls = {
    intakes: [],
    confirmed: [],
    startedMissions: [],
    runEvents: [],
    resumed: [],
    cancelled: [],
    published: [],
    opened: [],
    exported: [],
    shared: [],
    snapshots: [],
    verifications: [],
    agentMemory: [],
    teacherFeedback: [],
    granted: [],
    decisions: [],
    toasts: [],
    navigations: [],
  }

  const navEnv = createMemoryNavigatorEnv('/')
  const nav = createNavigator(navEnv)
  const navigate: Navigator = {
    open(target, opts) {
      calls.navigations.push(target)
      nav.open(target, opts)
    },
    go(route, opts) {
      nav.go(route, opts)
    },
    back() {
      nav.back()
    },
    canBack() {
      return nav.canBack()
    },
  }

  const roster = createFakeRoster()
  const autonomy = Object.fromEntries(roster.map((agent) => [agent.id, agent.autonomy])) as Record<
    DirectorAgentId,
    AutonomyLevel
  >

  const base: DirectorPorts = {
    intake: {
      fromCard(card) {
        return {
          utterance: `请按「${card.title}」准备材料`,
          constraints: { cardId: card.id, type: card.type, tag: card.tag },
        }
      },
      async submit(input) {
        calls.intakes.push(input)
        return {
          id: `draft-${calls.intakes.length}`,
          kind: 'parent_meeting',
          title: '家长会材料包',
          tasks: createFakePlanTasks(),
          planSource: 'template',
          facts: createFakeFactSnapshot({ missionId: `m-draft-${calls.intakes.length}` }),
          utterance: input.utterance,
        }
      },
      confirm(draftId) {
        calls.confirmed.push(draftId)
      },
    },
    execution: {
      mode: () => 'mock',
      async start(plan, sink, signal) {
        calls.startedMissions.push(plan.missionId)
        for (const [index, task] of plan.tasks.entries()) {
          const event: MissionRunEvent = { seq: index + 1, taskId: task.id, agentId: task.agentId, kind: 'task.start' }
          calls.runEvents.push(event)
          sink(event)
        }
        return {
          status: signal.aborted ? 'cancelled' : 'done',
          completedTasks: signal.aborted ? [] : plan.tasks.map((task) => task.id),
          failedTasks: [],
          artifactIds: ['doc-fake'],
          elapsedMs: 0,
          attempts: 1,
        }
      },
      async resume(missionId) {
        calls.resumed.push(missionId)
      },
      cancel(missionId) {
        calls.cancelled.push(missionId)
      },
    },
    deliverables: {
      async publish(draft) {
        calls.published.push(draft)
        return { docId: `doc-${calls.published.length}`, title: draft.title }
      },
      open(ref) {
        calls.opened.push(ref)
      },
      async export(ref, format) {
        calls.exported.push({ ref, format })
      },
      async share(ref) {
        calls.shared.push(ref)
        return `#share=${ref.docId}`
      },
    },
    evidence: {
      async snapshot(role) {
        calls.snapshots.push(role)
        return createFakeFactSnapshot({ role })
      },
      verify(markdown, snapshot) {
        calls.verifications.push({ markdown, snapshot })
        return { total: 2, verified: 1, derived: 1, conflict: 0, unverified: 0, structural: 0 }
      },
    },
    memory: {
      recordAgent(entry) {
        calls.agentMemory.push(entry)
      },
      async recentForAgent(agentId, limit = 3) {
        return calls.agentMemory.filter((entry) => entry.agentId === agentId).slice(-limit)
      },
      async semanticForAgent(agentId) {
        return calls.agentMemory.filter((entry) => entry.agentId === agentId && entry.kind === 'semantic')
      },
      recordTeacherFeedback(entry) {
        calls.teacherFeedback.push(entry)
      },
    },
    team: {
      roster: () => roster,
      grant(agentId, level) {
        calls.granted.push({ agentId, level })
      },
      status(agentId) {
        return { agentId, autonomy: autonomy[agentId], status: 'idle', done: 0, failed: 0 }
      },
    },
    notify: {
      decision(notice) {
        calls.decisions.push(notice)
      },
      toast(text, kind) {
        calls.toasts.push({ text, kind })
      },
    },
    navigate,
  }

  return { ...base, ...overrides, calls, navEnv }
}
