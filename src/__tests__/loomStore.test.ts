import { beforeEach, describe, expect, it } from 'vitest'
import { boardStats, cancelLoomPersist, flushLoomPersist, hasPendingNodes, useLoomStore } from '../stores/loomStore'
import type { LoomBoard } from '../harness/loom/types'

/* v0.9.4 M1：loomStore（画布隔离 / 任务节点幂等与墓碑 / 增删改 / 连线 / 撤销重做 / 整理 / 持久化） */

function resetStore(): void {
  cancelLoomPersist()
  /* 历史随画布存储，重置画布即清空历史 */
  useLoomStore.setState({ boards: [], activeBoardId: null })
}

const activeBoard = (): LoomBoard => useLoomStore.getState().activeBoard() as LoomBoard

beforeEach(resetStore)

describe('loomStore 画布', () => {
  it('ensureBoard：按角色建画布并激活；同角色重复调用复用', () => {
    const teacher = useLoomStore.getState().ensureBoard('teacher')
    expect(teacher.role).toBe('teacher')
    expect(useLoomStore.getState().activeBoardId).toBe(teacher.id)

    const again = useLoomStore.getState().ensureBoard('teacher')
    expect(again.id).toBe(teacher.id)
    expect(useLoomStore.getState().boards).toHaveLength(1)
  })

  it('角色画布互相隔离（节点不串台）', () => {
    useLoomStore.getState().ensureBoard('teacher')
    useLoomStore.getState().addNode({ type: 'note', title: '教师便签' })
    useLoomStore.getState().ensureBoard('bureau')
    useLoomStore.getState().addNode({ type: 'note', title: '区域便签' })

    const boards = useLoomStore.getState().boards
    const teacherBoard = boards.find((b) => b.role === 'teacher') as LoomBoard
    const bureauBoard = boards.find((b) => b.role === 'bureau') as LoomBoard
    expect(teacherBoard.nodes.map((n) => n.title)).toEqual(['教师便签'])
    expect(bureauBoard.nodes.map((n) => n.title)).toEqual(['区域便签'])
  })

  it('addNode 自动错开落点，updateNode 可改标题与指令', () => {
    useLoomStore.getState().ensureBoard('teacher')
    const first = useLoomStore.getState().addNode({ type: 'agent', title: '生成分层练习' })
    const second = useLoomStore.getState().addNode({ type: 'checkpoint', title: '教师确认' })
    expect(first).toBeTruthy()
    expect(second).toBeTruthy()

    const nodes = activeBoard().nodes
    expect(nodes[0].position).not.toEqual(nodes[1].position)

    useLoomStore.getState().updateNode(first as string, { instruction: '按上游结果生成三档练习' })
    expect(activeBoard().nodes.find((n) => n.id === first)?.instruction).toBe('按上游结果生成三档练习')
  })
})

describe('loomStore 任务节点幂等与墓碑', () => {
  it('ensureTaskNode：同 cardId 幂等复用，补齐 sessionId', () => {
    const id = useLoomStore.getState().ensureTaskNode({ role: 'teacher', cardId: 'c1', title: '函数薄弱点分析' })
    expect(id).toBeTruthy()
    const again = useLoomStore.getState().ensureTaskNode({
      role: 'teacher', cardId: 'c1', title: '函数薄弱点分析', sessionId: 'sess-9',
    })
    expect(again).toBe(id)
    expect(activeBoard().nodes).toHaveLength(1)
    expect(activeBoard().nodes[0].sessionId).toBe('sess-9')
    expect(activeBoard().nodes[0].description).toBe('来自今日简报')
  })

  it('从画布移除后写墓碑：再次 ensureTaskNode 不再复活', () => {
    const id = useLoomStore.getState().ensureTaskNode({ role: 'teacher', cardId: 'c1', title: '任务一' })
    useLoomStore.getState().removeNode(id as string)

    expect(activeBoard().nodes).toHaveLength(0)
    expect(activeBoard().removedCardIds).toContain('c1')

    const revived = useLoomStore.getState().ensureTaskNode({ role: 'teacher', cardId: 'c1', title: '任务一' })
    expect(revived).toBeNull()
    expect(activeBoard().nodes).toHaveLength(0)
  })

  it('人工节点被移除不写墓碑', () => {
    useLoomStore.getState().ensureBoard('teacher')
    const note = useLoomStore.getState().addNode({ type: 'note', title: '便签' })
    useLoomStore.getState().removeNode(note as string)
    expect(activeBoard().removedCardIds).toEqual([])
  })
})

