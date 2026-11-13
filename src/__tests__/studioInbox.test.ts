/**
 * v1.2 M0 · 派生收件箱单测（roadmap §2.4 / §3.4 / §4.4）
 * 覆盖：done/snoozed 窗口、notice 拆分、id/gateId 去重（先到优先）、优先级排序、countPending、inboxStore 覆盖态。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { countPending, deriveInbox, type InboxSourceItem } from '../studio/inbox'
import type { ApprovalGate } from '../studio/contracts'
import { useInboxStore } from '../stores/inboxStore'

/** 构造审批门（只填 inbox 需要的字段；其余按契约补默认） */
const gate = (gateId: string, extra: Partial<ApprovalGate> = {}): ApprovalGate => ({
  gateId,
  source: 'mission',
  title: `门 ${gateId}`,
  requiredAction: 'approve',
  sensitive: false,
  ...extra,
})

/** 构造来源 item */
const item = (patch: Partial<InboxSourceItem> & { id: string }): InboxSourceItem => ({
  source: 'mission',
  refId: `ref-${patch.id}`,
  title: `条目 ${patch.id}`,
  at: 0,
  ...patch,
})

describe('deriveInbox（v1.2 M0）', () => {
  it('空来源 → 空 decisions/notices，unreadDecisions 为 0', () => {
    const result = deriveInbox([], {}, 1000)
    expect(result.decisions).toEqual([])
    expect(result.notices).toEqual([])
    expect(result.unreadDecisions).toBe(0)
  })

  it('按 source/kind 拆分 decisions 与 notices（kind 优先于 source）', () => {
    const result = deriveInbox(
      [
        item({ id: 'm1', source: 'mission', at: 3 }),
        item({ id: 'b1', source: 'briefing', at: 2 }),
        item({ id: 'f1', source: 'taskFlow', at: 1 }),
        item({ id: 'n1', source: 'notice', at: 4 }),
        item({ id: 'm2', source: 'mission', kind: 'notice', at: 5 }),
      ],
      {},
      10,
    )
    expect(result.decisions.map((d) => d.id).sort()).toEqual(['b1', 'f1', 'm1'])
    expect(result.notices.map((n) => n.id).sort()).toEqual(['m2', 'n1'])
    expect(result.unreadDecisions).toBe(3)
  })

  it('done 覆盖态不出现（决策与通知都被过滤）', () => {
    const result = deriveInbox(
      [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'n', source: 'notice' })],
      { a: { status: 'done', resolvedAt: 5 }, n: { status: 'done', resolvedAt: 6 } },
      10,
    )
    expect(result.decisions.map((d) => d.id)).toEqual(['b'])
    expect(result.notices).toEqual([])
    expect(result.unreadDecisions).toBe(1)
  })

  it('snoozed 且时间窗未到 → 不出现；到期（snoozeUntil <= now）→ 回归', () => {
    const sources = [item({ id: 'early', at: 1 }), item({ id: 'late', at: 2 })]
    const overrides = {
      early: { status: 'snoozed' as const, snoozeUntil: 500 },
      late: { status: 'snoozed' as const, snoozeUntil: 2000 },
    }
    // early 已到期回归；late 时间窗未到仍隐藏
    const before = deriveInbox(sources, overrides, 1500)
    expect(before.decisions.map((d) => d.id)).toEqual(['early'])

    // 边界：snoozeUntil === now 视作到期回归（只有 > now 才隐藏）
    const boundary = deriveInbox(sources, overrides, 2000)
    expect(boundary.decisions.map((d) => d.id)).toEqual(['late', 'early'])
    const after = deriveInbox(sources, overrides, 2500)
    expect(after.decisions.map((d) => d.id)).toEqual(['late', 'early'])

    // snoozed 但无时间窗 → 视作已到期回归
    const noWindow = deriveInbox([item({ id: 'x' })], { x: { status: 'snoozed' } }, 100)
    expect(noWindow.decisions.map((d) => d.id)).toEqual(['x'])
  })

  it('同 id 去重：先到优先（保留数组中靠前一条）', () => {
    const result = deriveInbox(
      [
        item({ id: 'dup', title: '先到', at: 1 }),
        item({ id: 'dup', title: '后来', at: 9 }),
      ],
      {},
      10,
    )
    expect(result.decisions).toHaveLength(1)
    expect(result.decisions[0].title).toBe('先到')
  })

  it('同 gate.gateId 去重（id 不同也视为同一件事，先到优先）', () => {
    const result = deriveInbox(
      [
        item({ id: 'g-at', refId: 'gate', gate: gate('gate-1'), at: 1 }),
        item({ id: 'g-other', refId: 'gate', gate: gate('gate-1'), at: 2 }),
      ],
      {},
      10,
    )
    expect(result.decisions).toHaveLength(1)
    expect(result.decisions[0].id).toBe('g-at')
  })

  it('去重先于覆盖态过滤：靠前条目被 done 时，同 id 后来者不顶替', () => {
    const result = deriveInbox(
      [
        item({ id: 'dup', title: '先到' }),
        item({ id: 'dup', title: '后来' }),
      ],
      { dup: { status: 'done' } },
      10,
    )
    expect(result.decisions).toEqual([])
  })

  it('排序：显式 priority 降序（缺省按 0）', () => {
    const result = deriveInbox(
      [
        item({ id: 'none', at: 100 }),
        item({ id: 'low', priority: 1, at: 90 }),
        item({ id: 'high', priority: 9, at: 80 }),
        item({ id: 'zero', priority: 0, at: 95 }),
      ],
      {},
      100,
    )
    expect(result.decisions.map((d) => d.id)).toEqual(['high', 'low', 'none', 'zero'])
  })

  it('排序：同 priority 时带审批门者优先', () => {
    const result = deriveInbox(
      [
        item({ id: 'plain', priority: 5, at: 200 }),
        item({ id: 'gated', priority: 5, at: 100, gate: gate('g-1') }),
      ],
      {},
      300,
    )
    expect(result.decisions.map((d) => d.id)).toEqual(['gated', 'plain'])
  })

  it('排序：同 priority 且门状态相同 → at 降序，最后 id 升序兜底', () => {
    const result = deriveInbox(
      [
        item({ id: 'old', at: 100 }),
        item({ id: 'new', at: 300 }),
        item({ id: 'b-tie', at: 200 }),
        item({ id: 'a-tie', at: 200 }),
      ],
      {},
      400,
    )
    expect(result.decisions.map((d) => d.id)).toEqual(['new', 'a-tie', 'b-tie', 'old'])
  })

  it('不修改入参数组（纯函数）', () => {
    const sources = [
      item({ id: 'b', at: 1 }),
      item({ id: 'a', priority: 3, at: 2 }),
    ]
    const snapshot = sources.slice()
    deriveInbox(sources, {}, 10)
    expect(sources).toEqual(snapshot)
  })

  it('countPending 与 deriveInbox 的 unreadDecisions 一致，不含 notices', () => {
    const sources = [
      item({ id: 'd1' }),
      item({ id: 'n1', source: 'notice' }),
      item({ id: 'd2', gate: gate('g-2') }),
      item({ id: 'd3' }),
    ]
    const overrides = { d3: { status: 'snoozed' as const, snoozeUntil: 9999 } }
    const result = deriveInbox(sources, overrides, 100)
    expect(countPending(sources, overrides, 100)).toBe(result.unreadDecisions)
    expect(countPending(sources, overrides, 100)).toBe(2)
  })
})

