/**
 * Loom 自动布局（v0.9.4 M1）——轻量分层布局，不引入 dagre。
 *
 * 逻辑（沿用原方案第二十节）：
 *   indgree → 拓扑排序 → 按 depth 分层 → X = depth × 间距，Y = 层内序号 × 行距（层内垂直居中）
 */
import type { LoomNode, LoomPosition } from '../harness/loom/types'
import { LOOM_NODE_HEIGHT, LOOM_NODE_WIDTH } from '../harness/loom/types'
import { layerNodes, type Graph } from './loomGraph'

export const LAYOUT_COL_GAP = 96
export const LAYOUT_ROW_GAP = 40

/** 层内垂直居中：nodes 为层内节点数，index 为层内序号 */
export function layoutPosition(depth: number, index: number, countInLayer: number): LoomPosition {
  const columnHeight = (countInLayer - 1) * (LOOM_NODE_HEIGHT + LAYOUT_ROW_GAP)
  return {
    x: depth * (LOOM_NODE_WIDTH + LAYOUT_COL_GAP),
    y: index * (LOOM_NODE_HEIGHT + LAYOUT_ROW_GAP) - columnHeight / 2,
  }
}

/**
 * 自动整理：返回全部节点的目标位置。
 * - 默认对整张图布局；
 * - 传 `subset` 时只对选中节点布局（其余节点坐标不动），且以最小 x/y 为原点避免整体跳位。
 */
export function autoLayout(graph: Graph, subset?: string[]): Record<string, LoomPosition> {
  const involved = subset && subset.length > 0 ? new Set(subset) : null
  const nodes = involved ? graph.nodes.filter((n) => involved.has(n.id)) : graph.nodes
  const edges = involved
    ? graph.edges.filter((e) => involved.has(e.from) && involved.has(e.to))
    : graph.edges
  if (nodes.length === 0) return {}

  const { layers } = layerNodes({ nodes, edges })
  const positions: Record<string, LoomPosition> = {}
  layers.forEach((layer, depth) => {
    layer.forEach((id, index) => {
      positions[id] = layoutPosition(depth, index, layer.length)
    })
  })

  /* 子集布局：整体平移，让结果落在原子集左上角，避免把选中节点甩到远处 */
  if (involved) {
    const xs = nodes.map((n) => n.position.x)
    const ys = nodes.map((n) => n.position.y)
    const dx = Math.min(...xs)
    const dy = Math.min(...ys)
    for (const id of Object.keys(positions)) {
      positions[id] = { x: positions[id].x + dx, y: positions[id].y + dy }
    }
  }
  return positions
}

/** 新节点落点：在已有节点最右侧一列之后，保证不重叠 */
export function nextNodePosition(nodes: LoomNode[]): LoomPosition {
  if (nodes.length === 0) return { x: 0, y: 0 }
  const maxX = Math.max(...nodes.map((n) => n.position.x))
  const sameColumn = nodes.filter((n) => n.position.x === maxX)
  const maxY = sameColumn.length ? Math.max(...sameColumn.map((n) => n.position.y)) : -Infinity
  if (sameColumn.length >= 4) {
    return { x: maxX + LOOM_NODE_WIDTH + LAYOUT_COL_GAP, y: 0 }
  }
  return { x: maxX, y: maxY + LOOM_NODE_HEIGHT + LAYOUT_ROW_GAP }
}
