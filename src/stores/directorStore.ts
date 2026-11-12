/**
 * Director 原型状态机（v1.0 预览 → v1.1 加固）
 *
 * 只服务演示链路：决策卡 / 作战计划 / Mock 异步执行 / 审批门 / 授权调整 / 引导。
 * 与现有 chatStore、loomStore 解耦：旧工作台流程零改动。
 *
 * v1.1 增量（M1/M2/M3）：
 * - 剧本模板化：plan / script / artifacts / 统计全部按 `mission.kind` 取 MISSION_TEMPLATES；
 * - 真 LLM 拆解 `planMission`：意图路由 → 冻结事实 → planner（模板兜底）→ 写入待确认计划；
 * - 持久化：模块加载时 hydrate，`subscribe` 比对持久化切片做 300ms 合并写盘，关键节点强制 flush；
 * - 刷新恢复：`running → paused`，`resumeMission()` 从 `missionCursor` 续跑、不重放 feed；
 * - d-drill 采纳联动：mission 尚在 idle/planning 时种下单元考闭环计划（不跳屏）。
 */
import { create } from 'zustand'
import {
  AGENTS,
  AGENT_MAP,
  DECISION_TO_MISSION,
  GATE_OWNER,
  INITIAL_DECISIONS,
  MISSION_HOSTED_PIECES,
  MISSION_TEMPLATES,
  missionTemplate,
  routeMissionKind,
} from '../harness/director/data'
import { freezeFacts, freezeFactsFromSource } from '../harness/director/facts'
import { MISSION_KINDS, adaptPlanToTasks, planFromTemplate } from '../harness/director/planTypes'
import { planMission as runPlanMission, type PlanMissionResult } from '../harness/director/planner'
import { getSourceProvider } from '../harness/sources'
import {
  cancelDirectorPersist,
  flushDirectorPersist as flushPersistedDirector,
  loadDirectorPersisted,
  scheduleDirectorPersist,
  toPersistedDirector,
  writeDirectorPersist,
  type DirectorPersistSource,
} from './directorPersistence'
import type {
  AutonomyLevel,
  DecisionItem,
  DirectorAgentId,
  DirectorScreen,
  DirectorState,
  DirectorStoreActions,
  Fact,
  FeedItem,
  MissionKind,
  MissionPlanTask,
  MissionScriptEvent,
  PersistedDirectorV1,
  ToastItem,
  Tone,
} from '../harness/director/types'

/* ---------- 模块级定时器与序号（不受 React 渲染影响） ---------- */

let timers: ReturnType<typeof setTimeout>[] = []
let runId = 0
let feedSeq = 0
let toastSeq = 0
/** 真 LLM 拆解：中止控制器 + 请求序号（防连点 / 丢弃过期响应） */
let planAbort: AbortController | null = null
let planSeq = 0

function clearRunTimers(): void {
  timers.forEach((t) => clearTimeout(t))
  timers = []
}

function later(fn: () => void, ms: number): void {
  const t = setTimeout(fn, ms)
  timers.push(t)
}

function autonomySeed(): Record<DirectorAgentId, AutonomyLevel> {
  return AGENTS.reduce(
    (acc, agent) => ({ ...acc, [agent.id]: agent.autonomy }),
    {} as Record<DirectorAgentId, AutonomyLevel>,
  )
}

/** 拷贝模板计划：初始/重置态不共享 data.ts 常量的引用 */
function cloneTemplatePlan(kind: MissionKind): MissionPlanTask[] {
  return missionTemplate(kind).plan.map((task) => ({
    ...task,
    ...(task.deps ? { deps: [...task.deps] } : {}),
  }))
}

