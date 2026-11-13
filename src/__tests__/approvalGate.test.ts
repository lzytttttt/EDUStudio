import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  decideGateAction,
  gateActionLabel,
  gateEvidenceChips,
  gateSourceLabel,
} from '../components/ApprovalGateCard'
import type { ApprovalGate, StudioEvent } from '../studio/contracts'
import { hasGateResolver, registerGateResolver, resetGateRegistry, resolveGate } from '../studio/gateRegistry'
import { installLoomGateBridge, loomApprovalGate, loomGateId } from '../integrations/studio/loomGates'
import { useLoomStore } from '../stores/loomStore'
import { studioBus } from '../studio/bus'

/**
 * v1.2 M3b · 审批门统一（roadmap §4.4）：
 * - gateRegistry 一次性出口（register / resolve / dispose）；
 * - 统一决策卡的「先 resolveGate 再回退旧回调」纯函数；
 * - 展示纯函数（来源 badge / 依据 chips）；
 * - Loom checkpoint → ApprovalGate 桥（gate.waiting / gate.resolved / 幂等 / 卸载）。
 */

type GateEvent = Extract<StudioEvent, { type: 'gate.waiting' | 'gate.resolved' }>

let gateEvents: GateEvent[] = []
let offBus: (() => void) | null = null
let cleanups: (() => void)[] = []

function installBridge(options: Parameters<typeof installLoomGateBridge>[0] = {}): () => void {
  const cleanup = installLoomGateBridge(options)
  cleanups.push(cleanup)
  return cleanup
}

/** 造一个 teacher 画布 + 指定状态的 checkpoint 节点 */
function makeBoardWithCheckpoint(status: 'waiting' | 'idle' | 'done' = 'waiting'): {
  boardId: string
  nodeId: string
} {
  const board = useLoomStore.getState().ensureBoard('teacher')
  const nodeId = useLoomStore.getState().addNode({ type: 'checkpoint', title: '确认教案' })
  if (!nodeId) throw new Error('addNode 失败')
  useLoomStore.getState().setNodeStatus(nodeId, status)
  return { boardId: board.id, nodeId }
}

function waitingEvents(): Extract<GateEvent, { type: 'gate.waiting' }>[] {
  return gateEvents.filter((event): event is Extract<GateEvent, { type: 'gate.waiting' }> => event.type === 'gate.waiting')
}

function resolvedEvents(): Extract<GateEvent, { type: 'gate.resolved' }>[] {
  return gateEvents.filter((event): event is Extract<GateEvent, { type: 'gate.resolved' }> => event.type === 'gate.resolved')
}

beforeEach(() => {
  localStorage.clear()
  resetGateRegistry()
  useLoomStore.setState({ boards: [], activeBoardId: null })
  gateEvents = []
  cleanups = []
  offBus = studioBus.onAny((event) => {
    if (event.type === 'gate.waiting' || event.type === 'gate.resolved') gateEvents.push(event)
  })
})

afterEach(() => {
  offBus?.()
  offBus = null
  cleanups.forEach((fn) => fn())
  cleanups = []
  resetGateRegistry()
})

