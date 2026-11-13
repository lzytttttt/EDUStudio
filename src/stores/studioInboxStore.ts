/**
 * v1.2 M2 · 统一收件箱运行时（主 chunk，roadmap §2.3 F1/F6、§2.4、§3.4）
 *
 * 收件箱是**派生视图**：只持有「来源引用 + 覆盖态」，任务/文档/通知本体仍在各自事实源。
 * 来源（四类）：
 *  - mission：Director chunk 发的 `gate.waiting` / `gate.resolved`（审批门统一为 ApprovalGate）；
 *  - briefing：简报采纳发的 `card.accepted`（同源待办「已代办」，可点开回对应会话）；
 *  - taskFlow：下发任务链的待回执（按当前角色读只读选择器）；
 *  - notice：通知中心的未读通知（只读 notices）。
 * 覆盖态（done/snoozed）由用户动作写入本 store；M2 仅会话内保存，M4 并入 director 键。
 *
 * 边界：本文件在主 chunk 的 stores 目录，可以 import 旧 store（这是「薄适配层」）；
 * 但 Director chunk 只能通过本 store 的 hook 读取派生结果，不能反向写旧事实源。
 */
import { useMemo } from 'react'
import { create } from 'zustand'
import type { ApprovalGate, StudioDigest } from '../studio/contracts'
import { studioBus } from '../studio/bus'
import {
  deriveInbox,
  type InboxOverrides,
  type InboxResult,
  type InboxSourceItem,
} from '../studio/inbox'
import { useAuthStore } from './authStore'
import { useNotificationStore } from './notificationStore'
import { flowsForRole, useTaskFlowStore } from './taskFlowStore'

interface GateRecord {
  gate: ApprovalGate
  at: number
}

export interface StudioInboxState {
  /** 等待中的审批门（按 gateId 去重；gate.resolved 后移除） */
  gates: Record<string, GateRecord>
  /** 简报采纳等「已代办」来源 */
  hosted: InboxSourceItem[]
  /** taskFlow 待回执派生（随 store 刷新） */
  taskFlow: InboxSourceItem[]
  /** 通知中心未读通知派生（只读） */
  notices: InboxSourceItem[]
  /** 用户覆盖态（done/snoozed） */
  overrides: InboxOverrides
  recordGate: (gate: ApprovalGate) => void
  resolveGate: (gateId: string) => void
  addHosted: (item: InboxSourceItem) => void
  resolve: (id: string) => void
  snooze: (id: string, until: number) => void
  refreshNotices: () => void
  refreshTaskFlow: () => void
  reset: () => void
}

/** 来源优先级（数值越大越靠前）：审批门 > 下发回执 > 简报已代办 */
export const INBOX_PRIORITY = { gate: 100, taskFlow: 60, hosted: 40 } as const

function gateItem(record: GateRecord): InboxSourceItem {
  const { gate, at } = record
  return {
    id: `gate:${gate.gateId}`,
    source: 'mission',
    refId: gate.missionId ?? gate.gateId,
    title: gate.title,
    body: gate.source === 'loom' ? '画布审批门等待处理' : '战队等待你拍板后继续',
    priority: INBOX_PRIORITY.gate,
    gate,
    at,
  }
}

/** 通知中心未读 → 只读 notices（最多 20 条，避免右栏/角标被历史通知淹没） */
function noticeItemsFromNotifications(): InboxSourceItem[] {
  const items = useNotificationStore.getState().items
  return items
    .filter((n) => !n.read)
    .slice(0, 20)
    .map((n) => ({
      id: `notice:${n.id}`,
      source: 'notice' as const,
      refId: n.id,
      title: n.title,
      body: n.body,
      kind: 'notice' as const,
      at: n.createdAt,
    }))
}

/** taskFlow 待回执 → 可决策条目（当前角色自己的回执；接收方视角） */
function taskFlowItemsForRole(role: ReturnType<typeof useAuthStore.getState>['role']): InboxSourceItem[] {
  if (!role) return []
  const flows = flowsForRole(useTaskFlowStore.getState().flows, role)
  const items: InboxSourceItem[] = []
  for (const flow of flows) {
    const receipt = flow.receipts.find((r) => r.targetRole === role)
    if (!receipt || receipt.status !== 'pending') continue
    items.push({
      id: `flow:${flow.id}:${receipt.id}`,
      source: 'taskFlow',
      refId: receipt.id,
      title: flow.title,
      body: `截止 ${flow.deadline}${receipt.note ? ` · ${receipt.note}` : ''}`,
      priority: INBOX_PRIORITY.taskFlow,
      at: flow.issuedAt,
    })
  }
  return items
}