export function createInitialDirectorState(): DirectorState {
  return {
    screen: 'inbox',
    decisions: INITIAL_DECISIONS.map((d) => ({ ...d, status: 'new' })),
    stats: { pending: 3, running: 1, hosted: 4, savedHours: 2.1 },
    mission: {
      // 演示开场即有一个「作战计划待确认」在办，与战情条 1 个在办自洽
      status: 'planning',
      kind: 'parent_meeting',
      title: MISSION_TEMPLATES.parent_meeting.title,
      progress: 0,
      feed: [],
      plan: cloneTemplatePlan('parent_meeting'),
      doneTasks: [],
      gate: null,
      planSource: 'template',
    },
    missionCursor: 0,
    autonomy: autonomySeed(),
    toasts: [],
    artifactId: null,
    guideActive: false,
    guideStep: 0,
    planSource: 'template',
    planLoading: false,
    facts: [],
  }
}

/* ------------------------------------------------------------------ */
/* 持久化接入（M2）：模块加载时 hydrate + 切片订阅                        */
/* ------------------------------------------------------------------ */

function persistSourceOf(state: DirectorState): DirectorPersistSource {
  return {
    decisions: state.decisions,
    stats: state.stats,
    mission: state.mission,
    missionCursor: state.missionCursor,
    planSource: state.planSource,
    autonomy: state.autonomy,
    facts: state.facts,
  }
}

/**
 * 持久化载荷 → 运行态（导出供单测矩阵）：
 * - 恢复落点：`planning | paused | waiting | done` 自动落作战室（screen 是派生、不落盘）；
 * - 纯函数、每次都深拷贝数组，避免恢复态与持久化对象共享引用。
 */
export function hydrateDirectorState(persisted: PersistedDirectorV1): DirectorState {
  const base = createInitialDirectorState()
  return {
    ...base,
    screen: persisted.mission.status === 'idle' ? 'inbox' : 'mission',
    decisions: persisted.decisions.map((d) => ({ ...d })),
    stats: { ...persisted.stats },
    mission: {
      ...persisted.mission,
      feed: persisted.mission.feed.map((item) => ({ ...item })),
      plan: persisted.mission.plan.map((task) => ({ ...task, ...(task.deps ? { deps: [...task.deps] } : {}) })),
      doneTasks: [...persisted.mission.doneTasks],
    },
    missionCursor: persisted.missionCursor,
    autonomy: { ...persisted.autonomy },
    planSource: persisted.planSource,
    facts: persisted.facts.map((fact) => ({ ...fact })),
  }
}

const GUIDE_SEEN_LEGACY_KEY = 'edustudio:director-guide'

/** 恢复结果：guideSeen 不在 DirectorState 里，用模块变量承载（随 v1 payload 落盘） */
const restored = loadDirectorPersisted(
  toPersistedDirector(persistSourceOf(createInitialDirectorState()), false),
)
let guideSeenValue = restored.value.guideSeen
/** 首次访问（无持久化数据）维持 v1.0 开场：战情台；有数据才按恢复矩阵落作战室 */
const initialState: DirectorState = restored.hasPersisted ? hydrateDirectorState(restored.value) : createInitialDirectorState()

export function hasSeenDirectorGuide(): boolean {
  return guideSeenValue
}

function markDirectorGuideSeen(): void {
  if (guideSeenValue) return
  guideSeenValue = true
  scheduleDirectorPersist(toPersistedDirector(persistSourceOf(useDirectorStore.getState()), guideSeenValue))
}

function persistSnapshot(): PersistedDirectorV1 {
  return toPersistedDirector(persistSourceOf(useDirectorStore.getState()), guideSeenValue)
}

/** 立即落盘（关键节点：确认计划 / 审批门 / 放行 / 退回 / 完成 / 重置） */
function persistNow(): void {
  writeDirectorPersist(persistSnapshot())
}

/** 页面隐藏 / pagehide 兜底（main.tsx 通过 window 钩子调用；不在主 chunk 静态 import 导演数据） */
export function flushDirectorPersist(): void {
  flushPersistedDirector()
}

/* ---------- 执行引擎辅助 ---------- */

