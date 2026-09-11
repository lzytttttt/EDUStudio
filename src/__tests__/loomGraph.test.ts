import { describe, expect, it } from 'vitest'
import type { LoomEdge, LoomNode } from '../harness/loom/types'
import {
  addEdge,
  collectUpstreamResults,
  downstreamNodes,
  findCycle,
  isExecutableNode,
  layerNodes,
  orphanNodes,
  readyNodes,
  removeEdgesFor,
  topologicalSort,
  upstreamNodes,
  validateGraph,
  wouldCreateCycle,
  type Graph,
} from '../lib/loomGraph'

/* v0.9.4 M1：Loom 图算法纯函数（连边校验 / 环检测 / 拓扑排序 / 就绪判定 / 上游收集） */

const node = (id: string, status: LoomNode['status'] = 'idle'): LoomNode => ({
  id,
  type: 'task',
  title: id,
  position: { x: 0, y: 0 },
  status,
  createdAt: 0,
  updatedAt: 0,
})

const dep = (id: string, from: string, to: string): LoomEdge => ({
  id,
  from,
  to,
  type: 'dependency',
  createdAt: 0,
})

describe('loomGraph 连边校验', () => {
  it('自环被拒绝', () => {
    const result = addEdge([], 'a', 'a')
    expect(result.error).toBeTruthy()
    expect(result.edges).toEqual([])
  })

  it('重边被拒绝（同类边）', () => {
    const first = addEdge([], 'a', 'b', 'dependency', 1)
    const second = addEdge(first.edges, 'a', 'b', 'dependency', 2)
    expect(second.error).toBeTruthy()
    expect(second.edges.length).toBe(1)
  })

  it('同一对节点允许 dependency 与 context 各一条', () => {
    const first = addEdge([], 'a', 'b', 'dependency', 1)
    const second = addEdge(first.edges, 'a', 'b', 'context', 2)
    expect(second.error).toBeUndefined()
    expect(second.edges.length).toBe(2)
  })

  it('形成环的连接被拒绝并提示文案', () => {
    const a = addEdge([], 'a', 'b', 'dependency', 1).edges
    const b = addEdge(a, 'b', 'c', 'dependency', 2).edges
    const c = addEdge(b, 'c', 'a', 'dependency', 3)
    expect(c.error).toContain('循环')
    expect(c.edges.length).toBe(2)
  })

  it('context 边不参与环判定（不影响调度语义）', () => {
    const a = addEdge([], 'a', 'b', 'dependency', 1).edges
    /* a→b 已有 dependency；b→a 用 context 建立信息回环不应被拒 */
    const back = addEdge(a, 'b', 'a', 'context', 2)
    expect(back.error).toBeUndefined()
    expect(wouldCreateCycle(a, 'b', 'a')).toBe(true)
    expect(findCycle([...a, ...back.edges.slice(1)])).toBeNull()
  })

  it('removeEdgesFor 清理节点相关全部边', () => {
    const a = addEdge([], 'a', 'b', 'dependency', 1).edges
    const b = addEdge(a, 'b', 'c', 'dependency', 2).edges
    expect(removeEdgesFor(b, 'b')).toEqual([])
  })
})

describe('loomGraph 拓扑与分层', () => {
  const graph: Graph = {
    nodes: [node('a'), node('b'), node('c'), node('d'), node('solo')],
    edges: [dep('e1', 'a', 'b'), dep('e2', 'b', 'c'), dep('e3', 'a', 'c'), dep('e4', 'c', 'd')],
  }

  it('拓扑排序：父节点先于子节点（a→b→c→d）', () => {
    const sorted = topologicalSort(graph)
    expect(sorted).toHaveLength(5)
    expect(sorted.indexOf('a')).toBeLessThan(sorted.indexOf('b'))
    expect(sorted.indexOf('b')).toBeLessThan(sorted.indexOf('c'))
    expect(sorted.indexOf('c')).toBeLessThan(sorted.indexOf('d'))
    expect(sorted).toContain('solo')
  })

  it('分层：a 第 0 层、b 第 1 层、c/d 第 2/3 层（c 取最长路径）、孤立节点第 0 层', () => {
    const { layers, hasCycle } = layerNodes(graph)
    expect(hasCycle).toBe(false)
    expect(layers[0]).toContain('a')
    expect(layers[0]).toContain('solo')
    expect(layers[1]).toEqual(['b'])
    expect(layers[2]).toEqual(['c'])
    expect(layers[3]).toEqual(['d'])
  })

  it('有环时拓扑排序只返回可排序部分，分层标记 hasCycle', () => {
    const cyclic: Graph = { nodes: [node('a'), node('b'), node('c')], edges: [dep('e1', 'a', 'b'), dep('e2', 'b', 'c'), dep('e3', 'c', 'a')] }
    const sorted = topologicalSort(cyclic)
    const { hasCycle } = layerNodes(cyclic)
    expect(hasCycle).toBe(true)
    expect(sorted.length).toBeLessThan(3)
    expect(findCycle(cyclic.edges)).not.toBeNull()
  })

  it('validateGraph：空画布 / 有环 / 正常', () => {
    expect(validateGraph({ nodes: [], edges: [] }).ok).toBe(false)
    expect(
      validateGraph({ nodes: [node('a'), node('b')], edges: [dep('e1', 'a', 'b'), dep('e2', 'b', 'a')] }).ok,
    ).toBe(false)
    expect(validateGraph(graph).ok).toBe(true)
  })
})