describe('gateRegistry：一次性出口', () => {
  it('注册后可解析：第一次 true，重复解析 false（同一门只解决一次）', () => {
    const calls: string[] = []
    const registered = registerGateResolver('m-1:speech', (action) => calls.push(action))
    expect(registered.ok).toBe(true)
    expect(hasGateResolver('m-1:speech')).toBe(true)

    expect(resolveGate('m-1:speech', 'continue')).toBe(true)
    expect(resolveGate('m-1:speech', 'cancel')).toBe(false)
    expect(calls).toEqual(['continue'])
    expect(hasGateResolver('m-1:speech')).toBe(false)
  })

  it('同一 gateId 重复注册返回 ok=false，先注册者拥有该门（不覆盖）', () => {
    const calls: string[] = []
    expect(registerGateResolver('loom:b:n', () => calls.push('first')).ok).toBe(true)
    expect(registerGateResolver('loom:b:n', () => calls.push('second')).ok).toBe(false)

    resolveGate('loom:b:n', 'continue')
    expect(calls).toEqual(['first'])
  })

  it('dispose 后门不可解析；未知 gateId 返回 false', () => {
    const registered = registerGateResolver('g-1', () => undefined)
    registered.dispose()
    expect(hasGateResolver('g-1')).toBe(false)
    expect(resolveGate('g-1', 'continue')).toBe(false)
    expect(resolveGate('never-registered', 'continue')).toBe(false)
  })

  it('resolver 抛错被隔离：resolveGate 仍返回 true，不打断调用方', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    registerGateResolver('g-throw', () => {
      throw new Error('boom')
    })
    expect(() => resolveGate('g-throw', 'continue')).not.toThrow()
    expect(hasGateResolver('g-throw')).toBe(false)
    spy.mockRestore()
  })
})