function feedItem(agentId: DirectorAgentId, text: string, kind: FeedItem['kind']): FeedItem {
  feedSeq += 1
  return { id: `f-${feedSeq}`, agentId, text, at: Date.now(), kind }
}

function decisionAfter<T extends DecisionItem>(list: DecisionItem[], id: string, patch: Partial<T>): DecisionItem[] {
  return list.map((d) => (d.id === id ? ({ ...d, ...patch } as DecisionItem) : d))
}

/** `?llm=0` 彩排/E2E 强制模板（不提供 ?llm=1，避免现场误触） */
function forceTemplateMode(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('llm') === '0'
  } catch {
    return false
  }
}

/** 冻结本次计划的事实快照（SourceProvider → seed 兜底，确定性、可持久化） */
async function freezePlanFacts(): Promise<Fact[]> {
  try {
    const result = await getSourceProvider().getClassProfile()
    const facts = freezeFactsFromSource(result)
    return facts.length > 0 ? facts : freezeFacts()
  } catch {
    return freezeFacts()
  }
}

export interface DirectorStore extends DirectorState, DirectorStoreActions {}

export const useDirectorStore = create<DirectorStore>((set, get) => {
  const toast = (text: string, tone: Tone = 'primary') => {
    toastSeq += 1
    const item: ToastItem = { id: `toast-${toastSeq}`, text, tone }
    set({ toasts: [...get().toasts, item] })
    setTimeout(() => {
      set({ toasts: get().toasts.filter((t) => t.id !== item.id) })
    }, 2800)
  }

  const finishMission = (rid: number, finalText: string): void => {
    if (rid !== runId) return
    const state = get()
    const mission = state.mission
    const template = missionTemplate(mission.kind)
    set({
      mission: {
        ...mission,
        status: 'done',
        progress: 100,
        gate: null,
        finishedAt: Date.now(),
        feed: [...mission.feed, feedItem('chief', finalText, 'system')],
      },
      stats: {
        ...state.stats,
        running: 0,
        hosted: state.stats.hosted + (MISSION_HOSTED_PIECES[mission.kind] ?? template.artifacts.length),
        savedHours: Number((state.stats.savedHours + template.meta.savedHours).toFixed(1)),
      },
    })
    toast('已交付 · 可导出', 'mint')
    persistNow()
  }

  const applyEvent = (ev: MissionScriptEvent, rid: number, cursor: number): void => {
    if (rid !== runId) return
    const state = get()
    const mission = state.mission
    if (ev.kind === 'done') {
      finishMission(rid, ev.text)
      return
    }
    const nextFeed = [...mission.feed, feedItem(ev.agentId, ev.text, ev.kind === 'gate' ? 'gate' : 'step')]
    if (ev.kind === 'gate') {
      // V2：审批门命中不再弹 toast（卡标题已表达，避免同屏重复提示）
      set({
        mission: { ...mission, status: 'waiting', gate: ev.gate, progress: ev.progress, feed: nextFeed },
        missionCursor: cursor + 1,
      })
      persistNow()
      return
    }
    const doneTasks = ev.task && !mission.doneTasks.includes(ev.task)
      ? [...mission.doneTasks, ev.task]
      : mission.doneTasks
    set({
      mission: { ...mission, status: 'running', progress: ev.progress, feed: nextFeed, doneTasks },
      missionCursor: cursor + 1,
    })
    runFrom(cursor + 1, rid)
  }

  const runFrom = (cursor: number, rid: number): void => {
    if (rid !== runId) return
    const script = missionTemplate(get().mission.kind).script
    const ev = script[cursor]
    if (!ev) return
    later(() => applyEvent(ev, rid, cursor), ev.after)
  }

  const store: DirectorStore = {
    ...initialState,

    setScreen: (screen: DirectorScreen) => {
      const mission = get().mission
      const nextMission = screen === 'mission' && mission.status === 'idle'
        ? { ...mission, status: 'planning' as const }
        : mission
      set({ screen, mission: nextMission })
    },

    /* ---------- 决策卡 ---------- */
    acceptDecision: (id: string) => {
      const decision = get().decisions.find((d) => d.id === id)
      if (!decision || decision.status !== 'new') return
      const isApprove = decision.kind === 'approve'
      set({
        decisions: decisionAfter(get().decisions, id, { status: 'done' }),
        stats: {
          ...get().stats,
          pending: Math.max(0, get().stats.pending - 1),
          hosted: get().stats.hosted + 1,
          savedHours: Number((get().stats.savedHours + 0.2).toFixed(1)),
        },
      })
      /* v1.1 d-drill 联动（D9）：只种计划、不跳屏；mission 已跑时不覆盖，仅登记待办 */
      const linkedKind = DECISION_TO_MISSION[id]
      if (linkedKind) {
        const status = get().mission.status
        if (status === 'idle' || status === 'planning') {
          get().startMission(linkedKind)
          toast('已采纳 · 单元考闭环计划待确认', 'primary')
        } else {
          toast('已采纳 · 已加入待办', 'graphite')
        }
        return
      }
      toast(
        isApprove ? '已发送（演示未真实外发）' : '已采纳 · 战队开始执行',
        isApprove ? 'mint' : 'primary',
      )
    },

    resolveConflict: (id: string, optionId: string) => {
      const decision = get().decisions.find((d) => d.id === id)
      if (!decision || decision.status !== 'new') return
      set({
        decisions: decisionAfter(get().decisions, id, { status: 'done' }),
        stats: {
          ...get().stats,
          pending: Math.max(0, get().stats.pending - 1),
          savedHours: Number((get().stats.savedHours + 0.1).toFixed(1)),
        },
      })
      void optionId
      toast(optionId === 'class' ? '已统一为三科均分 80.4（标注派生值）' : '已统一为物理均分 82.4', 'mint')
    },

    snoozeDecision: (id: string) => {
      const decision = get().decisions.find((d) => d.id === id)
      if (!decision || decision.status !== 'new') return
      set({
        decisions: decisionAfter(get().decisions, id, { status: 'snoozed' }),
        stats: { ...get().stats, pending: Math.max(0, get().stats.pending - 1) },
      })
      toast('顺延到午休 · 不再打扰', 'graphite')
    },

    /* ---------- 作战任务 ---------- */
    openMission: () => {
      const mission = get().mission
      set({
        screen: 'mission',
        mission: mission.status === 'idle' ? { ...mission, status: 'planning' } : mission,
      })
    },

    /* ---------- v1.1 真 LLM 拆解（M1） ---------- */
    planMission: async (utterance: string) => {
      const text = typeof utterance === 'string' ? utterance.trim() : ''
      if (!text) return
      planSeq += 1
      const seq = planSeq
      planAbort?.abort()
      const controller = new AbortController()
      planAbort = controller

      const routedKind = routeMissionKind(text)
      const routedTemplate = missionTemplate(routedKind)
      // 请求中：只开 loading，不打断在跑的任务；结果落库时才替换剧本
      set({ planLoading: true })

      const facts = await freezePlanFacts()
      if (seq !== planSeq || controller.signal.aborted) return
      let result: PlanMissionResult
      try {
        result = await runPlanMission({
          utterance: text,
          facts,
          fallback: planFromTemplate(routedTemplate),
          forceTemplate: forceTemplateMode(),
          signal: controller.signal,
        })
      } catch {
        // planner 契约上不抛；万一抛也回模板，绝不阻断、绝不弹 toast（roadmap §4.5）
        result = {
          plan: planFromTemplate(routedTemplate),
          source: 'template',
          reason: 'error',
          latencyMs: 0,
          model: 'template',
        }
      }
      // 已被取消 / 被更新的一次请求取代：丢弃过期结果
      if (seq !== planSeq || controller.signal.aborted) return
      planAbort = null

      const kind: MissionKind = MISSION_KINDS.includes(result.plan.kind) ? result.plan.kind : routedKind
      const template = missionTemplate(kind)
      let plan = adaptPlanToTasks(result.plan)
      if (plan.length === 0) plan = adaptPlanToTasks(planFromTemplate(template))
      clearRunTimers()
      runId += 1
      set({
        screen: 'mission',
        planLoading: false,
        planSource: result.source,
        facts,
        missionCursor: 0,
        mission: {
          status: 'planning',
          kind,
          title: (result.plan.title ?? '').trim() || template.title,
          progress: 0,
          feed: [],
          plan,
          doneTasks: [],
          gate: null,
          planSource: result.source,
          planReason: result.reason,
        },
      })
    },

    cancelPlanning: () => {
      planSeq += 1
      planAbort?.abort()
      planAbort = null
      set({ planLoading: false })
    },

    /** 按剧本 kind 种下模板计划（?mission= 兜底 / d-drill 联动），保持「先看再做」不跳屏 */
    startMission: (kind: MissionKind) => {
      const template = missionTemplate(kind)
      const plan = adaptPlanToTasks(planFromTemplate(template))
      planSeq += 1
      planAbort?.abort()
      planAbort = null
      clearRunTimers()
      runId += 1
      set({
        planLoading: false,
        planSource: 'template',
        facts: freezeFacts(),
        missionCursor: 0,
        mission: {
          status: 'planning',
          kind: template.kind,
          title: template.title,
          progress: 0,
          feed: [],
          plan,
          doneTasks: [],
          gate: null,
          planSource: 'template',
        },
      })
    },

    /* ---------- v1.1 刷新续跑（M2） ---------- */
    resumeMission: () => {
      const mission = get().mission
      if (mission.status !== 'paused') return
      clearRunTimers()
      runId += 1
      const rid = runId
      const cursor = get().missionCursor
      set({
        mission: { ...mission, status: 'running' },
        stats: { ...get().stats, running: 1 },
      })
      toast('已继续 · 从断点接着跑', 'primary')
      persistNow()
      later(() => runFrom(cursor, rid), 500)
    },

    cancelPlan: () => {
      clearRunTimers()
      runId += 1
      planSeq += 1
      planAbort?.abort()
      planAbort = null
      set({
        screen: 'inbox',
        planLoading: false,
        mission: { ...get().mission, status: 'idle', progress: 0, feed: [], gate: null },
      })
    },

    confirmPlan: () => {
      clearRunTimers()
      runId += 1
      const rid = runId
      const mission = get().mission
      set({
        screen: 'mission',
        stats: { ...get().stats, running: 1 },
        missionCursor: 0,
        mission: {
          ...mission,
          status: 'running',
          progress: 0,
          feed: [feedItem('chief', '已接管 · 你先去忙', 'system')],
          doneTasks: [],
          gate: null,
          startedAt: Date.now(),
          finishedAt: undefined,
        },
      })
      toast('已开战 · 你可以离开', 'primary')
      persistNow()
      later(() => runFrom(0, rid), 500)
    },

    approveGate: () => {
      if (get().mission.status !== 'waiting') return
      const rid = runId
      const cursor = get().missionCursor
      set({
        mission: { ...get().mission, status: 'running', gate: null },
      })
      toast('已放行 · 战队继续', 'primary')
      persistNow()
      later(() => runFrom(cursor, rid), 500)
    },

    rejectGate: () => {
      const mission = get().mission
      if (mission.status !== 'waiting' || !mission.gate) return
      const rid = runId
      const cursor = get().missionCursor
      const gateOwner: DirectorAgentId = GATE_OWNER[mission.gate] ?? 'chief'
      set({
        mission: {
          ...mission,
          status: 'running',
          gate: null,
          feed: [...mission.feed, feedItem(gateOwner, '按你的意见重写中', 'step')],
        },
      })
      toast('已退回重写 · 只重跑这一段', 'amber')
      persistNow()
      later(() => {
        if (rid !== runId) return
        const cur = get().mission
        set({ mission: { ...cur, feed: [...cur.feed, feedItem(gateOwner, '重写完成', 'step')] } })
        later(() => runFrom(cursor, rid), 400)
      }, 1300)
    },

    /* ---------- 授权 ---------- */
    setAutonomy: (agentId: DirectorAgentId, level: AutonomyLevel) => {
      set({ autonomy: { ...get().autonomy, [agentId]: level } })
      const agent = AGENT_MAP[agentId]
      if (agentId === 'communicator' && (level === 'L2' || level === 'L3')) {
        toast('已授信 · 对外发送仍需你拍板', 'coral')
      } else {
        toast(`${agent.name} · 授权 ${level}`, 'primary')
      }
    },

    /* ---------- 交付物 ---------- */
    openArtifact: (id: string) => set({ artifactId: id }),
    closeArtifact: () => set({ artifactId: null }),

    /* ---------- 引导 ---------- */
    startGuide: (force = false) => {
      if (!force && hasSeenDirectorGuide()) return
      set({ guideActive: true, guideStep: 0, screen: 'inbox' })
    },
    nextGuide: (total: number) => {
      const next = get().guideStep + 1
      if (next >= total) {
        markDirectorGuideSeen()
        // 引导收尾回到战情台：从「认识团队」自然回落到今天要做的决定
        set({ guideActive: false, guideStep: 0, screen: 'inbox' })
        return
      }
      set({ guideStep: next })
    },
    closeGuide: () => {
      markDirectorGuideSeen()
      set({ guideActive: false, guideStep: 0 })
    },

    /* ---------- 提示 / 重置 ---------- */
    toast,
    resetDemo: () => {
      // 先取消待写快照，避免 300ms 后旧状态写回（先例 loomStore.cancelLoomPersist）
      cancelDirectorPersist()
      planSeq += 1
      planAbort?.abort()
      planAbort = null
      clearRunTimers()
      runId += 1
      // D3：重置保留 guideSeen（重看引导走 ?tour=1），其余回初始态
      set({ ...createInitialDirectorState(), guideActive: false })
      persistNow()
    },
  }

  return store
})

