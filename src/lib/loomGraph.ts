/**
 * Loom 图算法（v0.9.4 M1）——纯函数，无 store / DOM 依赖。
 *
 * 语义（与 v0.9.4-01 决策一致）：
 * - `dependency` 边表示执行依赖：父节点全部 done 后子节点才 ready；
 * - `context` 边只提供上游信息，不阻塞执行（收集上游结果时两类边都算）；
 * - 任何会形成环 / 自环 / 重边的连接一律拒绝。
 */
import type { LoomEdge, LoomEdgeType, LoomNode, LoomNodeResult, LoomPosition } from '../harness/loom/types'

export interface Graph {
  nodes: LoomNode[]
  edges: LoomEdge[]
}

export interface AddEdgeResult {
  edges: LoomEdge[]
  /** 拒绝原因；成功时为 undefined */
  error?: string
}

let seq = 0
function nextEdgeId(from: string, to: string): string {
  seq += 1
  return `edge-${from}-${to}-${Date.now().toString(36)}-${seq}`
}

/** 环检测（DFS 三色标记）：仅沿 dependency 边判定，context 边不参与调度语义 */
export function wouldCreateCycle(edges: LoomEdge[], from: string, to: string): boolean {
  if (from === to) return true
  const adj = new Map<string, string[]>()
  for (const e of edges) {
    if (e.type !== 'dependency') continue
    const list = adj.get(e.from)
    if (list) list.push(e.to)
    else adj.set(e.from, [e.to])
  }
  /* 从 to 出发若能走回 from，则新增 from→to 会成环 */
  const stack = [to]
  const seen = new Set<string>()
  while (stack.length) {
    const cur = stack.pop() as string
    if (cur === from) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const next of adj.get(cur) ?? []) stack.push(next)
  }
  return false
}

/**
 * 添加一条边：自环 / 重边 / 成环（dependency）一律拒绝，返回原边集与提示文案。
 * 同一对节点允许一条 dependency + 一条 context 并存（语义不同）。
 */
export function addEdge(
  edges: LoomEdge[],
  from: string,
  to: string,
  type: LoomEdgeType = 'dependency',
  now = Date.now(),
): AddEdgeResult {
  if (from === to) {
    return { edges, error: '不能连接到自己，请选择其他节点' }
  }
  if (edges.some((e) => e.from === from && e.to === to && e.type === type)) {
    return { edges, error: '这两个任务已经连接过了' }
  }
  if (type === 'dependency' && wouldCreateCycle(edges, from, to)) {
    return { edges, error: '这会形成循环任务，请调整连接关系' }
  }
  const edge: LoomEdge = { id: nextEdgeId(from, to), from, to, type, createdAt: now }
  return { edges: [...edges, edge] }
}

export function removeEdge(edges: LoomEdge[], edgeId: string): LoomEdge[] {
  return edges.filter((e) => e.id !== edgeId)
}

/** 删除节点时同时清理其相关边 */
export function removeEdgesFor(edges: LoomEdge[], nodeId: string): LoomEdge[] {
  return edges.filter((e) => e.from !== nodeId && e.to !== nodeId)
}

/** 找环（若存在）：返回任意一个环上的节点序列，无环返回 null */
export function findCycle(edges: LoomEdge[]): string[] | null {
  const adj = new Map<string, string[]>()
  for (const e of edges) {
    if (e.type !== 'dependency') continue
    const list = adj.get(e.from)
    if (list) list.push(e.to)
    else adj.set(e.from, [e.to])
  }
  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const color = new Map<string, number>()
  const path: string[] = []

  const visit = (node: string): string[] | null => {
    color.set(node, GRAY)
    path.push(node)
    for (const next of adj.get(node) ?? []) {
      const c = color.get(next) ?? WHITE
      if (c === GRAY) {
        const start = path.indexOf(next)
        return [...path.slice(start), next]
      }
      if (c === WHITE) {
        const found = visit(next)
        if (found) return found
      }
    }
    path.pop()
    color.set(node, BLACK)
    return null
  }

  for (const node of adj.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE) {
      const found = visit(node)
      if (found) return found
    }
  }
  return null
}

/** 拓扑排序（Kahn）：无环时返回全部节点 id；有环时返回已排序部分（环上节点不出现在结果里） */
export function topologicalSort(graph: Graph): string[] {
  const indegree = new Map<string, number>()
  const adj = new Map<string, string[]>()
  for (const n of graph.nodes) indegree.set(n.id, 0)
  for (const e of graph.edges) {
    if (e.type !== 'dependency') continue
    if (!indegree.has(e.from) || !indegree.has(e.to)) continue
    indegree.set(e.to, (indegree.get(e.to) as number) + 1)
    const list = adj.get(e.from)
    if (list) list.push(e.to)
    else adj.set(e.from, [e.to])
  }
  const queue = graph.nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id)
  const sorted: string[] = []
  while (queue.length) {
    const cur = queue.shift() as string
    sorted.push(cur)
    for (const next of adj.get(cur) ?? []) {
      const deg = (indegree.get(next) as number) - 1
      indegree.set(next, deg)
      if (deg === 0) queue.push(next)
    }
  }
  return sorted
}

