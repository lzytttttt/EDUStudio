/**
 * v1.2 M2 · StudioDigest 只读投影运行时单测（roadmap §2.4 / §3.4 / §6 M2）
 * 覆盖：计数投影、团队摘要、未读通知、≤1KB、持久化到 settings.studio.digest。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalGate } from '../studio/contracts'
import { studioBus } from '../studio/bus'
import { digestSize, isDigestWithinBudget } from '../studio/projection'
import { startStudioDigestRuntime, useStudioDigestStore } from '../stores/studioDigestStore'
import { useNotificationStore } from '../stores/notificationStore'
import { flushSettingsPersist, useSettingsStore } from '../stores/settingsStore'

const GATE: ApprovalGate = {
  gateId: 'worksheet',
  missionId: 'm-1',
  source: 'mission',
  title: '分层练习单待批',
  ownerAgentId: 'assessor',
  requiredAction: 'approve',
  sensitive: false,
}

function reset(): void {
  useStudioDigestStore.getState().reset()
  useNotificationStore.setState({ items: [] })
}

describe('StudioDigest 投影运行时', () => {
  beforeEach(reset)
  afterEach(() => {
    vi.useRealTimers()
  })

  it('mission.planned：在办数/任务数 + 团队摘要初始 idle', () => {
    useStudioDigestStore.getState().apply({
      type: 'mission.planned',
      missionId: 'm-1',
      kind: 'parent_meeting',
      planSource: 'template',
      tasks: 5,
      agentIds: ['chief', 'analyst', 'communicator'],
    })
    const d = useStudioDigestStore.getState().digest
    expect(d.runningMissions).toBe(1)
    expect(d.runningTasks).toBe(5)
    expect(d.team?.agents).toEqual([
      { id: 'chief', status: 'idle' },
      { id: 'analyst', status: 'idle' },
      { id: 'communicator', status: 'idle' },
    ])
  })

  it('mission.started → 成员 running；task.done → 该成员 idle；delivered → 全部 idle', () => {
    const store = useStudioDigestStore.getState()
    store.apply({ type: 'mission.planned', missionId: 'm-1', kind: 'parent_meeting', planSource: 'template', tasks: 3, agentIds: ['chief', 'analyst'] })
    store.apply({ type: 'mission.started', missionId: 'm-1', execution: 'mock' })
    expect(useStudioDigestStore.getState().digest.team?.agents.every((a) => a.status === 'running')).toBe(true)

    store.apply({ type: 'mission.task.done', missionId: 'm-1', taskId: 't1', agentId: 'analyst' })
    expect(useStudioDigestStore.getState().digest.team?.agents.find((a) => a.id === 'analyst')?.status).toBe('idle')

    store.apply({ type: 'mission.delivered', missionId: 'm-1', artifactIds: ['d1'] })
    expect(useStudioDigestStore.getState().digest.team?.agents.every((a) => a.status === 'idle')).toBe(true)
  })

  it('gate.waiting → 待决策数/待批准数 + ownerAgentId waiting；resolved 后回落并归位 idle', () => {
    const store = useStudioDigestStore.getState()
    store.apply({ type: 'gate.waiting', gate: GATE })
    let d = useStudioDigestStore.getState().digest
    expect(d.pendingDecisions).toBe(1)
    expect(d.team?.pendingApprovals).toBe(1)
    expect(d.team?.agents.find((a) => a.id === 'assessor')?.status).toBe('waiting')

    store.apply({ type: 'gate.resolved', gateId: 'worksheet', resolution: 'continue' })
    d = useStudioDigestStore.getState().digest
    expect(d.pendingDecisions).toBe(0)
    expect(d.team?.pendingApprovals).toBe(0)
    /* 门通过后 owner 从 waiting 归位（右栏团队摘要不应一直显示等待） */
    expect(d.team?.agents.find((a) => a.id === 'assessor')?.status).toBe('idle')
  })

  it('同 gateId 重复 waiting 不重复计数', () => {
    const store = useStudioDigestStore.getState()
    store.apply({ type: 'gate.waiting', gate: GATE })
    store.apply({ type: 'gate.waiting', gate: GATE })
    expect(useStudioDigestStore.getState().digest.pendingDecisions).toBe(1)
  })

  it('digest 恒 ≤1KB 且包含团队摘要后仍不超限', () => {
    const store = useStudioDigestStore.getState()
    store.apply({ type: 'mission.planned', missionId: 'm-1', kind: 'parent_meeting', planSource: 'template', tasks: 5 })
    store.apply({ type: 'gate.waiting', gate: GATE })
    const d = useStudioDigestStore.getState().digest
    expect(digestSize(d)).toBeLessThanOrEqual(1024)
    expect(isDigestWithinBudget(d)).toBe(true)
  })

  it('未读通知数由通知中心驱动（启动运行时后订阅）', () => {
    const stop = startStudioDigestRuntime()
    useNotificationStore.getState().push({ kind: 'system', title: '通知一', body: '' })
    useNotificationStore.getState().push({ kind: 'system', title: '通知二', body: '' })
    expect(useStudioDigestStore.getState().digest.unreadNotices).toBe(2)
    useNotificationStore.getState().markAllRead()
    expect(useStudioDigestStore.getState().digest.unreadNotices).toBe(0)
    stop()
  })

  it('事件写入后 300ms 合并持久化到 settings.studio.digest', () => {
    vi.useFakeTimers()
    useStudioDigestStore.getState().apply({ type: 'gate.waiting', gate: GATE })
    vi.advanceTimersByTime(400)
    expect(useSettingsStore.getState().studio.digest.pendingDecisions).toBe(1)
    flushSettingsPersist()
    const raw = window.localStorage.getItem('edustudio:settings')
    expect(raw).toContain('"pendingDecisions":1')
  })

  it('未知/无关事件不改计数（不可变返回）', () => {
    const before = useStudioDigestStore.getState().digest
    useStudioDigestStore.getState().apply({ type: 'navigation.request', target: { kind: 'inbox' } })
    const after = useStudioDigestStore.getState().digest
    expect(after.pendingDecisions).toBe(before.pendingDecisions)
    expect(after).not.toBe(before)
  })

  it('bus 事件会被运行时自动投影（onAny 订阅）', () => {
    const stop = startStudioDigestRuntime()
    studioBus.emit({ type: 'gate.waiting', gate: GATE })
    expect(useStudioDigestStore.getState().digest.pendingDecisions).toBe(1)
    stop()
  })
})
