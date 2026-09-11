import { describe, expect, it } from 'vitest'
import { LOOM_NODE_HEIGHT, LOOM_NODE_WIDTH } from '../harness/loom/types'
import {
  bezierPath,
  clampZoom,
  edgeAnchors,
  fitViewport,
  hitNode,
  leftAnchor,
  nearestAnchor,
  nodesBounds,
  rightAnchor,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from '../lib/loomGeometry'
import { autoLayout, layoutPosition, nextNodePosition } from '../lib/loomLayout'
import type { LoomEdge, LoomNode } from '../harness/loom/types'

/* v0.9.4 M1：画布几何与布局纯函数（坐标换算 / 连线 / 归中 / 分层布局） */

const node = (id: string, x = 0, y = 0): LoomNode => ({
  id,
  type: 'task',
  title: id,
  position: { x, y },
  status: 'idle',
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

describe('loomGeometry 坐标换算', () => {
  it('world ↔ screen 互为逆变换', () => {
    const vp = { x: 30, y: -12, zoom: 1.25 }
    const world = { x: 120, y: 80 }
    const screen = worldToScreen(world, vp)
    const back = screenToWorld(screen, vp)
    expect(back.x).toBeCloseTo(world.x, 6)
    expect(back.y).toBeCloseTo(world.y, 6)
  })

  it('缩放以锚点为中心：锚点下的画布坐标不变', () => {
    const vp = { x: 0, y: 0, zoom: 1 }
    const screenPoint = { x: 100, y: 50 }
    const before = screenToWorld(screenPoint, vp)
    const next = zoomAt(vp, screenPoint, 1.5)
    const after = screenToWorld(screenPoint, next)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('缩放范围夹在 40% ~ 180%', () => {
    expect(clampZoom(0.1)).toBe(0.4)
    expect(clampZoom(5)).toBe(1.8)
    /* 已到边界时 zoomAt 原样返回，不产生漂移 */
    const max = { x: 0, y: 0, zoom: 1.8 }
    expect(zoomAt(max, { x: 0, y: 0 }, 2)).toBe(max)
    const min = { x: 0, y: 0, zoom: 0.4 }
    expect(zoomAt(min, { x: 0, y: 0 }, 0.5)).toBe(min)
  })
})

describe('loomGeometry 连线与命中', () => {
  it('左右锚点取卡片垂直中点', () => {
    expect(rightAnchor({ x: 100, y: 50 })).toEqual({ x: 100 + LOOM_NODE_WIDTH, y: 50 + LOOM_NODE_HEIGHT / 2 })
    expect(leftAnchor({ x: 100, y: 50 })).toEqual({ x: 100, y: 50 + LOOM_NODE_HEIGHT / 2 })
  })

  it('贝塞尔路径为水平中点控制的三次曲线', () => {
    const path = bezierPath({ x: 0, y: 0 }, { x: 400, y: 0 })
    const y1 = LOOM_NODE_HEIGHT / 2
    expect(path).toBe(`M ${LOOM_NODE_WIDTH} ${y1} C 310 ${y1}, 310 ${y1}, 400 ${y1}`)
  })

  it('反向连线改走左出右入，避免穿越卡片', () => {
    const { start, end } = edgeAnchors({ x: 500, y: 0 }, { x: 0, y: 0 })
    expect(start.x).toBe(500)
    expect(end.x).toBe(LOOM_NODE_WIDTH)
  })

  it('hitNode 命中测试', () => {
    const target = { position: { x: 10, y: 10 } }
    expect(hitNode({ x: 20, y: 20 }, target)).toBe(true)
    expect(hitNode({ x: -5, y: 20 }, target)).toBe(false)
  })

  it('nearestAnchor 吸附最近连接点（容差内）', () => {
    const nodes = [{ id: 'a', position: { x: 0, y: 0 } }, { id: 'b', position: { x: 600, y: 0 } }]
    const hit = nearestAnchor({ x: LOOM_NODE_WIDTH + 10, y: LOOM_NODE_HEIGHT / 2 }, nodes, 40)
    expect(hit?.nodeId).toBe('a')
    expect(hit?.side).toBe('right')
    expect(nearestAnchor({ x: 2000, y: 2000 }, nodes, 40)).toBeNull()
  })
})

describe('loomGeometry 视口与包围盒', () => {
  it('nodesBounds 含节点尺寸与内边距', () => {
    const bounds = nodesBounds([{ position: { x: 0, y: 0 } }, { position: { x: 300, y: 200 } }], 10)
    expect(bounds).toEqual({
      minX: -10,
      minY: -10,
      maxX: 300 + LOOM_NODE_WIDTH + 10,
      maxY: 200 + LOOM_NODE_HEIGHT + 10,
    })
    expect(nodesBounds([])).toBeNull()
  })

  it('fitViewport 让包围盒中心落在容器中心且缩放夹在范围内', () => {
    const vp = fitViewport([{ position: { x: 0, y: 0 } }, { position: { x: 300, y: 200 } }], { width: 800, height: 600 })
    expect(vp.zoom).toBeLessThanOrEqual(1.8)
    expect(vp.zoom).toBeGreaterThanOrEqual(0.4)
    /* 中心点换算后落在容器中心附近 */
    const center = worldToScreen({ x: 150 + LOOM_NODE_WIDTH / 2, y: 100 + LOOM_NODE_HEIGHT / 2 }, vp)
    expect(center.x).toBeCloseTo(400, 0)
    expect(center.y).toBeCloseTo(300, 0)
  })

  it('空画布归中：默认 100% 居中', () => {
    expect(fitViewport([], { width: 800, height: 600 })).toEqual({ x: 400, y: 300, zoom: 1 })
  })
})

describe('loomLayout 自动布局', () => {
  it('层内垂直居中：单节点层 y = 0', () => {
    expect(layoutPosition(0, 0, 1)).toEqual({ x: 0, y: 0 })
    const pos = layoutPosition(2, 1, 3)
    expect(pos.x).toBe(2 * (LOOM_NODE_WIDTH + 96))
    expect(pos.y).toBe(0)
  })

  it('autoLayout：链式 a→b→c 每层递增 x，同层节点 y 不同', () => {
    const graph = {
      nodes: [node('a'), node('b'), node('c'), node('x'), node('y')],
      edges: [dep('e1', 'a', 'b'), dep('e2', 'b', 'c'), dep('e3', 'x', 'y')],
    }
    const positions = autoLayout(graph)
    /* a 与 x 同在第 0 层；b 与 y 同在第 1 层 */
    expect(positions.a.x).toBe(positions.x.x)
    expect(positions.b.x).toBeGreaterThan(positions.a.x)
    expect(positions.c.x).toBeGreaterThan(positions.b.x)
    expect(positions.y.x).toBe(positions.b.x)
    expect(positions.a.y).not.toBe(positions.x.y)
  })

  it('autoLayout 子集：只动选中节点并保持左上角锚定', () => {
    const graph = {
      nodes: [node('a', 500, 400), node('b', 700, 400), node('keep', 1000, 1000)],
      edges: [dep('e1', 'a', 'b')],
    }
    const positions = autoLayout(graph, ['a', 'b'])
    expect(Object.keys(positions).sort()).toEqual(['a', 'b'])
    /* 锚定到原最小坐标 */
    expect(positions.a).toEqual({ x: 500, y: 400 })
    expect(positions.b.x).toBeGreaterThan(positions.a.x)
    expect(positions.keep).toBeUndefined()
  })

  it('nextNodePosition 依次下排，超过四个换列', () => {
    const one = [node('a', 0, 0)]
    const second = nextNodePosition(one)
    expect(second.x).toBe(0)
    expect(second.y).toBe(LOOM_NODE_HEIGHT + 40)

    const four = [
      node('a', 0, 0),
      node('b', 0, 136),
      node('c', 0, 272),
      node('d', 0, 408),
    ]
    const fifth = nextNodePosition(four)
    expect(fifth.x).toBe(LOOM_NODE_WIDTH + 96)
  })
})
