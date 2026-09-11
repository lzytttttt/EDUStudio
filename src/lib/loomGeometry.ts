/**
 * Loom 画布几何（v0.9.4 M1）——纯函数：坐标系换算、连线路径、视口计算。
 *
 * 坐标系约定：
 * - 画布坐标（world）存节点 position；
 * - 屏幕坐标 = (world + viewport) × zoom，viewport 表示画布原点在容器内的平移量。
 */
import type { LoomPosition, LoomViewport } from '../harness/loom/types'
import { LOOM_NODE_HEIGHT, LOOM_NODE_WIDTH, LOOM_ZOOM_MAX, LOOM_ZOOM_MIN } from '../harness/loom/types'

/** 画布坐标 → 屏幕坐标 */
export function worldToScreen(p: LoomPosition, vp: LoomViewport): LoomPosition {
  return { x: (p.x + vp.x) * vp.zoom, y: (p.y + vp.y) * vp.zoom }
}

/** 屏幕坐标 → 画布坐标 */
export function screenToWorld(p: LoomPosition, vp: LoomViewport): LoomPosition {
  return { x: p.x / vp.zoom - vp.x, y: p.y / vp.zoom - vp.y }
}

/** 节点右侧连接点（世界坐标） */
export function rightAnchor(p: LoomPosition): LoomPosition {
  return { x: p.x + LOOM_NODE_WIDTH, y: p.y + LOOM_NODE_HEIGHT / 2 }
}

/** 节点左侧连接点（世界坐标） */
export function leftAnchor(p: LoomPosition): LoomPosition {
  return { x: p.x, y: p.y + LOOM_NODE_HEIGHT / 2 }
}

/**
 * 水平贝塞尔连线（world 坐标）：
 * M x1 y1 C midX y1, midX y2, x2 y2，控制点取两端水平中点。
 */
export function bezierPath(from: LoomPosition, to: LoomPosition): string {
  const x1 = from.x + LOOM_NODE_WIDTH
  const y1 = from.y + LOOM_NODE_HEIGHT / 2
  const x2 = to.x
  const y2 = to.y + LOOM_NODE_HEIGHT / 2
  const midX = (x1 + x2) / 2
  return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`
}

/** 两节点实际 use 的连线端点（支持反向 / 同行连线的视觉修正） */
export function edgeAnchors(
  from: LoomPosition,
  to: LoomPosition,
): { start: LoomPosition; end: LoomPosition } {
  /* 目标在左侧时，从左边出发、连到目标右侧，避免线穿越卡片 */
  if (to.x + LOOM_NODE_WIDTH / 2 < from.x) {
    return { start: leftAnchor(from), end: rightAnchor(to) }
  }
  return { start: rightAnchor(from), end: leftAnchor(to) }
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** 节点集合包围盒（含节点尺寸与内边距） */
export function nodesBounds(
  nodes: { position: LoomPosition }[],
  pad = 48,
): Bounds | null {
  if (nodes.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.position.x)
    minY = Math.min(minY, n.position.y)
    maxX = Math.max(maxX, n.position.x + LOOM_NODE_WIDTH)
    maxY = Math.max(maxY, n.position.y + LOOM_NODE_HEIGHT)
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
}

/** 计算「归中」视口：让包围盒适配容器尺寸（缩放夹在 40% ~ 180%） */
export function fitViewport(
  nodes: { position: LoomPosition }[],
  size: { width: number; height: number },
  pad = 48,
): LoomViewport {
  const bounds = nodesBounds(nodes, pad)
  if (!bounds || size.width <= 0 || size.height <= 0) {
    return { x: size.width / 2, y: size.height / 2, zoom: 1 }
  }
  const w = bounds.maxX - bounds.minX
  const h = bounds.maxY - bounds.minY
  const zoom = clampZoom(Math.min(size.width / w, size.height / h))
  /* 让包围盒中心落到容器中心：center_screen = (center_world + vp) * zoom */
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  return {
    x: size.width / 2 / zoom - cx,
    y: size.height / 2 / zoom - cy,
    zoom,
  }
}

export function clampZoom(zoom: number): number {
  return Math.min(LOOM_ZOOM_MAX, Math.max(LOOM_ZOOM_MIN, zoom))
}

/** 以某个屏幕点为锚缩放（滚轮缩放：锚点下的画布内容保持不动） */
export function zoomAt(
  vp: LoomViewport,
  screenPoint: LoomPosition,
  factor: number,
): LoomViewport {
  const nextZoom = clampZoom(vp.zoom * factor)
  if (nextZoom === vp.zoom) return vp
  const world = screenToWorld(screenPoint, vp)
  /* world × nextZoom + nextVp × nextZoom = screenPoint → nextVp = screenPoint / nextZoom − world */
  return {
    x: screenPoint.x / nextZoom - world.x,
    y: screenPoint.y / nextZoom - world.y,
    zoom: nextZoom,
  }
}

/** 命中测试：画布坐标是否落在某节点内（用于点击空白取消选中） */
export function hitNode(
  p: LoomPosition,
  node: { position: LoomPosition },
): boolean {
  return (
    p.x >= node.position.x &&
    p.x <= node.position.x + LOOM_NODE_WIDTH &&
    p.y >= node.position.y &&
    p.y <= node.position.y + LOOM_NODE_HEIGHT
  )
}

/** 找到命中连接点容差范围内的节点（连线吸附用，容差为画布单位） */
export function nearestAnchor(
  world: LoomPosition,
  nodes: { id: string; position: LoomPosition }[],
  tolerance = 36,
): { nodeId: string; side: 'left' | 'right'; distance: number } | null {
  let best: { nodeId: string; side: 'left' | 'right'; distance: number } | null = null
  for (const n of nodes) {
    for (const side of ['left', 'right'] as const) {
      const anchor = side === 'left' ? leftAnchor(n.position) : rightAnchor(n.position)
      const distance = Math.hypot(anchor.x - world.x, anchor.y - world.y)
      if (distance <= tolerance && (!best || distance < best.distance)) {
        best = { nodeId: n.id, side, distance }
      }
    }
  }
  return best
}
