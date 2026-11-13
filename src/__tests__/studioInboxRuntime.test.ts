/**
 * v1.2 M2 · 统一收件箱运行时单测（roadmap §2.3 F1/F6、§2.4、§3.4）
 * 覆盖：来源收集（gate / 简报采纳 / taskFlow / 通知）、覆盖态、去重/排序、角标口径、订阅启停。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { ApprovalGate } from '../studio/contracts'
import { studioBus } from '../studio/bus'
import {
  inboxCounts,
  selectStudioInbox,
  startStudioInboxSources,
  useStudioInboxStore,
} from '../stores/studioInboxStore'
import { useNotificationStore } from '../stores/notificationStore'
import { useTaskFlowStore } from '../stores/taskFlowStore'
import { useAuthStore } from '../stores/authStore'
import type { InboxSourceItem } from '../studio/inbox'

const GATE: ApprovalGate = {
  gateId: 'speech',
  missionId: 'm-1',
  source: 'mission',
  title: '家长会讲稿待批',
  ownerAgentId: 'communicator',
  requiredAction: 'approve',
  sensitive: true,
}

function hostedItem(id: string, at = 1000): InboxSourceItem {
  return { id, source: 'briefing', refId: id.replace('card:', ''), title: `已交给战队 ${id}`, at }
}

function resetStores(): void {
  useStudioInboxStore.setState({ gates: {}, hosted: [], taskFlow: [], notices: [], overrides: {} })
  useNotificationStore.setState({ items: [] })
  useTaskFlowStore.setState({ flows: [] })
  useAuthStore.setState({ role: 'teacher' })
}

describe('selectStudioInbox（派生口径）', () => {
  beforeEach(resetStores)

  it('空来源：decisions/notices 都是空，角标为 0', () => {
    const result = selectStudioInbox(useStudioInboxStore.getState(), 10_000)
    expect(result.decisions).toEqual([])
    expect(result.notices).toEqual([])
    expect(inboxCounts(result)).toEqual({ decisions: 0, notices: 0, total: 0 })
  })

  it('审批门 > taskFlow > 简报采纳：显式优先级排序', () => {
    useStudioInboxStore.setState({
      gates: { speech: { gate: GATE, at: 3000 } },
      taskFlow: [{ ...hostedItem('flow:1', 2000), source: 'taskFlow', priority: 60 }],
      hosted: [hostedItem('card:a', 1000)],
    })
    const { decisions } = selectStudioInbox(useStudioInboxStore.getState(), 10_000)
    expect(decisions.map((d) => d.id)).toEqual(['gate:speech', 'flow:1', 'card:a'])
  })

  it('同一 gateId 重复 waiting 只出一条（去重先到优先）', () => {
    useStudioInboxStore.getState().recordGate(GATE)
    useStudioInboxStore.getState().recordGate({ ...GATE, title: '重复标题' })
    expect(selectStudioInbox(useStudioInboxStore.getState(), 10_000).decisions).toHaveLength(1)
  })

  it('resolve 后条目从派生列表消失（覆盖态 done）', () => {
    useStudioInboxStore.getState().recordGate(GATE)
    useStudioInboxStore.getState().resolve('gate:speech')
    expect(selectStudioInbox(useStudioInboxStore.getState(), 10_000).decisions).toHaveLength(0)
  })

  it('snooze 未到期隐藏、到期回归', () => {
    useStudioInboxStore.getState().addHosted(hostedItem('card:a'))
    useStudioInboxStore.getState().snooze('card:a', 20_000)
    expect(selectStudioInbox(useStudioInboxStore.getState(), 10_000).decisions).toHaveLength(0)
    expect(selectStudioInbox(useStudioInboxStore.getState(), 25_000).decisions).toHaveLength(1)
  })

  it('同 id 的 hosted 幂等（重复采纳不重复计数）', () => {
    useStudioInboxStore.getState().addHosted(hostedItem('card:a'))
    useStudioInboxStore.getState().addHosted(hostedItem('card:a'))
    expect(selectStudioInbox(useStudioInboxStore.getState(), 10_000).decisions).toHaveLength(1)
  })

  it('notice 来源进只读 notices，不计入待办角标', () => {
    useStudioInboxStore.setState({
      notices: [{ id: 'notice:n1', source: 'notice', refId: 'n1', title: '系统提示', kind: 'notice', at: 1 }],
      hosted: [hostedItem('card:a')],
    })
    const result = selectStudioInbox(useStudioInboxStore.getState(), 10_000)
    expect(result.notices).toHaveLength(1)
    expect(inboxCounts(result)).toEqual({ decisions: 1, notices: 1, total: 2 })
  })

  it('resolveGate 清门并写覆盖态', () => {
    useStudioInboxStore.getState().recordGate(GATE)
    useStudioInboxStore.getState().resolveGate('speech')
    const state = useStudioInboxStore.getState()
    expect(state.gates.speech).toBeUndefined()
    expect(state.overrides['gate:speech']?.status).toBe('done')
  })
})

describe('startStudioInboxSources（事件 → 来源）', () => {
  beforeEach(resetStores)

  it('gate.waiting / gate.resolved 事件闭环', () => {
    const stop = startStudioInboxSources()
    studioBus.emit({ type: 'gate.waiting', gate: GATE })
    expect(useStudioInboxStore.getState().gates.speech).toBeTruthy()
    studioBus.emit({ type: 'gate.resolved', gateId: 'speech', resolution: 'continue' })
    expect(useStudioInboxStore.getState().gates.speech).toBeUndefined()
    stop()
  })

  it('card.accepted → 简报同源待办（带会话 action，可用于点开看会话）', () => {
    const stop = startStudioInboxSources()
    studioBus.emit({
      type: 'card.accepted',
      cardId: 'd-drill',
      role: 'teacher',
      goal: '出一套分层练习单',
      title: '分层练习已备好',
      sessionId: 's-1',
    })
    const { decisions } = selectStudioInbox(useStudioInboxStore.getState(), 10_000)
    expect(decisions).toHaveLength(1)
    expect(decisions[0].title).toBe('分层练习已备好')
    expect(decisions[0].action).toEqual({ kind: 'chat', sessionId: 's-1' })
    stop()
  })

  it('通知中心未读 → notices（订阅刷新）', () => {
    const stop = startStudioInboxSources()
    useNotificationStore.getState().push({ kind: 'system', title: '需要教师身份', body: '测试' })
    expect(useStudioInboxStore.getState().notices).toHaveLength(1)
    stop()
  })

  it('taskFlow 待回执 → 当前角色决策项（订阅刷新）', () => {
    const stop = startStudioInboxSources()
    useTaskFlowStore.setState({
      flows: [
        {
          id: 'tf-x',
          title: '期中质量分析',
          content: '',
          from: '区教育局',
          fromRole: 'bureau',
          issuedAt: 1000,
          deadline: '本周五',
          receipts: [{ id: 'r-x', target: '李老师', targetRole: 'teacher', status: 'pending' }],
        },
      ],
    })
    const items = useStudioInboxStore.getState().taskFlow
    expect(items).toHaveLength(1)
    expect(items[0].refId).toBe('r-x')
    stop()
  })

  it('stop 后不再响应事件', () => {
    const stop = startStudioInboxSources()
    stop()
    studioBus.emit({ type: 'gate.waiting', gate: GATE })
    expect(useStudioInboxStore.getState().gates.speech).toBeUndefined()
  })
})
