/**
 * Loom 节点卡片（v0.9.4 M2 / M6）
 *
 * - 纯展示 + 事件上报：拖拽由画布层统一接管（pointerdown 冒泡到画布），
 *   卡片自身只负责「选中态 / 状态视觉 / 双击打开 / 展开轨迹」；
 * - M6 新增：右上角展开箭头（可选 props 驱动）、Trace 投影子图、Artifact 节点展示、人工确认动作；
 * - 展开时卡片高度自适应（min 200 / max 260，不再固定 LOOM_NODE_HEIGHT）；
 * - 运行中节点右上角呼吸点，直接继承 v0.9.3 生成中视觉语言；
 * - 便签（note）为轻量小卡，不参与执行。
 */
import { memo, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import type { LoomNode } from '../../harness/loom/types'
import { LOOM_NODE_HEIGHT, LOOM_NODE_WIDTH } from '../../harness/loom/types'
import { LOOM_STATUS_META, LOOM_TYPE_META } from './loomNodeMeta'
import { LoomTraceSubgraph } from './LoomTraceSubgraph'
import { LoomArtifactNode } from './LoomArtifactNode'
import { LoomCheckpointActions } from './LoomCheckpointActions'
import type { LoomTraceItem } from './loomProjection'
import { cn } from '../../lib/cn'

export interface LoomNodeCardProps {
  node: LoomNode
  selected: boolean
  /** 拖拽中的临时坐标（未提交 store） */
  dragging?: boolean
  onSelect: (nodeId: string) => void
  onOpen: (nodeId: string) => void
  /** 只读任务地图（<768px 移动端）：禁用拖拽手势与人工确认动作 */
  readOnly?: boolean
  /** M6：展开态（由父级维护，控制 Trace 子图显隐） */
  expanded?: boolean
  /** M6：切换展开；提供后节点右上角出现展开箭头 */
  onToggleExpand?: (id: string) => void
  /** M6：Trace 投影结果（双击任务节点展开的只读子图） */
  traceItems?: LoomTraceItem[]
  /** M6：打开 Artifact 文档（主线接 uiStore.requestDocFocus / artifactStore.setActive） */
  onOpenArtifact?: (nodeId: string, artifactId: string) => void
  /** M6：人工确认节点动作 */
  onContinue?: (nodeId: string) => void
  onCancel?: (nodeId: string) => void
  /**
   * M6：展开区插槽（渲染在卡片内、状态行下方）。
   * 主线可传 `LoomTraceSubgraph`；不传时回退到内置的 `traceItems` 投影渲染。
   */
  children?: ReactNode
}

export const LoomNodeCard = memo(function LoomNodeCard({
  node,
  selected,
  dragging,
  onSelect,
  onOpen,
  readOnly = false,
  expanded = false,
  onToggleExpand,
  traceItems,
  onOpenArtifact,
  onContinue,
  onCancel,
  children,
}: LoomNodeCardProps) {
  const meta = LOOM_TYPE_META[node.type]
  const status = LOOM_STATUS_META[node.status]
  const isNote = node.type === 'note'
  const isArtifact = node.type === 'artifact'
  const isCheckpoint = node.type === 'checkpoint'
  /** 展开态对便签 / 人工确认节点无意义（便签不参与执行；确认节点展开即显示确认动作） */
  const expandedBody = expanded && !isNote && !isCheckpoint

  return (
    <div
      data-testid={`loom-node-${node.id}`}
      data-node-id={node.id}
      data-expanded={expandedBody ? 'true' : undefined}
      className={cn(
        'group absolute select-none rounded-2xl border shadow-soft transition-shadow',
        'px-3 py-2.5',
        status.card,
        selected && 'ring-2 ring-primary/60 shadow-pop',
        readOnly ? 'cursor-default' : dragging ? 'cursor-grabbing shadow-pop' : 'cursor-grab',
        isNote && 'rounded-xl',
      )}
      style={{
        width: LOOM_NODE_WIDTH,
        /* 收起态逻辑高度（96px）为下限；大字档位内容放大后卡片自适应增高（v0.9.4-02） */
        minHeight: expandedBody ? 200 : isNote ? LOOM_NODE_HEIGHT * 0.72 : LOOM_NODE_HEIGHT,
        maxHeight: expandedBody ? 260 : undefined,
        transform: `translate(${node.position.x}px, ${node.position.y}px)`,
        willChange: dragging ? 'transform' : undefined,
        contain: 'layout style paint',
      }}
      /* 不拦截 pointerdown：拖拽 / 连线由画布层统一接管（卡片仍上报选中） */
      onPointerDown={() => onSelect(node.id)}
      onDoubleClick={(e) => {
        e.stopPropagation()
        /* 文档节点双击 → 打开文档；其余走既有 onOpen（打开任务会话） */
        if (isArtifact && node.artifactId && onOpenArtifact) onOpenArtifact(node.id, node.artifactId)
        else onOpen(node.id)
      }}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-sm leading-none" aria-hidden>
          {meta.icon}
        </span>
        <span className="truncate text-[0.6875rem] font-medium text-ink-mute">{meta.label}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {onToggleExpand && !isNote && (
            <button
              type="button"
              data-testid="loom-node-expand"
              aria-label={expanded ? '收起执行轨迹' : '展开执行轨迹'}
              aria-expanded={expanded}
              onClick={(e) => {
                e.stopPropagation()
                onToggleExpand(node.id)
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              className="flex h-5 w-5 items-center justify-center rounded-md text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink"
            >
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          )}
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', status.dot)} />
        </div>
      </div>

      {isArtifact ? (
        /* 文档节点：交给 LoomArtifactNode 展示「正在生成 / 已生成」与打开入口 */
        <LoomArtifactNode
          item={{
            id: node.id,
            title: node.title,
            generating: node.status === 'running' || node.status === 'queued',
            done: node.status === 'done',
            failed: node.status === 'error',
            artifactId: node.artifactId,
          }}
          onOpen={onOpenArtifact}
        />
      ) : (
        <>
          <p className={cn('loom-node-title mt-1.5 truncate text-xs font-semibold text-ink', isNote && 'mt-1 text-[0.6875rem]')}>
            {node.title}
          </p>
          {node.description && !isNote && (
            <p className="loom-node-desc mt-0.5 line-clamp-2 text-[0.625rem] leading-snug text-ink-soft">
              {node.description}
            </p>
          )}

          {!isNote && (
            <div className="loom-node-meta mt-1.5 flex items-center gap-1.5 text-[0.625rem] font-medium">
              {node.status === 'running' ? (
                <>
                  <Loader2 size={10} className="animate-spin text-amber" />
                  <span className="text-amber">{status.label}</span>
                </>
              ) : node.status === 'done' ? (
                <>
                  <Check size={10} className="text-mint" />
                  <span className="text-mint">{status.label}</span>
                </>
              ) : node.status === 'error' ? (
                <span className="text-danger">{status.label}</span>
              ) : (
                <span className="text-ink-mute">{status.label}</span>
              )}
            </div>
          )}
        </>
      )}

      {/* 人工确认节点动作（仅 checkpoint 渲染；只读地图态隐藏） */}
      {isCheckpoint && !readOnly && onContinue && onCancel && (expanded || node.status === 'waiting') && (
        <LoomCheckpointActions
          nodeId={node.id}
          waiting={node.status === 'waiting'}
          onContinue={onContinue}
          onCancel={onCancel}
        />
      )}

      {/* 执行轨迹投影（展开箭头 / 双击展开）：优先渲染主线传入的 children，回退到 traceItems 投影 */}
      {children ?? (expandedBody ? <LoomTraceSubgraph items={traceItems ?? []} /> : null)}

      {/* 运行中呼吸点：复用 v0.9.3 生成中语言 */}
      {node.status === 'running' && (
        <span className="absolute -right-1 -top-1 flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber opacity-60" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-amber" />
        </span>
      )}
      {node.status === 'waiting' && (
        <span className="absolute -right-1 -top-1 flex h-3 w-3 rounded-full bg-coral" />
      )}

      {/* 连线起点（hover / 选中时显示）：按住拖到另一个节点即可建立依赖 */}
      {!readOnly && !isNote && (
        <span
          data-loom-handle="out"
          title="拖到另一个模块建立连接"
          className={cn(
            'absolute -right-[7px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-primary bg-surface transition-opacity',
            selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      )}
    </div>
  )
})