describe('inboxStore 覆盖态（v1.2 M0）', () => {
  beforeEach(() => {
    useInboxStore.getState().reset()
  })

  it('resolve 标记 done 后派生列表不再出现，并记录 resolvedAt', () => {
    const sources = [item({ id: 'a', at: 1 }), item({ id: 'b', at: 2 })]
    expect(deriveInbox(sources, useInboxStore.getState().overrides, 100).unreadDecisions).toBe(2)

    useInboxStore.getState().resolve('a')
    const { overrides } = useInboxStore.getState()
    expect(overrides.a.status).toBe('done')
    expect(typeof overrides.a.resolvedAt).toBe('number')

    const result = deriveInbox(sources, overrides, 100)
    expect(result.decisions.map((d) => d.id)).toEqual(['b'])
    expect(result.unreadDecisions).toBe(1)
  })

  it('snooze 窗口内不出现，到期后回归', () => {
    const sources = [item({ id: 'a' })]
    useInboxStore.getState().snooze('a', 5000)
    expect(deriveInbox(sources, useInboxStore.getState().overrides, 4000).decisions).toEqual([])
    expect(deriveInbox(sources, useInboxStore.getState().overrides, 6000).decisions).toHaveLength(1)
  })

  it('setStatus 支持 done/snoozed，reset 清空全部覆盖态', () => {
    useInboxStore.getState().setStatus('a', 'done')
    expect(useInboxStore.getState().overrides.a.status).toBe('done')
    expect(useInboxStore.getState().overrides.a.snoozeUntil).toBeUndefined()

    useInboxStore.getState().snooze('b', 9000)
    useInboxStore.getState().setStatus('b', 'snoozed')
    expect(useInboxStore.getState().overrides.b.snoozeUntil).toBe(9000)

    useInboxStore.getState().reset()
    expect(useInboxStore.getState().overrides).toEqual({})
  })
})