describe('decideGateAction：先统一出口，再回退旧回调', () => {
  it('resolver 返回 true → resolved，旧回调不再执行', () => {
    const fallback = vi.fn()
    const outcome = decideGateAction('g-1', 'continue', { resolve: () => true, fallback })
    expect(outcome).toBe('resolved')
    expect(fallback).not.toHaveBeenCalled()
  })

  it('resolver 返回 false（无注册 / resolver 已消费）→ 回退旧回调', () => {
    const fallback = vi.fn()
    const outcome = decideGateAction('g-1', 'cancel', { resolve: () => false, fallback })
    expect(outcome).toBe('fallback')
    expect(fallback).toHaveBeenCalledTimes(1)
  })

  it('无 resolve / fallback → unhandled；gateId 为空时跳过统一出口直接回退', () => {
    expect(decideGateAction('g-1', 'continue')).toBe('unhandled')

    const resolve = vi.fn(() => true)
    const fallback = vi.fn()
    expect(decideGateAction('', 'continue', { resolve, fallback })).toBe('fallback')
    expect(resolve).not.toHaveBeenCalled()
    expect(fallback).toHaveBeenCalledTimes(1)
  })

  it('resolver 抛错 → 隔离并回退旧回调', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fallback = vi.fn()
    const outcome = decideGateAction('g-throw', 'continue', {
      resolve: () => {
        throw new Error('boom')
      },
      fallback,
    })
    expect(outcome).toBe('fallback')
    expect(fallback).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('与真实 gateRegistry 组合：第一次走统一出口，第二次回退旧回调', () => {
    const handled: string[] = []
    const fallback = vi.fn()
    registerGateResolver('loom:board-1:lnode-1', (action) => handled.push(action))

    expect(
      decideGateAction('loom:board-1:lnode-1', 'continue', { resolve: resolveGate, fallback }),
    ).toBe('resolved')
    expect(
      decideGateAction('loom:board-1:lnode-1', 'continue', { resolve: resolveGate, fallback }),
    ).toBe('fallback')
    expect(handled).toEqual(['continue'])
    expect(fallback).toHaveBeenCalledTimes(1)
  })
})

describe('统一卡展示纯函数', () => {
  it('来源 badge：mission=战队，loom=画布；门后动作文案', () => {
    expect(gateSourceLabel('mission')).toBe('战队')
    expect(gateSourceLabel('loom')).toBe('画布')
    expect(gateActionLabel('approve')).toBe('需拍板')
    expect(gateActionLabel('edit')).toBe('需修改')
    expect(gateActionLabel('continue')).toBe('需确认')
  })

  it('依据 chips：无 evidence → 空；citations + 校验通过 → ok', () => {
    expect(gateEvidenceChips(undefined)).toEqual([])
    expect(gateEvidenceChips({ citations: [], verification: { total: 0, verified: 0, derived: 0, conflict: 0, unverified: 0, structural: 0 } })).toEqual([])

    const chips = gateEvidenceChips({
      citations: [{ value: '82.4', source: '学情库' }],
      verification: { total: 3, verified: 2, derived: 1, conflict: 0, unverified: 0, structural: 0 },
    })
    expect(chips).toEqual([
      { key: 'citations', label: '依据 1 条', tone: 'mute' },
      { key: 'verified', label: '已核 3/3', tone: 'ok' },
    ])
  })

  it('依据 chips：冲突 / 待核 → warn 并以计数展示', () => {
    const chips = gateEvidenceChips({
      citations: [],
      verification: { total: 5, verified: 2, derived: 1, conflict: 1, unverified: 1, structural: 1 },
    })
    expect(chips.map((chip) => [chip.key, chip.tone])).toEqual([
      ['verified', 'warn'],
      ['conflict', 'warn'],
      ['unverified', 'warn'],
    ])
    expect(chips.find((chip) => chip.key === 'conflict')?.label).toBe('冲突 1')
    expect(chips.find((chip) => chip.key === 'unverified')?.label).toBe('待核 1')
  })
})

describe('Loom checkpoint → 统一审批门', () => {
  it('loomGateId / loomApprovalGate：字段与 mission 门同形（source=loom）', () => {
    const board = useLoomStore.getState().ensureBoard('teacher')
    const nodeId = useLoomStore.getState().addNode({ type: 'checkpoint', title: '确认分层练习' })
    if (!nodeId) throw new Error('addNode 失败')
    const node = useLoomStore.getState().activeBoard()?.nodes.find((n) => n.id === nodeId)
    if (!node) throw new Error('节点缺失')

    expect(loomGateId(board.id, node.id)).toBe(`loom:${board.id}:${node.id}`)
    expect(loomApprovalGate(board, node)).toMatchObject({
      gateId: `loom:${board.id}:${node.id}`,
      taskId: node.id,
      source: 'loom',
      title: '确认分层练习待确认',
      requiredAction: 'continue',
      sensitive: false,
    })
  })

  it('安装即对齐：已在等待的 checkpoint → 立即 emit gate.waiting（注册成功才发）', () => {
    const { boardId, nodeId } = makeBoardWithCheckpoint('waiting')
    installBridge()

    expect(waitingEvents()).toHaveLength(1)
    const gate = waitingEvents()[0].gate
    expect(gate.gateId).toBe(`loom:${boardId}:${nodeId}`)
    expect(gate.source).toBe('loom')
    expect(gate.title).toBe('确认教案待确认')
    expect(hasGateResolver(gate.gateId)).toBe(true)
  })

  it('gate.waiting 按 gateId 去重：重复安装 / 重复状态变化不重复发', () => {
    makeBoardWithCheckpoint('waiting')
    const first = installBridge()
    const second = installBridge()
    expect(second).toBe(first)
    expect(waitingEvents()).toHaveLength(1)

    /* 无关状态变化（节点 patch 但仍在 waiting）不重复发 */
    const nodeId = useLoomStore.getState().activeBoard()?.nodes[0]?.id ?? ''
    useLoomStore.getState().updateNode(nodeId, { description: '补充说明' })
    expect(waitingEvents()).toHaveLength(1)
  })

  it('resolver 收到 action → 只调用一次 resume（注入替身），节点 done 后 emit gate.resolved', () => {
    const resume = vi.fn()
    const { nodeId } = makeBoardWithCheckpoint('waiting')
    installBridge({ resume })

    const gateId = `loom:${useLoomStore.getState().activeBoard()?.id}:${nodeId}`
    expect(resolveGate(gateId, 'continue')).toBe(true)
    expect(resume).toHaveBeenCalledTimes(1)
    expect(resume).toHaveBeenCalledWith(nodeId, 'continue')

    useLoomStore.getState().setNodeStatus(nodeId, 'done')
    expect(resolvedEvents()).toEqual([{ type: 'gate.resolved', gateId, resolution: 'continue' }])
    expect(hasGateResolver(gateId)).toBe(false)
  })

  it('节点回 idle（取消）→ gate.resolved resolution=cancel', () => {
    const { boardId, nodeId } = makeBoardWithCheckpoint('waiting')
    installBridge({ resume: vi.fn() })
    const gateId = `loom:${boardId}:${nodeId}`

    useLoomStore.getState().setNodeStatus(nodeId, 'idle')
    expect(resolvedEvents()).toEqual([{ type: 'gate.resolved', gateId, resolution: 'cancel' }])
  })

  it('节点从画布移除 → gate.resolved（按 continue 收口）并释放 resolver', () => {
    const { boardId, nodeId } = makeBoardWithCheckpoint('waiting')
    installBridge({ resume: vi.fn() })
    const gateId = `loom:${boardId}:${nodeId}`

    useLoomStore.getState().removeNode(nodeId)
    expect(resolvedEvents()).toEqual([{ type: 'gate.resolved', gateId, resolution: 'continue' }])
    expect(hasGateResolver(gateId)).toBe(false)
  })

  it('非 checkpoint / 非 waiting 节点不投影为审批门', () => {
    const board = useLoomStore.getState().ensureBoard('teacher')
    const taskId = useLoomStore.getState().addNode({ type: 'task', title: '普通任务' })
    if (!taskId) throw new Error('addNode 失败')
    useLoomStore.getState().setNodeStatus(taskId, 'waiting')
    const checkpointId = useLoomStore.getState().addNode({ type: 'checkpoint', title: '未就绪确认' })
    if (!checkpointId) throw new Error('addNode 失败')
    useLoomStore.getState().setNodeStatus(checkpointId, 'queued')

    installBridge()
    expect(waitingEvents()).toHaveLength(0)
    expect(useLoomStore.getState().activeBoard()?.id).toBe(board.id)
  })

  it('卸载后：新等待节点不再 emit，本桥注册的 resolver 释放（可重新安装）', () => {
    const { nodeId } = makeBoardWithCheckpoint('waiting')
    const cleanup = installBridge()
    const gateId = `loom:${useLoomStore.getState().activeBoard()?.id}:${nodeId}`
    expect(hasGateResolver(gateId)).toBe(true)

    cleanup()
    expect(hasGateResolver(gateId)).toBe(false)

    /* 卸载后新出现的等待节点不再发事件（订阅已释放） */
    const nextId = useLoomStore.getState().addNode({ type: 'checkpoint', title: '第二个确认' })
    if (!nextId) throw new Error('addNode 失败')
    useLoomStore.getState().setNodeStatus(nextId, 'waiting')
    expect(waitingEvents()).toHaveLength(1)

    /* 重新安装：当前等待节点补发（按 gateId 去重后两条事件） */
    gateEvents = []
    installBridge()
    expect(waitingEvents().map((event) => event.gate.taskId).sort()).toEqual([nodeId, nextId].sort())
  })
})

describe('ApprovalGate 契约示例（mission 门同卡）', () => {
  it('同一张卡可承载 mission 门（source=mission / sensitive 硬门）', () => {
    const gate: ApprovalGate = {
      gateId: 'm-1000:letters',
      missionId: 'm-1000',
      source: 'mission',
      title: '3 封信待发送',
      ownerAgentId: 'communicator',
      requiredAction: 'approve',
      sensitive: true,
      evidence: {
        citations: [{ value: '93%', source: '学情库 · 作业记录' }],
        verification: { total: 2, verified: 2, derived: 0, conflict: 0, unverified: 0, structural: 1 },
      },
    }
    expect(gateSourceLabel(gate.source)).toBe('战队')
    expect(gateEvidenceChips(gate.evidence).map((chip) => chip.key)).toEqual(['citations', 'verified'])
    expect(gate.sensitive).toBe(true)
  })
})