export const useStudioInboxStore = create<StudioInboxState>((set, get) => ({
  gates: {},
  hosted: [],
  taskFlow: [],
  notices: [],
  overrides: {},

  recordGate: (gate) => {
    const existing = get().gates[gate.gateId]
    if (existing) return
    set({ gates: { ...get().gates, [gate.gateId]: { gate, at: Date.now() } } })
  },

  resolveGate: (gateId) => {
    if (!get().gates[gateId]) return
    const gates = { ...get().gates }
    delete gates[gateId]
    set({ gates })
    /* 门通过后收件箱里这条待办同步消失（同一事实的覆盖态） */
    get().resolve(`gate:${gateId}`)
  },

  addHosted: (item) => {
    if (get().hosted.some((h) => h.id === item.id)) return
    set({ hosted: [item, ...get().hosted].slice(0, 20) })
  },

  resolve: (id) => {
    set({ overrides: { ...get().overrides, [id]: { status: 'done', resolvedAt: Date.now() } } })
  },

  snooze: (id, until) => {
    set({ overrides: { ...get().overrides, [id]: { status: 'snoozed', snoozeUntil: until } } })
  },

  refreshNotices: () => {
    set({ notices: noticeItemsFromNotifications() })
  },

  refreshTaskFlow: () => {
    set({ taskFlow: taskFlowItemsForRole(useAuthStore.getState().role) })
  },

  reset: () => {
    set({ gates: {}, hosted: [], taskFlow: [], notices: [], overrides: {} })
    get().refreshTaskFlow()
    get().refreshNotices()
  },
}))

/** 派生收件箱（纯 selector，便于单测）：来源顺序 = gate → taskFlow → hosted → notices */
export function selectStudioInbox(
  state: Pick<StudioInboxState, 'gates' | 'hosted' | 'taskFlow' | 'notices' | 'overrides'>,
  now = Date.now(),
): InboxResult {
  const gateSources = Object.values(state.gates)
    .sort((a, b) => b.at - a.at)
    .map(gateItem)
  const sources = [...gateSources, ...state.taskFlow, ...state.hosted, ...state.notices]
  return deriveInbox(sources, state.overrides, now)
}

/** UI 消费：战情台列表 / 角标 / 顶栏收件箱共用同一口径（双计数为 0） */
export function useStudioInbox(now = Date.now()): InboxResult {
  const gates = useStudioInboxStore((s) => s.gates)
  const hosted = useStudioInboxStore((s) => s.hosted)
  const taskFlow = useStudioInboxStore((s) => s.taskFlow)
  const notices = useStudioInboxStore((s) => s.notices)
  const overrides = useStudioInboxStore((s) => s.overrides)
  return useMemo(
    () => selectStudioInbox({ gates, hosted, taskFlow, notices, overrides }, now),
    [gates, hosted, taskFlow, notices, overrides, now],
  )
}

/** 角标口径：decisions = 待办（需动作），notices = 只读未读；total 供顶栏一个收件箱 */
export function inboxCounts(result: InboxResult): { decisions: number; notices: number; total: number } {
  const decisions = result.decisions.length
  const notices = result.notices.length
  return { decisions, notices, total: decisions + notices }
}

let started = false
let stopFns: (() => void)[] = []

/** 启动收件箱来源订阅（main.tsx 调用；幂等；返回停止函数便于测试） */
export function startStudioInboxSources(): () => void {
  if (started) return () => {}
  started = true
  const store = useStudioInboxStore.getState()

  stopFns.push(
    studioBus.on('gate.waiting', (e) => useStudioInboxStore.getState().recordGate(e.gate)),
    studioBus.on('gate.resolved', (e) => useStudioInboxStore.getState().resolveGate(e.gateId)),
    studioBus.on('card.accepted', (e) => {
      useStudioInboxStore.getState().addHosted({
        id: `card:${e.cardId}`,
        source: 'briefing',
        refId: e.cardId,
        title: e.title ?? `已交给战队：${e.goal.slice(0, 20)}`,
        body: e.goal,
        priority: INBOX_PRIORITY.hosted,
        at: Date.now(),
        ...(e.sessionId ? { action: { kind: 'chat' as const, sessionId: e.sessionId } } : {}),
      })
    }),
    studioBus.on('notice.push', (e) => {
      useStudioInboxStore.getState().addHosted({
        id: `notice:${e.notice.id}`,
        source: 'notice',
        refId: e.notice.refId,
        title: e.notice.title,
        body: e.notice.body,
        kind: 'notice',
        at: Date.now(),
      })
    }),
    useNotificationStore.subscribe((state, prev) => {
      if (state.items !== prev.items) useStudioInboxStore.getState().refreshNotices()
    }),
    useTaskFlowStore.subscribe((state, prev) => {
      if (state.flows !== prev.flows) useStudioInboxStore.getState().refreshTaskFlow()
    }),
    useAuthStore.subscribe((state, prev) => {
      if (state.role !== prev.role) useStudioInboxStore.getState().refreshTaskFlow()
    }),
  )

  store.refreshNotices()
  store.refreshTaskFlow()

  return () => {
    started = false
    stopFns.forEach((fn) => fn())
    stopFns = []
  }
}
