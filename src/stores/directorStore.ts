/**
 * Director 原型状态机（v1.0 预览）
 *
 * 只服务演示链路：决策卡 / 作战计划 / Mock 异步执行 / 审批门 / 授权调整 / 引导。
 * 与现有 chatStore、loomStore 解耦：旧工作台流程零改动。
 */
import { create } from 'zustand'
import {
  AGENTS,
  AGENT_MAP,
  INITIAL_DECISIONS,
  MISSION_PLAN,
  MISSION_SCRIPT,
  type MissionScriptEvent,
} from '../harness/director/data'
import type {
  AutonomyLevel,
  DecisionItem,
  DirectorAgentId,
  DirectorScreen,
  DirectorState,
  DirectorStoreActions,
  FeedItem,
  MissionGate,
  ToastItem,
  Tone,
} from '../harness/director/types'

const GUIDE_SEEN_KEY = 'edustudio:director-guide'

export function hasSeenDirectorGuide(): boolean {
  try {
    return window.localStorage.getItem(GUIDE_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

function markDirectorGuideSeen(): void {
  try {
    window.localStorage.setItem(GUIDE_SEEN_KEY, '1')
  } catch {
    /* 隐私模式忽略 */
  }
}

/* ---------- 模块级定时器与序号（不受 React 渲染影响） ---------- */

let timers: ReturnType<typeof setTimeout>[] = []
let runId = 0
let feedSeq = 0
let toastSeq = 0

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

export function createInitialDirectorState(): DirectorState {
  return {
    screen: 'inbox',
    decisions: INITIAL_DECISIONS.map((d) => ({ ...d, status: 'new' })),
    stats: { pending: 3, running: 1, hosted: 4, savedHours: 2.1 },
    mission: {
      // 演示开场即有一个「作战计划待确认」在办，与战情条 1 个在办自洽
      status: 'planning',
      kind: 'parent_meeting',
      title: '家长会材料包',
      progress: 0,
      feed: [],
      plan: MISSION_PLAN,
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

function feedItem(agentId: DirectorAgentId, text: string, kind: FeedItem['kind']): FeedItem {
  feedSeq += 1
  return { id: `f-${feedSeq}`, agentId, text, at: Date.now(), kind }
}

function decisionAfter<T extends DecisionItem>(list: DecisionItem[], id: string, patch: Partial<T>): DecisionItem[] {
  return list.map((d) => (d.id === id ? ({ ...d, ...patch } as DecisionItem) : d))
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
    const mission = get().mission
    set({
      mission: {
        ...mission,
        status: 'done',
        progress: 100,
        finishedAt: Date.now(),
        feed: [...mission.feed, feedItem('chief', finalText, 'system')],
      },
      stats: {
        ...get().stats,
        running: 0,
        hosted: get().stats.hosted + 6,
        savedHours: Number((get().stats.savedHours + 1.6).toFixed(1)),
      },
    })
    toast('作战包已交付 · 你只做了 2 个决定', 'mint')
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
      set({
        mission: { ...mission, status: 'waiting', gate: ev.gate as MissionGate, progress: ev.progress, feed: nextFeed },
        missionCursor: cursor + 1,
      })
      toast(ev.text, 'amber')
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
    const ev = MISSION_SCRIPT[cursor]
    if (!ev) return
    later(() => applyEvent(ev, rid, cursor), ev.after)
  }

  return {
    ...createInitialDirectorState(),

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
      const option = decision.conflict?.options.find((o) => o.id === optionId)
      toast(optionId === 'class' ? '已统一为三科均分 80.4（标注派生值）' : '已统一为物理均分 82.4', 'mint')
      void option
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

    /* ---------- v1.1 真 LLM 拆解 / 剧本（M1/M3 实现，此处为契约骨架） ---------- */
    planMission: async () => {
      /* TODO(M1): routeMissionKind + planner.planMission + validatePlan + 写计划 */
    },
    cancelPlanning: () => set({ planLoading: false }),
    startMission: () => {
      /* TODO(M3): 按 kind 取 MISSION_TEMPLATES 种计划（不跳屏） */
    },
    resumeMission: () => {
      /* TODO(M2): paused → running，从 missionCursor 续跑 */
    },

    cancelPlan: () => {
      set({ screen: 'inbox', mission: { ...get().mission, status: 'idle', progress: 0, feed: [], gate: null } })
    },

    confirmPlan: () => {
      clearRunTimers()
      runId += 1
      const rid = runId
      set({
        screen: 'mission',
        stats: { ...get().stats, running: 1 },
        missionCursor: 0,
        mission: {
          ...get().mission,
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
      later(() => runFrom(cursor, rid), 500)
    },

    rejectGate: () => {
      const mission = get().mission
      if (mission.status !== 'waiting' || !mission.gate) return
      const rid = runId
      const cursor = get().missionCursor
      const gateAgent: DirectorAgentId = mission.gate === 'speech' ? 'curriculum' : 'communicator'
      set({
        mission: {
          ...mission,
          status: 'running',
          gate: null,
          feed: [...mission.feed, feedItem(gateAgent, '按你的意见重写中', 'step')],
        },
      })
      toast('已退回重写 · 只重跑这一段', 'amber')
      later(() => {
        if (rid !== runId) return
        const cur = get().mission
        set({ mission: { ...cur, feed: [...cur.feed, feedItem(gateAgent, '重写完成', 'step')] } })
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
      clearRunTimers()
      runId += 1
      set({ ...createInitialDirectorState(), guideActive: false })
    },
  }
})
