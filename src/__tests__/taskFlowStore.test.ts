import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useTaskFlowStore,
  enqueue,
  mergeFlows,
  fromServerFlow,
  flowsForRole,
  type PendingOp,
  type ServerFlow,
} from '../stores/taskFlowStore'
import { useSettingsStore } from '../stores/settingsStore'
import { SEED_TASK_FLOWS } from '../data/taskFlow'
import type { TaskFlow } from '../data/taskFlow'

/* 断网降级与补推（v0.9.5 P1-B）：现场拔网线再恢复的完整闭环 */

const serverFlow = (over: Partial<ServerFlow> = {}): ServerFlow => ({
  id: 'srv-1',
  title: '期中质量分析',
  content: '内容',
  deadline: '本周五',
  from: '区教育局',
  fromRole: 'bureau',
  createdAt: 1_700_000_000_000,
  receipts: [{ id: 'r1', name: '实验一中', role: 'schoolAdmin', status: 'pending', note: '', updatedAt: 0 }],
  ...over,
})

describe('enqueue · 待补推队列', () => {
  it('同一条操作重复失败只排一次', () => {
    const op: PendingOp = { kind: 'create', flowId: 'tf-x' }
    expect(enqueue(enqueue([], op), op)).toHaveLength(1)
  })

  it('create 与 receipt 不互相去重', () => {
    const ops = enqueue(enqueue([], { kind: 'create', flowId: 'tf-x' }), {
      kind: 'receipt',
      flowId: 'tf-x',
      receiptId: 'r1',
      action: 'acknowledge',
    })
    expect(ops).toHaveLength(2)
  })

  it('不同班级的回执分别入队', () => {
    const mk = (receiptId: string): PendingOp => ({ kind: 'receipt', flowId: 'tf-x', receiptId, action: 'acknowledge' })
    expect(enqueue(enqueue([], mk('r1')), mk('r2'))).toHaveLength(2)
  })
})

describe('mergeFlows / fromServerFlow', () => {
  it('远端为准、本地独有保留，按下发时间倒序', () => {
    const local: TaskFlow[] = [{ ...fromServerFlow(serverFlow({ id: 'local-1', createdAt: 1 })) }]
    const merged = mergeFlows(local, [fromServerFlow(serverFlow({ createdAt: 2 }))])
    expect(merged.map((f) => f.id)).toEqual(['srv-1', 'local-1'])
  })

  it('同一 id 以远端为准', () => {
    const local: TaskFlow[] = [{ ...fromServerFlow(serverFlow({ title: '本地旧标题' })) }]
    expect(mergeFlows(local, [fromServerFlow(serverFlow({ title: '服务端新标题' }))])[0].title).toBe(
      '服务端新标题',
    )
  })

  it('服务端回执映射为本地状态，未知状态回退待接收', () => {
    const f = fromServerFlow(
      serverFlow({ receipts: [{ id: 'r1', name: '实验一中', role: 'schoolAdmin', status: 'weird', note: '', updatedAt: 0 }] }),
    )
    expect(f.receipts[0].status).toBe('pending')
    expect(f.receipts[0].target).toBe('实验一中')
  })
})

describe('预置进行中任务链（v0.9.5 P1-C）', () => {
  it('种子数据里已有一条回执过半、未全部完成的局→校任务', () => {
    const flow = SEED_TASK_FLOWS.find((f) => f.id === 'tf-4')
    expect(flow).toBeDefined()
    const done = flow!.receipts.filter((r) => r.status !== 'pending')
    expect(done.length).toBeGreaterThan(0)
    expect(done.length).toBeLessThan(flow!.receipts.length)
  })

  it('局侧进场即可见该任务链', () => {
    expect(flowsForRole(SEED_TASK_FLOWS, 'bureau').map((f) => f.id)).toContain('tf-4')
  })
})

describe('断网降级 → 恢复后自动补推（v0.9.5 P1-B）', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  /** GET 列表与 POST 创建返回不同结构，mock 必须按 method 分开给 */
  const okServer = () =>
    vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      json: async () => (init?.method === 'POST' ? { flow: serverFlow() } : { flows: [] }),
    }))

  beforeEach(() => {
    useSettingsStore.setState({ proxyUrl: 'http://proxy.test/v1' })
    useTaskFlowStore.setState({ flows: [], syncState: 'local', pendingOps: [] })
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const issueOne = () =>
    useTaskFlowStore.getState().issue({
      title: '期中质量分析',
      content: '内容',
      deadline: '本周五',
      targets: [{ name: '实验一中', role: 'schoolAdmin' }],
    })

  it('下发时服务不可用：状态转 degraded 且操作入队，不丢数据', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    issueOne()
    await vi.waitFor(() => expect(useTaskFlowStore.getState().syncState).toBe('degraded'))
    expect(useTaskFlowStore.getState().flows).toHaveLength(1)
    expect(useTaskFlowStore.getState().pendingOps).toEqual([
      { kind: 'create', flowId: useTaskFlowStore.getState().flows[0].id },
    ])
  })

  it('服务恢复：refresh 补推队列并清空，同步状态回到已同步', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    issueOne()
    await vi.waitFor(() => expect(useTaskFlowStore.getState().pendingOps).toHaveLength(1))

    fetchMock.mockImplementation(okServer())
    await useTaskFlowStore.getState().refresh()

    expect(useTaskFlowStore.getState().pendingOps).toEqual([])
    expect(useTaskFlowStore.getState().syncState).toBe('remote')
    /* 补推后任务链换成服务端返回的 id，本地那条不再重复 */
    expect(useTaskFlowStore.getState().flows[0].id).toBe('srv-1')
  })

  it('补推后仍失败则保留队列，不谎报已同步', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    issueOne()
    await vi.waitFor(() => expect(useTaskFlowStore.getState().pendingOps).toHaveLength(1))

    /* GET 成功（网络恢复）但补推的 POST 仍失败 */
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') throw new Error('still offline')
      return { ok: true, json: async () => ({ flows: [] }) }
    })
    await useTaskFlowStore.getState().refresh()

    expect(useTaskFlowStore.getState().pendingOps).toHaveLength(1)
    expect(useTaskFlowStore.getState().syncState).not.toBe('remote')
  })
})
