/**
 * v1.2 M2 · StudioDigest 只读投影运行时（主 chunk，roadmap §2.4 / §3.1 规则 3 / §3.4）
 *
 * 主 chunk 只能看到「计数 + 一行摘要」，不得读 Director 实体；本 store 由 StudioBus 事件驱动，
 * 供侧栏角标 / 顶栏收件箱 / 右栏只读团队摘要消费，并把结果持久化到 `settings.studio.digest`（≤1KB）。
 *
 * M2 新增两件事（均 optional、缺省行为不变）：
 * - `unreadNotices`：通知中心未读数（与收件箱待办合成一个角标口径）；
 * - `team`：右栏只读团队摘要（成员状态 + 待批准数），随 mission / gate 事件更新。
 */
import { create } from 'zustand'
import type { DirectorAgentId } from '../harness/director/types'
import type { StudioDigest, StudioEvent } from '../studio/contracts'
import { DIRECTOR_AGENT_IDS } from '../studio/contracts'
import { studioBus } from '../studio/bus'
import { applyStudioDigest, emptyDigest, inheritDigestLedger } from '../studio/projection'
import { createDebouncedWriter } from '../lib/debouncedWrite'
import { useNotificationStore } from './notificationStore'
import { useSettingsStore } from './settingsStore'

type AgentStatus = 'idle' | 'running' | 'waiting'

/** 团队摘要账本（瞬态，不持久化；digest 只持久化派生后的 ≤6 行结果） */
const teamLedger: { ids: DirectorAgentId[]; status: Record<string, AgentStatus> } = {
  ids: [...DIRECTOR_AGENT_IDS],
  status: {},
}

/** gateId → ownerAgentId：门通过后把该成员从 waiting 归位（否则右栏团队会一直显示等待） */
const gateOwners: Record<string, DirectorAgentId> = {}

function allIdle(): void {
  teamLedger.status = {}
  for (const id of teamLedger.ids) teamLedger.status[id] = 'idle'
}

function mark(id: DirectorAgentId, status: AgentStatus): void {
  teamLedger.status[id] = status
}

function teamSummary(digest: StudioDigest): StudioDigest['team'] {
  return {
    agents: teamLedger.ids.map((id) => ({ id, status: teamLedger.status[id] ?? 'idle' })),
    pendingApprovals: digest.pendingDecisions,
  }
}

/** 事件 → 团队账本（best-effort：事件流缺时间线时保持上一次已知状态） */
function updateTeamLedger(event: StudioEvent): void {
  switch (event.type) {
    case 'mission.planned': {
      const ids = event.agentIds && event.agentIds.length > 0 ? event.agentIds : [...DIRECTOR_AGENT_IDS]
      teamLedger.ids = ids
      allIdle()
      break
    }
    case 'mission.started':
      for (const id of teamLedger.ids) mark(id, 'running')
      break
    case 'mission.task.done':
      mark(event.agentId, 'idle')
      break
    case 'gate.waiting':
      if (event.gate.ownerAgentId) {
        mark(event.gate.ownerAgentId, 'waiting')
        gateOwners[event.gate.gateId] = event.gate.ownerAgentId
      }
      break
    case 'gate.resolved': {
      const owner = gateOwners[event.gateId]
      if (owner) {
        mark(owner, 'idle')
        delete gateOwners[event.gateId]
      }
      break
    }
    case 'mission.partial':
    case 'mission.delivered':
      allIdle()
      for (const gateId of Object.keys(gateOwners)) delete gateOwners[gateId]
      break
    default:
      break
  }
}

interface DigestState {
  digest: StudioDigest
  apply: (event: StudioEvent) => void
  setUnreadNotices: (count: number) => void
  reset: () => void
}

const initialDigest = (): StudioDigest => {
  const persisted = useSettingsStore.getState().studio?.digest
  /* 持久化恢复的 digest 只做展示种子；预算 ≤1KB，损坏时回落空投影 */
  if (persisted && typeof persisted === 'object' && typeof persisted.pendingDecisions === 'number') {
    return { ...emptyDigest(), ...persisted }
  }
  return emptyDigest()
}
allIdle()

export const useStudioDigestStore = create<DigestState>((set, get) => ({
  digest: initialDigest(),

  apply: (event) => {
    updateTeamLedger(event)
    const next = applyStudioDigest(get().digest, event)
    /* 再叠加 unreadNotices 会产生新对象：必须继承派生账本，否则同一 gate 会重复计数 */
    const withNotices = inheritDigestLedger(next, {
      ...next,
      unreadNotices: get().digest.unreadNotices ?? 0,
      updatedAt: event.type === 'navigation.request' ? next.updatedAt : Date.now(),
    })
    withNotices.team = teamSummary(withNotices)
    set({ digest: withNotices })
    persistSoon.schedule()
  },

  setUnreadNotices: (count) => {
    if (get().digest.unreadNotices === count) return
    const digest: StudioDigest = { ...get().digest, unreadNotices: count, updatedAt: Date.now() }
    digest.team = teamSummary(digest)
    set({ digest })
    persistSoon.schedule()
  },

  reset: () => {
    teamLedger.ids = [...DIRECTOR_AGENT_IDS]
    for (const gateId of Object.keys(gateOwners)) delete gateOwners[gateId]
    allIdle()
    const digest = emptyDigest()
    digest.unreadNotices = 0
    digest.team = teamSummary(digest)
    set({ digest })
    persistSoon.schedule()
  },
}))

/** digest → settings.studio.digest（300ms 合并写，页面隐藏时由 settings 的 flush 兜底） */
const persistSoon = createDebouncedWriter(() => {
  useSettingsStore.getState().updateStudioDigest(useStudioDigestStore.getState().digest)
})

let started = false
let stopFns: (() => void)[] = []

/** 启动投影订阅（main.tsx 调用；幂等） */
export function startStudioDigestRuntime(): () => void {
  if (started) return () => {}
  started = true
  const store = useStudioDigestStore.getState()
  stopFns.push(
    studioBus.onAny((event) => useStudioDigestStore.getState().apply(event)),
    useNotificationStore.subscribe((state, prev) => {
      if (state.items === prev.items) return
      const unread = state.items.filter((n) => !n.read).length
      useStudioDigestStore.getState().setUnreadNotices(unread)
    }),
  )
  store.setUnreadNotices(useNotificationStore.getState().items.filter((n) => !n.read).length)
  return () => {
    started = false
    persistSoon.flush()
    stopFns.forEach((fn) => fn())
    stopFns = []
  }
}
