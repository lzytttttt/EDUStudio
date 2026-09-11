/**
 * Loom 连线层（v0.9.4 M2 / M6）
 *
 * - EdgeLayer：SVG 层用与节点层相同的 translate/scale 变换，保证线随画布同步；
 * - 依赖边显示箭头标记，context 边为细虚线（信息流）；
 * - M6 执行动效（P2-B）：源节点 running → primary 流动虚线；源节点 done → mint 实线；其余保持灰/依赖色；
 * - 动效 keyframes 写在组件内的 <style> 标签，遵循 prefers-reduced-motion（不改 index.css / tailwind 配置）。
 */
import { memo } from 'react'
import type { LoomEdge, LoomNode, LoomPosition } from '../../harness/loom/types'
import { edgeAnchors } from '../../lib/loomGeometry'

interface EdgeLayerProps {
  edges: LoomEdge[]
  nodes: LoomNode[]
  /** 选中边高亮（点线可删的交互在 M3 补齐） */
  selectedEdgeId?: string | null
  onEdgeClick?: (edgeId: string) => void
}

/** 边色调：running=执行中（primary 流动）/ done=已完成（mint）/ dep=依赖待执行（primary）/ context=信息流（灰） */
type EdgeTone = 'running' | 'done' | 'dep' | 'context'

const TONE_STROKE: Record<EdgeTone, string> = {
  running: 'rgb(var(--primary))',
  done: 'rgb(var(--mint))',
  dep: 'rgb(var(--primary))',
  context: 'rgb(var(--ink-mute))',
}

const TONE_MARKER: Record<EdgeTone, string> = {
  running: 'url(#loom-arrow)',
  done: 'url(#loom-arrow-mint)',
  dep: 'url(#loom-arrow)',
  context: 'url(#loom-arrow-soft)',
}

export const LoomEdgeLayer = memo(function LoomEdgeLayer({
  edges,
  nodes,
  selectedEdgeId,
  onEdgeClick,
}: EdgeLayerProps) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return (
    <g>
      {/* 执行动效：流动虚线（reduced-motion 下自动关闭） */}
      <style>{`
        @keyframes loom-dash-flow { to { stroke-dashoffset: -24; } }
        .loom-flow { animation: loom-dash-flow 0.9s linear infinite; }
        @media (prefers-reduced-motion: reduce) { .loom-flow { animation: none; } }
      `}</style>
      <defs>
        <marker id="loom-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 8 4 L 0 8 z" fill="rgb(var(--primary))" />
        </marker>
        <marker id="loom-arrow-soft" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 8 4 L 0 8 z" fill="rgb(var(--ink-mute))" />
        </marker>
        <marker id="loom-arrow-mint" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 8 4 L 0 8 z" fill="rgb(var(--mint))" />
        </marker>
      </defs>
      {edges.map((edge) => {
        const from = byId.get(edge.from)
        const to = byId.get(edge.to)
        if (!from || !to) return null
        const { start, end } = edgeAnchors(from.position, to.position)
        const path = pathBetween(start, end)
        const isDependency = edge.type === 'dependency'
        const selected = selectedEdgeId === edge.id

        const tone: EdgeTone =
          from.status === 'running' ? 'running' : from.status === 'done' ? 'done' : isDependency ? 'dep' : 'context'
        const flowing = tone === 'running'

        return (
          <g key={edge.id} className={onEdgeClick ? 'cursor-pointer' : undefined} onClick={() => onEdgeClick?.(edge.id)}>
            {/* 加宽透明命中区：细线也能点中 */}
            <path d={path} fill="none" stroke="transparent" strokeWidth={14} />
            <path
              d={path}
              className={flowing ? 'loom-flow transition-colors duration-300' : 'transition-colors duration-300'}
              fill="none"
              stroke={TONE_STROKE[tone]}
              strokeWidth={selected ? 2.6 : tone === 'running' ? 2.2 : tone === 'dep' ? 1.8 : 1.4}
              /* running：流动虚线；context：静态细虚线；dependency：实线 */
              strokeDasharray={flowing ? '7 5' : tone === 'context' ? '5 4' : undefined}
              markerEnd={TONE_MARKER[tone]}
              opacity={selected ? 1 : tone === 'running' ? 1 : tone === 'done' ? 0.85 : tone === 'dep' ? 0.75 : 0.5}
            />
          </g>
        )
      })}
    </g>
  )
})

/** 拖拽中的临时连线：从起点直接连到指针位置 */
export function LoomDraftEdge({ from, to }: { from: LoomPosition; to: LoomPosition }) {
  return (
    <path
      d={pathBetween(from, to)}
      fill="none"
      stroke="rgb(var(--primary))"
      strokeWidth={2}
      strokeDasharray="6 4"
      opacity={0.9}
      markerEnd="url(#loom-arrow)"
    />
  )
}

/** 两个任意点之间的水平贝塞尔（临时边用，不假设卡片尺寸） */
function pathBetween(start: LoomPosition, end: LoomPosition): string {
  const midX = (start.x + end.x) / 2
  return `M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}`
}
