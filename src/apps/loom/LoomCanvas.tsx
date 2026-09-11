/**
 * Loom 画布（v0.9.4 M2）——拖拽 / 缩放 / 平移 / 归中。
 *
 * 性能约定（见实施参考 M1/M2 决策）：
 * - 拖动过程只更新组件内 transient 坐标，不写 store、不写 localStorage；
 * - pointerup 提交一次 moveNode / setViewport，落盘走 300ms 合并；
 * - 画布变换用 translate + scale + will-change，拖动期间不触发 React 重渲。
 *
 * 交互：
 * - 节点上按下拖动 → 移动节点；空白处按下拖动 → 平移画布；Space + 拖动 → 平移；
 * - 滚轮 → 以指针为锚缩放（40% ~ 180%）；Ctrl/⌘ + 0 → 归中；◎ 按钮 → 归中。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Focus, Maximize2, Minimize2, Minus, Plus, LayoutGrid } from 'lucide-react'
import type { LoomNode, LoomPosition, LoomViewport } from '../../harness/loom/types'
import { LOOM_NODE_HEIGHT, LOOM_NODE_WIDTH, LOOM_ZOOM_DEFAULT } from '../../harness/loom/types'
import { useLoomStore } from '../../stores/loomStore'
import { useChatStore } from '../../stores/chatStore'
import { useArtifactStore } from '../../stores/artifactStore'
import { useUiStore } from '../../stores/uiStore'
import { clampZoom, fitViewport, screenToWorld, zoomAt } from '../../lib/loomGeometry'
import { LoomEdgeLayer, LoomDraftEdge } from './LoomEdges'
import { LoomNodeCard } from './LoomNodeCard'
import { projectTrace } from './loomProjection'
import { resumeCheckpoint } from '../../harness/loom/runner'
import { cn } from '../../lib/cn'

interface LoomCanvasProps {
  /** 沉浸态切换（工具栏右侧） */
  immersive: boolean
  onToggleImmersive: () => void
  selectedNodeId: string | null
  onSelectNode: (id: string | null) => void
  /** 双击节点（M3 打开编辑器 / M6 展开轨迹） */
  onOpenNode: (id: string) => void
  /** 节点被拖动后（供父级保存 / 提示） */
  onNodeMoved?: (id: string, position: LoomPosition) => void
  /** 空状态插槽（M4 提供带引导文案的空状态） */
  emptyState?: React.ReactNode
  /** 只读任务地图（<768px，v0.9.4-01 缺口修正 #5）：可点选 / 打开任务，不可拖拽、连线、新建 */
  readOnly?: boolean
}

type DragState =
  | { kind: 'none' }
  | { kind: 'pan'; startClient: LoomPosition; startViewport: LoomViewport }
  | {
      kind: 'node'
      nodeId: string
      offset: LoomPosition
      startClient: LoomPosition
      moved: boolean
    }