describe('loomStore 连线与整理', () => {
  it('connect 拒绝成环并返回提示；disconnect 删除边', () => {
    useLoomStore.getState().ensureBoard('teacher')
    const a = useLoomStore.getState().addNode({ type: 'task', title: 'A' }) as string
    const b = useLoomStore.getState().addNode({ type: 'agent', title: 'B' }) as string
    const c = useLoomStore.getState().addNode({ type: 'agent', title: 'C' }) as string

    expect(useLoomStore.getState().connect(a, b)).toEqual({ ok: true })
    expect(useLoomStore.getState().connect(b, c)).toEqual({ ok: true })
    const cyclic = useLoomStore.getState().connect(c, a)
    expect(cyclic.ok).toBe(false)
    expect(cyclic.error).toContain('循环')

    const edgeId = activeBoard().edges[0].id
    useLoomStore.getState().disconnect(edgeId)
    expect(activeBoard().edges.map((e) => e.id)).not.toContain(edgeId)
  })

  it('移除节点同时清理相关边', () => {
    useLoomStore.getState().ensureBoard('teacher')
    const a = useLoomStore.getState().addNode({ type: 'task', title: 'A' }) as string
    const b = useLoomStore.getState().addNode({ type: 'agent', title: 'B' }) as string
    useLoomStore.getState().connect(a, b)
    useLoomStore.getState().removeNode(a)
    expect(activeBoard().edges).toHaveLength(0)
  })

  it('tidyBoard 自动整理：链式连线按层水平铺开', () => {
    useLoomStore.getState().ensureBoard('teacher')
    const a = useLoomStore.getState().addNode({ type: 'task', title: 'A' }) as string
    const b = useLoomStore.getState().addNode({ type: 'agent', title: 'B' }) as string
    useLoomStore.getState().connect(a, b)
    useLoomStore.getState().tidyBoard()

    const nodes = activeBoard().nodes
    const posA = nodes.find((n) => n.id === a)?.position as { x: number }
    const posB = nodes.find((n) => n.id === b)?.position as { x: number }
    expect(posB.x).toBeGreaterThan(posA.x)
  })

  it('setViewport 持久化视口', () => {
    useLoomStore.getState().ensureBoard('teacher')
    useLoomStore.getState().setViewport({ x: 12, y: -8, zoom: 1.25 })
    expect(activeBoard().viewport).toEqual({ x: 12, y: -8, zoom: 1.25 })
  })
})

describe('loomStore 撤销 / 重做', () => {
  it('删除节点后可撤销恢复，重做再次删除', () => {
    useLoomStore.getState().ensureBoard('teacher')
    const a = useLoomStore.getState().addNode({ type: 'task', title: 'A' }) as string
    useLoomStore.getState().addNode({ type: 'note', title: 'B' })
    expect(activeBoard().nodes).toHaveLength(2)

    useLoomStore.getState().removeNode(a)
    expect(activeBoard().nodes).toHaveLength(1)

    expect(useLoomStore.getState().undo()).toBe(true)
    expect(activeBoard().nodes).toHaveLength(2)

    expect(useLoomStore.getState().redo()).toBe(true)
    expect(activeBoard().nodes).toHaveLength(1)
  })

  it('新增边可撤销', () => {
    useLoomStore.getState().ensureBoard('teacher')
    const a = useLoomStore.getState().addNode({ type: 'task', title: 'A' }) as string
    const b = useLoomStore.getState().addNode({ type: 'agent', title: 'B' }) as string
    useLoomStore.getState().connect(a, b)
    expect(activeBoard().edges).toHaveLength(1)
    useLoomStore.getState().undo()
    expect(activeBoard().edges).toHaveLength(0)
  })

  it('无历史时 undo/redo 返回 false', () => {
    useLoomStore.getState().ensureBoard('teacher')
    expect(useLoomStore.getState().undo()).toBe(false)
    expect(useLoomStore.getState().redo()).toBe(false)
  })
})

describe('loomStore 运行辅助与持久化', () => {
  it('setNodeStatus / nextQueuedNode / hasPendingNodes / boardStats', () => {
    useLoomStore.getState().ensureBoard('teacher')
    const a = useLoomStore.getState().addNode({ type: 'task', title: 'A' }) as string
    const b = useLoomStore.getState().addNode({ type: 'agent', title: 'B' }) as string

    useLoomStore.getState().setNodeStatus(a, 'queued')
    useLoomStore.getState().setNodeStatus(b, 'done')

    expect(useLoomStore.getState().nextQueuedNode()?.id).toBe(a)
    expect(hasPendingNodes(activeBoard())).toBe(true)
    expect(boardStats(activeBoard())).toEqual({ total: 2, done: 1, pending: 1, error: 0 })

    useLoomStore.getState().setNodeStatus(a, 'done')
    expect(hasPendingNodes(activeBoard())).toBe(false)
  })

  it('结构变更落盘 edustudio:loom（flush 后可直接读回）', () => {
    useLoomStore.getState().ensureBoard('teacher')
    useLoomStore.getState().ensureTaskNode({ role: 'teacher', cardId: 'c1', title: '任务一' })
    flushLoomPersist()

    const raw = window.localStorage.getItem('edustudio:loom')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw as string) as { schemaVersion: number; boards: LoomBoard[] }
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.boards[0].nodes[0].cardId).toBe('c1')
  })
})