/* ------------------------------------------------------------------ */
/* 持久化订阅与页面隐藏兜底                                              */
/* ------------------------------------------------------------------ */

/** 仅当「持久化切片」变化时排队写盘：toast / screen / artifactId / guideActive 等瞬态不触发 */
useDirectorStore.subscribe((state) => {
  scheduleDirectorPersist(toPersistedDirector(persistSourceOf(state), guideSeenValue))
})

type WindowWithDirectorPersistHooks = Window & {
  __edustudioFlushDirector?: () => void
  /** 清库 / 恢复备份前撤销待写快照（避免 300ms 后旧状态写回，roadmap §5.2） */
  __edustudioCancelDirectorPersist?: () => void
}

if (typeof window !== 'undefined') {
  /* 导演模块是独立 lazy chunk：载入后把同步 flush / cancel 挂到 window，main.tsx 与设置页的
     visibilitychange / pagehide / 清库 / 恢复兜底即可调用，而主 chunk 不必静态 import 导演数据 */
  ;(window as WindowWithDirectorPersistHooks).__edustudioFlushDirector = flushDirectorPersist
  ;(window as WindowWithDirectorPersistHooks).__edustudioCancelDirectorPersist = cancelDirectorPersist
}

/** 供 legacy 单测/调试：清除旧引导键（v1.0 迁移后已删除，保留常量便于对齐） */
export const DIRECTOR_GUIDE_LEGACY_KEY = GUIDE_SEEN_LEGACY_KEY