export default function LoomCanvas({
  immersive,
  onToggleImmersive,
  selectedNodeId,
  onSelectNode,
  onOpenNode,
  onNodeMoved,
  emptyState,
  readOnly = false,
}: LoomCanvasProps) {
  const board = useLoomStore((s) => s.boards.find((b) => b.id === s.activeBoardId) ?? null)
  const setViewport = useLoomStore((s) => s.setViewport)
  const moveNode = useLoomStore((s) => s.moveNode)
  const tidyBoard = useLoomStore((s) => s.tidyBoard)
  const connect = useLoomStore((s) => s.connect)

  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [drag, setDrag] = useState<DragState>({ kind: 'none' })
  /** 拖动中的节点临时坐标（pointerup 后清空） */
  const [transient, setTransient] = useState<Record<string, LoomPosition>>({})
  /** 连线草稿：从某节点出发的临时线 */
  const [draft, setDraft] = useState<{ from: string; to: LoomPosition } | null>(null)
  /** 自动整理过渡（原方案二十：300ms transform transition，而不是瞬间跳位置） */
  const [tidying, setTidying] = useState(false)
  const [spacePressed, setSpacePressed] = useState(false)
  /* 画布通知（v0.9.4-02）：分级 + 堆叠，替代原单条 hint */
  const toasts = useUiStore((s) => s.loomToasts)
  const pushLoomToast = useUiStore((s) => s.pushLoomToast)
  /** 展开子图的节点集合（纯视图态，不落盘） */
  const [expandedNodeIds, setExpandedNodeIds] = useState<string[]>([])
  const toggleExpand = useCallback((nodeId: string) => {
    setExpandedNodeIds((prev) => (prev.includes(nodeId) ? prev.filter((id) => id !== nodeId) : [...prev, nodeId]))
  }, [])

  const nodes = board?.nodes ?? []
  const edges = board?.edges ?? []
  /* 订阅 chat 会话签名：节点执行与 Trace 推进时画布跟随刷新 */
  useChatSignature()

  /* 视口渲染源为本地态：拖动 / 缩放的每一帧不写 store（性能约定）；
   * 结构提交时一次性 setViewport，落盘由 store 的 300ms 合并承担。 */
  const [viewport, setLocalViewport] = useState<LoomViewport>(
    () => board?.viewport ?? { x: 0, y: 0, zoom: LOOM_ZOOM_DEFAULT },
  )
  const viewportRef = useRef(viewport)
  viewportRef.current = viewport
  const commitTimer = useRef<number | null>(null)

  const commitViewport = useCallback(
    (next: LoomViewport = viewportRef.current) => {
      setViewport(next)
    },
    [setViewport],
  )

  /** 缩放 / 归中这类瞬态操作：本地立即生效，停止操作 250ms 后落库 */
  const scheduleCommitViewport = useCallback(() => {
    if (commitTimer.current !== null) window.clearTimeout(commitTimer.current)
    commitTimer.current = window.setTimeout(() => {
      commitTimer.current = null
      commitViewport()
    }, 250)
  }, [commitViewport])

  useEffect(
    () => () => {
      if (commitTimer.current !== null) window.clearTimeout(commitTimer.current)
    },
    [],
  )

  /* 切换画布时同步 store 中的视口 */
  const boardId = board?.id ?? null
  useEffect(() => {
    const vp = useLoomStore.getState().boards.find((b) => b.id === boardId)?.viewport
    if (vp) setLocalViewport(vp)
  }, [boardId])

  /* 容器尺寸（归中 / 背景网格用） */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }))
    observer.observe(el)
    setSize({ width: el.clientWidth, height: el.clientHeight })
    return () => observer.disconnect()
  }, [])

  /* Space 平移模式 */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isEditableTarget(e.target)) {
        e.preventDefault()
        setSpacePressed(true)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpacePressed(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const fitView = useCallback(() => {
    if (!board) return
    const next = fitViewport(board.nodes, size)
    setLocalViewport(next)
    commitViewport(next)
  }, [board, size, commitViewport])

  /* Ctrl/⌘ + 0 归中；Enter / Delete / Esc 作用于选中节点
   * （只读地图下只保留 Enter 进入任务，避免误删；编辑元素内不拦截） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === '0' || e.code === 'Digit0')) {
        e.preventDefault()
        fitView()
        return
      }
      if (isEditableTarget(e.target)) return
      if (e.key === 'Enter' && selectedNodeId) {
        e.preventDefault()
        onOpenNode(selectedNodeId)
        return
      }
      if (e.key === 'Escape') {
        onSelectNode(null)
        return
      }
      if (readOnly) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId) {
        e.preventDefault()
        useLoomStore.getState().removeNode(selectedNodeId)
        onSelectNode(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fitView, selectedNodeId, onOpenNode, onSelectNode, readOnly])

  const toWorld = useCallback(
    (clientX: number, clientY: number): LoomPosition => {
      const rect = containerRef.current?.getBoundingClientRect()
      const point = { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) }
      return screenToWorld(point, viewport)
    },
    [viewport],
  )

  /* ---------- 指针交互 ---------- */

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    const nodeEl = target.closest('[data-node-id]') as HTMLElement | null
    const handleEl = target.closest('[data-loom-handle]') as HTMLElement | null
    if (e.button !== 0 && e.button !== 1) return

    /* 只读地图：仍可选中 / 滚动浏览，但不启动拖拽与连线 */
    if (readOnly) {
      if (nodeEl) onSelectNode(nodeEl.dataset.nodeId as string)
      else onSelectNode(null)
      return
    }

    /* 连线手柄：进入连线草稿态（M3 正式吸附；此处先给出草稿线反馈） */
    if (handleEl && nodeEl) {
      const fromId = nodeEl.dataset.nodeId as string
      setDraft({ from: fromId, to: toWorld(e.clientX, e.clientY) })
      return
    }

    if (nodeEl && !spacePressed) {
      const nodeId = nodeEl.dataset.nodeId as string
      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return
      const world = toWorld(e.clientX, e.clientY)
      setDrag({
        kind: 'node',
        nodeId,
        offset: { x: world.x - node.position.x, y: world.y - node.position.y },
        startClient: { x: e.clientX, y: e.clientY },
        moved: false,
      })
      onSelectNode(nodeId)
      return
    }

    /* 空白 / Space：平移 */
    setDrag({ kind: 'pan', startClient: { x: e.clientX, y: e.clientY }, startViewport: viewport })
    onSelectNode(null)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (readOnly) return
    if (draft) {
      setDraft({ ...draft, to: toWorld(e.clientX, e.clientY) })
      return
    }
    if (drag.kind === 'none') return

    if (drag.kind === 'pan') {
      const dx = e.clientX - drag.startClient.x
      const dy = e.clientY - drag.startClient.y
      setLocalViewport({
        ...drag.startViewport,
        x: drag.startViewport.x + dx / viewport.zoom,
        y: drag.startViewport.y + dy / viewport.zoom,
      })
      return
    }

    const world = toWorld(e.clientX, e.clientY)
    const next = { x: world.x - drag.offset.x, y: world.y - drag.offset.y }
    const movedEnough =
      drag.moved ||
      Math.hypot(e.clientX - drag.startClient.x, e.clientY - drag.startClient.y) > 3
    setTransient((prev) => ({ ...prev, [drag.nodeId]: next }))
    if (movedEnough !== drag.moved) setDrag({ ...drag, moved: movedEnough })
  }

  const onPointerUp = () => {
    /* 连线草稿落点：目标卡片（排除自身）即建立依赖边；环 / 重边由 store 校验并给出提示 */
    if (draft) {
      const targetNode = nearestNodeAt(draft.to, nodes, draft.from)
      if (targetNode && draft.from !== targetNode.id) {
        const result = connect(draft.from, targetNode.id)
        if (!result.ok && result.error) {
          pushLoomToast('error', result.error)
        } else {
          const fromNode = nodes.find((n) => n.id === draft.from)
          pushLoomToast('success', `已连接：${fromNode?.title ?? ''} → ${targetNode.title}`)
        }
      }
      setDraft(null)
      return
    }

    if (drag.kind === 'node') {
      const position = transient[drag.nodeId]
      if (position) {
        if (drag.moved) {
          moveNode(drag.nodeId, position)
          onNodeMoved?.(drag.nodeId, position)
        }
        setTransient((prev) => {
          const next = { ...prev }
          delete next[drag.nodeId]
          return next
        })
      }
    }
    if (drag.kind === 'pan') commitViewport()
    setDrag({ kind: 'none' })
  }

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect()
    const point = { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) }
    setLocalViewport(zoomAt(viewport, point, e.deltaY < 0 ? 1.1 : 0.9))
    scheduleCommitViewport()
  }

  /* ---------- 渲染 ---------- */

  const positioned = useMemo(
    () => nodes.map((n) => (transient[n.id] ? { ...n, position: transient[n.id] } : n)),
    [nodes, transient],
  )
  const panning = drag.kind === 'pan' || spacePressed
  const showEmpty = nodes.length === 0

  return (
    <div
      ref={containerRef}
      data-testid="loom-canvas"
      className={cn(
        'relative h-full w-full overflow-hidden bg-bg',
        panning ? 'cursor-grab' : 'cursor-default',
      )}
      style={{
        backgroundImage:
          'radial-gradient(rgb(var(--line)) 1px, transparent 1px), radial-gradient(rgb(var(--line)) 1px, transparent 1px)',
        backgroundSize: `${24 * viewport.zoom}px ${24 * viewport.zoom}px`,
        backgroundPosition: `${viewport.x * viewport.zoom}px ${viewport.y * viewport.zoom}px, ${(viewport.x + 12) * viewport.zoom}px ${(viewport.y + 12) * viewport.zoom}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onWheel={onWheel}
    >
      {/* 节点层：与外层同为 min-w-0 容器，transform 承载平移 + 缩放 */}
      <div
        className={cn('relative', tidying && '[&_[data-node-id]]:transition-transform [&_[data-node-id]]:duration-300 [&_[data-node-id]]:ease-out')}
        style={{
          transform: `translate(${viewport.x * viewport.zoom}px, ${viewport.y * viewport.zoom}px) scale(${viewport.zoom})`,
          transformOrigin: '0 0',
        }}
      >
        <svg className="pointer-events-auto absolute overflow-visible" width={1} height={1} aria-hidden>
          <LoomEdgeLayer edges={edges} nodes={nodes} />
        </svg>
        {positioned.map((node) => (
          <LoomNodeCard
            key={node.id}
            node={node}
            selected={selectedNodeId === node.id}
            dragging={drag.kind === 'node' && drag.nodeId === node.id && drag.moved}
            onSelect={onSelectNode}
            onOpen={onOpenNode}
            expanded={expandedNodeIds.includes(node.id)}
            onToggleExpand={toggleExpand}
            readOnly={readOnly}
            traceItems={projectTrace(entryForNode(node))}
            /* v0.9.4-03：文档节点「打开」直达右栏逐字产出（M6 交付补接线） */
            onOpenArtifact={(_, artifactId) => {
              useArtifactStore.getState().setActive(artifactId)
              useUiStore.getState().requestDocFocus()
            }}
            onContinue={(id) => void resumeCheckpoint(id, 'continue')}
            onCancel={(id) => void resumeCheckpoint(id, 'cancel')}
          />
        ))}
      </div>

      {/* 连线草稿层（屏幕坐标：跟随指针） */}
      {draft && (
        <svg className="pointer-events-none absolute inset-0" width="100%" height="100%" aria-hidden>
          <g
            transform={`translate(${viewport.x * viewport.zoom}px, ${viewport.y * viewport.zoom}px) scale(${viewport.zoom})`}
          >
            <DraftFromNode from={draft.from} nodes={positioned} to={draft.to} />
          </g>
        </svg>
      )}

      {/* 空状态（M4 会替换为正式引导；此处保底） */}
      {showEmpty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6">
          {emptyState ?? (
            <p className="text-center text-xs text-ink-mute">采纳的简报会自动出现在这里</p>
          )}
        </div>
      )}

      {/* 只读地图提示（<768px）：明确「能做什么」，避免用户反复尝试拖拽 */}
      {readOnly && nodes.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
          <span className="rounded-full border border-line bg-surface/90 px-2.5 py-1 text-[0.5625rem] text-ink-mute backdrop-blur">
            任务地图 · 点击查看，进入任务后继续处理
          </span>
        </div>
      )}

      {/* 画布通知（v0.9.4-02）：顶部堆叠，成功 mint / 被拒 danger / 说明中性 */}
      {toasts.length > 0 && (
        <div
          data-testid="loom-toasts"
          className="pointer-events-none absolute left-1/2 top-2.5 z-20 flex w-[min(20rem,82%)] -translate-x-1/2 flex-col items-stretch gap-1.5"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              data-testid="loom-toast"
              data-kind={t.kind}
              className={cn(
                'animate-fade-up rounded-2xl border px-3 py-1.5 text-center text-[0.6875rem] leading-snug shadow-pop backdrop-blur',
                t.kind === 'success' && 'border-mint/35 bg-mint-soft/95 text-mint',
                t.kind === 'error' && 'border-danger/30 bg-danger/5 text-danger',
                t.kind === 'info' && 'border-line bg-surface/95 text-ink-soft',
              )}
            >
              {t.text}
            </div>
          ))}
        </div>
      )}

      {/* 工具条：缩放 / 归中 / 自动整理 / 沉浸态 */}
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-line bg-surface/95 px-1.5 py-1 shadow-soft backdrop-blur">
        <IconButton
          title="缩小"
          onClick={() => {
            setLocalViewport({ ...viewport, zoom: clampZoom(viewport.zoom / 1.15) })
            scheduleCommitViewport()
          }}
        >
          <Minus size={13} />
        </IconButton>
        <span className="w-10 text-center text-[0.625rem] font-medium text-ink-mute" data-testid="loom-zoom-label">
          {Math.round(viewport.zoom * 100)}%
        </span>
        <IconButton
          title="放大"
          onClick={() => {
            setLocalViewport({ ...viewport, zoom: clampZoom(viewport.zoom * 1.15) })
            scheduleCommitViewport()
          }}
        >
          <Plus size={13} />
        </IconButton>
        <span className="mx-1 h-4 w-px bg-line" />
        <IconButton title="归中（Ctrl+0）" onClick={fitView} testId="loom-fit">
          <Focus size={13} />
        </IconButton>
        {!readOnly && (
          <IconButton
            title="自动整理布局"
            onClick={() => {
              setTidying(true)
              tidyBoard()
              window.setTimeout(() => {
                setTidying(false)
                fitView()
              }, 320)
            }}
          >
            <LayoutGrid size={13} />
          </IconButton>
        )}
        <span className="mx-1 h-4 w-px bg-line" />
        <IconButton title={immersive ? '退出沉浸' : '沉浸态：画布占满中栏'} onClick={onToggleImmersive} testId="loom-immersive">
          {immersive ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </IconButton>
      </div>
    </div>
  )
}

function IconButton({
  children,
  title,
  onClick,
  testId,
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
  testId?: string
}) {
  return (
    <button
      type="button"
      title={title}
      data-testid={testId}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="flex h-7 w-7 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink"
    >
      {children}
    </button>
  )
}

/**
 * 运行态刷新源：订阅「chat 会话签名的变化」，驱动画布在节点执行 / Trace 推进时重渲。
 * 拖动 / 平移过程不涉及 chat 状态，因此不会引入额外重渲。
 */
function useChatSignature(): string {
  return useChatStore((s) =>
    s.sessions
      .map((sess) => {
        const last = sess.entries[sess.entries.length - 1]
        return `${sess.id}:${sess.entries.length}:${last ? last.id : ''}:${last?.trace.length ?? 0}:${last?.content.length ?? 0}:${last?.streaming ? 1 : 0}:${last?.error ? 1 : 0}`
      })
      .join('|'),
  )
}

/** 取某节点会话最后一条 assistant 条目（Trace 投影输入；无则返回空条目） */
function entryForNode(node: LoomNode) {
  const state = useChatStore.getState()
  const session = node.sessionId ? state.sessions.find((x) => x.id === node.sessionId) : undefined
  const entries = session?.entries ?? []
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].role === 'assistant') return entries[i]
  }
  return { id: 'empty', role: 'assistant' as const, content: '', trace: [] }
}

/** 用「点是否落在卡片内」找目标节点（连线吸附的兜底实现，M3 会换成锚点吸附） */
function nearestNodeAt(point: LoomPosition, nodes: LoomNode[], excludeId: string): LoomNode | null {
  for (const n of nodes) {
    if (n.id === excludeId) continue
    if (
      point.x >= n.position.x - 16 &&
      point.x <= n.position.x + LOOM_NODE_WIDTH + 16 &&
      point.y >= n.position.y - 16 &&
      point.y <= n.position.y + LOOM_NODE_HEIGHT + 16
    ) {
      return n
    }
  }
  return null
}

function DraftFromNode({ from, nodes, to }: { from: string; nodes: LoomNode[]; to: LoomPosition }) {
  const node = nodes.find((n) => n.id === from)
  if (!node) return null
  return (
    <LoomDraftEdge
      from={{ x: node.position.x + LOOM_NODE_WIDTH, y: node.position.y + LOOM_NODE_HEIGHT / 2 }}
      to={to}
    />
  )
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  return (
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) ||
    el.isContentEditable ||
    !!el.closest('[contenteditable="true"]')
  )
}