describe('loomGraph 就绪与上下游', () => {
  const graph: Graph = {
    nodes: [node('a', 'done'), node('b', 'idle'), node('c', 'idle')],
    edges: [dep('e1', 'a', 'b'), dep('e2', 'b', 'c')],
  }

  it('readyNodes：父未完成时子节点不就绪；父 done 后子就绪', () => {
    expect(readyNodes(graph).map((n) => n.id)).toEqual(['b'])

    const allDone: Graph = { ...graph, nodes: graph.nodes.map((n) => ({ ...n, status: 'done' as const })) }
    expect(readyNodes(allDone)).toEqual([])

    const bDone: Graph = {
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === 'b' ? { ...n, status: 'done' as const } : n)),
    }
    expect(readyNodes(bDone).map((n) => n.id)).toEqual(['c'])
  })

  it('running / waiting 节点不重复进入 ready', () => {
    const running: Graph = {
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === 'b' ? { ...n, status: 'running' as const } : n)),
    }
    expect(readyNodes(running).map((n) => n.id)).toEqual([])
  })

  it('上游 / 下游 / 孤立节点', () => {
    const g: Graph = { ...graph, nodes: [...graph.nodes, node('solo')] }
    expect(upstreamNodes(g, 'c').map((n) => n.id)).toEqual(['b'])
    expect(downstreamNodes(g, 'a').map((n) => n.id)).toEqual(['b'])
    expect(orphanNodes(g).map((n) => n.id)).toEqual(['solo'])
  })

  it('collectUpstreamResults：只收录已产出（done / error）的上游', () => {
    const g: Graph = {
      nodes: [node('a', 'done'), node('x', 'idle'), node('c', 'idle')],
      edges: [dep('e1', 'a', 'c'), dep('e2', 'x', 'c')],
    }
    const results = collectUpstreamResults(g, 'c')
    expect(results.map((r) => r.nodeId)).toEqual(['a'])
  })
})

/* v0.9.4-03：非执行节点（便签 / 文档）不参与调度；上游收集穿透非执行节点 */
describe('loomGraph 非执行节点', () => {
  const typed = (id: string, type: LoomNode['type'], status: LoomNode['status'] = 'idle'): LoomNode => ({
    ...node(id, status),
    type,
  })

  it('isExecutableNode：note / artifact 非执行；task / agent / tool / checkpoint 参与执行', () => {
    expect(isExecutableNode(typed('n', 'note'))).toBe(false)
    expect(isExecutableNode(typed('d', 'artifact'))).toBe(false)
    expect(isExecutableNode(typed('t', 'task'))).toBe(true)
    expect(isExecutableNode(typed('a', 'agent'))).toBe(true)
    expect(isExecutableNode(typed('k', 'tool'))).toBe(true)
    expect(isExecutableNode(typed('c', 'checkpoint'))).toBe(true)
  })

  it('readyNodes：便签 / 文档自身不就绪；便签作为父节点不阻塞下游', () => {
    const g: Graph = {
      nodes: [node('a', 'done'), typed('note1', 'note'), node('b', 'idle')],
      edges: [dep('e1', 'a', 'note1'), dep('e2', 'note1', 'b')],
    }
    /* note 不进入 ready；b 的父是 note（非执行）→ 视为满足 → b 就绪 */
    expect(readyNodes(g).map((n) => n.id)).toEqual(['b'])
  })

  it('readyNodes：执行型父未完成仍阻塞（回归）', () => {
    const g: Graph = {
      nodes: [node('a', 'idle'), node('b', 'idle'), typed('doc1', 'artifact')],
      edges: [dep('e1', 'a', 'b')],
    }
    expect(readyNodes(g).map((n) => n.id)).toEqual(['a'])
  })

  it('collectUpstreamResults：穿透 checkpoint 收集更上游的执行型输出（A → ✋ → B）', () => {
    const g: Graph = {
      nodes: [node('a', 'done'), typed('cp', 'checkpoint', 'done'), node('b', 'idle')],
      edges: [dep('e1', 'a', 'cp'), dep('e2', 'cp', 'b')],
    }
    expect(collectUpstreamResults(g, 'b').map((r) => r.nodeId)).toEqual(['a'])
  })

  it('collectUpstreamResults：执行型上游构成信息边界（不继续向上）', () => {
    const g: Graph = {
      nodes: [node('a', 'done'), node('b', 'done'), node('c', 'idle')],
      edges: [dep('e1', 'a', 'b'), dep('e2', 'b', 'c')],
    }
    expect(collectUpstreamResults(g, 'c').map((r) => r.nodeId)).toEqual(['b'])
  })

  it('collectUpstreamResults：便签穿透 + 未产出节点不收录 + error 上游收录', () => {
    const g: Graph = {
      nodes: [node('a', 'done'), typed('note1', 'note'), node('x', 'idle'), node('err', 'error'), node('b', 'idle')],
      edges: [
        dep('e1', 'a', 'note1'),
        dep('e2', 'note1', 'b'),
        dep('e3', 'x', 'b'),
        dep('e4', 'err', 'b'),
      ],
    }
    /* 直接父先收集（note1 穿透后 a 后入队）：['err', 'a']，顺序不影响注入语义 */
    expect(collectUpstreamResults(g, 'b').map((r) => r.nodeId)).toEqual(['err', 'a'])
  })
})