/** 按深度分层（dependency 边）；孤立节点为第 0 层；环上节点兜底追加）
 *  深度 = 最长路径长度，保证「父一定在更小的层」 */
export function layerNodes(graph: Graph): { layers: string[][]; hasCycle: boolean } {
  const sorted = topologicalSort(graph)
  const depth = new Map<string, number>()
  for (const id of sorted) depth.set(id, 0)
  const parents = new Map<string, string[]>()
  for (const e of graph.edges) {
    if (e.type !== 'dependency') continue
    if (!depth.has(e.from) || !depth.has(e.to)) continue
    const list = parents.get(e.to)
    if (list) list.push(e.from)
    else parents.set(e.to, [e.from])
  }
  /* 按拓扑序递推：depth(child) = max(depth(parent)) + 1 */
  for (const id of sorted) {
    for (const child of graph.edges.filter((e) => e.type === 'dependency' && e.from === id).map((e) => e.to)) {
      if (!depth.has(child)) continue
      const candidate = (depth.get(id) as number) + 1
      if (candidate > (depth.get(child) as number)) depth.set(child, candidate)
    }
  }
  const maxDepth = sorted.reduce((max, id) => Math.max(max, depth.get(id) as number), 0)
  const layers: string[][] = []
  for (let i = 0; i <= maxDepth; i++) layers.push([])
  for (const id of sorted) (layers[depth.get(id) as number]).push(id)
  const hasCycle = sorted.length < graph.nodes.length
  if (hasCycle) {
    const inSorted = new Set(sorted)
    const leftovers = graph.nodes.filter((n) => !inSorted.has(n.id)).map((n) => n.id)
    if (leftovers.length) layers.push(leftovers)
  }
  return { layers, hasCycle }
}

/** 运行条件：所有 dependency 父节点均已 done（原方案 canRun） */
export function readyNodes(graph: Graph): LoomNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const deps = new Map<string, string[]>()
  for (const e of graph.edges) {
    if (e.type !== 'dependency') continue
    const list = deps.get(e.to)
    if (list) list.push(e.from)
    else deps.set(e.to, [e.from])
  }
  return graph.nodes.filter((n) => {
    if (n.status === 'done' || n.status === 'running' || n.status === 'waiting') return false
    const parents = deps.get(n.id) ?? []
    return parents.every((p) => byId.get(p)?.status === 'done')
  })
}

/** 直接上游节点（dependency + context） */
export function upstreamNodes(graph: Graph, nodeId: string): LoomNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  return graph.edges
    .filter((e) => e.to === nodeId)
    .map((e) => byId.get(e.from))
    .filter((n): n is LoomNode => n != null)
}

/** 直接下游节点 */
export function downstreamNodes(graph: Graph, nodeId: string): LoomNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  return graph.edges
    .filter((e) => e.from === nodeId)
    .map((e) => byId.get(e.to))
    .filter((n): n is LoomNode => n != null)
}

/** 孤立节点（无任何连线） */
export function orphanNodes(graph: Graph): LoomNode[] {
  const connected = new Set<string>()
  for (const e of graph.edges) {
    connected.add(e.from)
    connected.add(e.to)
  }
  return graph.nodes.filter((n) => !connected.has(n.id))
}

/** 采集上游结果（runner 注入上下文用）：只取有产出的来源 */
export function collectUpstreamResults(graph: Graph, nodeId: string): LoomNodeResult[] {
  return upstreamNodes(graph, nodeId)
    .map((n) => ({ nodeId: n.id, title: n.title, summary: '', status: n.status }))
    .filter((r) => r.status === 'done' || r.status === 'error')
}

/** 有效运行图：无环且至少有一个可运行节点 */
export function validateGraph(graph: Graph): { ok: boolean; error?: string } {
  if (graph.nodes.length === 0) return { ok: false, error: '空间里还没有任务模块' }
  const cycle = findCycle(graph.edges)
  if (cycle) return { ok: false, error: '存在循环依赖，请调整连接关系后再开始处理' }
  return { ok: true }
}

/** 节点位置更新（不可变） */
export function moveNodePositions(
  nodes: LoomNode[],
  positions: Record<string, LoomPosition>,
): LoomNode[] {
  return nodes.map((n) => (positions[n.id] ? { ...n, position: positions[n.id], updatedAt: Date.now() } : n))
}
