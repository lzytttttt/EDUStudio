/**
 * Loom 空间任务台面板（v0.9.4 M2）
 *
 * - 中栏第二视图（Chat ↔ 空间任务台），由 uiStore.centerView 控制；
 * - 折叠态时只显示一行入口条，点击展开默认高度画布；沉浸态占满中栏；
 * - 原方案语言：不是「流程图编辑器」，而是「把简报任务摊开来工作」。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Sparkles, ChevronRight, Undo2, Redo2, Play, Square } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useArtifactStore } from '../../stores/artifactStore'
import { useChatStore } from '../../stores/chatStore'
import { useLoomStore, boardStats, loomHistory, roleBoardTitle } from '../../stores/loomStore'
import { LOOM_PANEL_DEFAULT_HEIGHT, clampLoomHeight, useUiStore } from '../../stores/uiStore'
import { runLoom, stopLoom } from '../../harness/loom/runner'
import type { LoomNodeType } from '../../harness/loom/types'
import { LOOM_CREATABLE_TYPES, LOOM_TYPE_META } from './loomNodeMeta'
import LoomCanvas from './LoomCanvas'
import LoomNodeEditor from './LoomNodeEditor'
import { cn } from '../../lib/cn'

interface LoomPanelProps {
  /** 沉浸态由父级（中栏）决定是否隐藏对话区，故提升到 uiStore 统一管理 */
  onRequestClose: () => void
}

export default function LoomPanel({ onRequestClose }: LoomPanelProps) {
  const role = useAuthStore((s) => s.role)
  const ensureBoard = useLoomStore((s) => s.ensureBoard)
  const board = useLoomStore((s) => s.boards.find((b) => b.id === s.activeBoardId) ?? null)
  const addNode = useLoomStore((s) => s.addNode)
  const tidyBoard = useLoomStore((s) => s.tidyBoard)
  const undo = useLoomStore((s) => s.undo)
  const redo = useLoomStore((s) => s.redo)
  const immersive = useUiStore((s) => s.loomImmersive)
  const setImmersive = useUiStore((s) => s.setLoomImmersive)
  const setActive = useChatStore((s) => s.setActive)
  const runProgress = useLoomStore((s) => s.runProgress)
  /* 画布高度可拖拽（v0.9.4-02）：180px ~ 中栏 80%，双击复位 */
  const loomHeight = useUiStore((s) => s.loomHeight)
  const setLoomHeight = useUiStore((s) => s.setLoomHeight)
  const panelRef = useRef<HTMLElement>(null)
  const [resizing, setResizing] = useState(false)

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  /* 只读任务地图（<768px，v0.9.4-01 缺口修正 #5）：可浏览、进任务，不可拖拽 / 连线 / 新建 */
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches,
  )

  /* 进入面板确保当前角色画布存在（幂等） */
  useEffect(() => {
    if (role) ensureBoard(role)
  }, [role, ensureBoard])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const onChange = () => setIsMobile(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const stats = board ? boardStats(board) : { total: 0, done: 0, pending: 0, error: 0 }
  const history = useMemo(() => loomHistory(board), [board])

  /** 中栏可用高度（父容器）→ 画布高度收敛（180px ~ 80%） */
  const panelHeightLimit = (height: number) => {
    const parentH = panelRef.current?.parentElement?.clientHeight ?? window.innerHeight
    return clampLoomHeight(height, parentH)
  }

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = loomHeight
    setResizing(true)
    const onMove = (ev: PointerEvent) => {
      /* 向上拖增大：新的高度 = 起始高度 − 指针位移 */
      setLoomHeight(panelHeightLimit(startH - (ev.clientY - startY)))
    }
    const onUp = () => {
      setResizing(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  /* 窗口尺寸变化后收敛：不允许超过新的 80% 上限 */
  useEffect(() => {
    const onResize = () => {
      const cur = useUiStore.getState().loomHeight
      const next = panelHeightLimit(cur)
      if (next !== cur) setLoomHeight(next)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setLoomHeight])

  const handleOpenNode = (nodeId: string) => {
    const node = board?.nodes.find((n) => n.id === nodeId)
    if (node?.sessionId) {
      /* 点击任务节点 → 同步左侧任务与下方对话（原方案十六） */
      setActive(node.sessionId)
      useUiStore.getState().setCenterView('chat')
      return
    }
    if (node?.type === 'artifact' && node.artifactId) {
      /* 文档节点 → 右栏「文档」逐字产出（原方案二十五：Loom 是各部分之间的导航层） */
      useArtifactStore.getState().setActive(node.artifactId)
      useUiStore.getState().requestDocFocus()
      return
    }
    setSelectedNodeId(nodeId)
  }

  const runnable = (board?.nodes ?? []).filter((n) => n.status !== 'done' && n.status !== 'waiting').length
  const waiting = (board?.nodes ?? []).some((n) => n.status === 'waiting')

  return (
    <section
      ref={panelRef}
      data-testid="loom-panel"
      className={cn('relative flex min-h-0 flex-col border-b border-line bg-surface', immersive ? 'flex-1' : 'shrink-0')}
      style={immersive ? undefined : { height: loomHeight }}
    >
      {/* 高度拖拽条（v0.9.4-02）：向上拖增大，最大中栏 80%，双击复位 */}
      {!immersive && (
        <div
          data-testid="loom-resize"
          role="separator"
          aria-orientation="horizontal"
          aria-label="调整画布高度"
          title="拖动调整画布高度，双击复位"
          onPointerDown={startResize}
          onDoubleClick={() => setLoomHeight(LOOM_PANEL_DEFAULT_HEIGHT)}
          className={cn(
            'group flex h-1.5 shrink-0 cursor-row-resize items-center justify-center transition-colors',
            resizing ? 'bg-primary/30' : 'bg-line/70 hover:bg-primary/25',
          )}
        >
          <span className="h-0.5 w-8 rounded-full bg-ink-mute/40 transition-colors group-hover:bg-primary/60" />
        </div>
      )}
      {/* 头部：标题 + 统计 + 工具 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2 md:px-4">
        <span className="text-sm" aria-hidden>
          ✦
        </span>
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="truncate text-xs font-semibold text-ink">
            {board ? roleBoardTitle(board.role) : '空间任务台'}
          </h2>
          <p className="minor-info truncate text-[0.625rem] text-ink-mute">
            {stats.total === 0
              ? '把今天的任务摊开来处理'
              : `${stats.total} 个模块 · ${stats.done} 已完成${stats.pending ? ` · ${stats.pending} 待处理` : ''}${stats.error ? ` · ${stats.error} 失败` : ''}`}
          </p>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            title="撤销（Ctrl+Z）"
            disabled={!history.canUndo}
            onClick={() => undo()}
            className="hidden h-7 w-7 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-30 sm:flex"
          >
            <Undo2 size={13} />
          </button>
          <button
            type="button"
            title="重做（Ctrl+Shift+Z）"
            disabled={!history.canRedo}
            onClick={() => redo()}
            className="hidden h-7 w-7 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-30 sm:flex"
          >
            <Redo2 size={13} />
          </button>
          <span className="mx-0.5 hidden h-4 w-px bg-line sm:block" />
          <button
            type="button"
            data-testid="loom-tidy"
            title="整理：按依赖关系自动排列"
            onClick={() => tidyBoard()}
            className="hidden items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[0.6875rem] font-medium text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink sm:inline-flex"
          >
            ⌗ 整理
          </button>
          {!isMobile && (
            <button
              type="button"
              data-testid="loom-add"
              onClick={() => setAddOpen((v) => !v)}
              className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-1 text-[0.6875rem] font-medium text-primary transition-colors hover:bg-primary/15"
            >
              <Plus size={12} />
              模块
            </button>
          )}
          {/* 开始处理（原方案十二）：按依赖真实执行；运行中可停止 */}
          {board && board.nodes.length > 0 && (
            <button
              type="button"
              data-testid="loom-run"
              disabled={!runProgress.running && runnable === 0}
              onClick={() => (runProgress.running ? stopLoom() : void runLoom())}
              title={
                runProgress.running
                  ? '停止本轮（当前节点完成后退出）'
                  : waiting
                    ? '确认节点已就绪，点击继续下游'
                    : '按依赖顺序真实执行'
              }
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[0.6875rem] font-medium shadow-soft transition-all',
                runProgress.running
                  ? 'border border-line bg-surface text-ink-soft hover:bg-surface-2'
                  : 'bg-primary text-white hover:bg-primary-deep disabled:opacity-40',
              )}
            >
              {runProgress.running ? <Square size={11} /> : <Play size={11} />}
              {runProgress.running
                ? `处理中 ${runProgress.done}/${runProgress.total}`
                : waiting
                  ? '继续处理'
                  : '开始处理'}
            </button>
          )}
          {!immersive && (
            <button
              type="button"
              onClick={onRequestClose}
              title="收起到对话"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <ChevronRight size={14} />
            </button>
          )}
        </div>

        {/* 添加菜单（M3 编辑器补齐后再开放完整类型） */}
        {addOpen && (
          <div
            data-testid="loom-add-menu"
            className="animate-fade-up absolute right-3 top-11 z-20 w-52 rounded-2xl border border-line bg-surface p-1.5 shadow-pop"
          >
            <p className="px-2 py-1 text-[0.625rem] font-medium text-ink-mute">添加到空间</p>
            {LOOM_CREATABLE_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                data-testid={`loom-add-${type}`}
                onClick={() => {
                  const id = addNode({ type, title: LOOM_TYPE_META[type].label })
                  setAddOpen(false)
                  if (id) setSelectedNodeId(id)
                }}
                className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-xs text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <span aria-hidden>{LOOM_TYPE_META[type].icon}</span>
                {LOOM_TYPE_META[type].label}
                <span className="ml-auto text-[0.5625rem] text-ink-mute">{LOOM_TYPE_META[type].hint}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 画布 */}
      <div className="relative min-h-0 flex-1">
        <LoomCanvas
          immersive={immersive}
          onToggleImmersive={() => setImmersive(!immersive)}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          onOpenNode={handleOpenNode}
          emptyState={<LoomEmptyStateInternal />}
          readOnly={isMobile}
        />
      </div>

      {/* 节点编辑器：只读地图下不提供编辑（保持信息只读，进任务后处理） */}
      {selectedNodeId && !isMobile && (
        <LoomNodeEditor
          nodeId={selectedNodeId}
          onClose={() => setSelectedNodeId(null)}
          onDeleted={() => setSelectedNodeId(null)}
        />
      )}
    </section>
  )
}

function LoomEmptyStateInternal() {
  return (
    <div className="pointer-events-none max-w-xs text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-soft text-primary">
        <Sparkles size={18} />
      </div>
      <p className="mt-3 text-sm font-semibold text-ink">把今天的任务摊开来处理</p>
      <p className="mt-1 text-[0.6875rem] leading-relaxed text-ink-soft">
        采纳的简报会自动出现在这里，
        <br />
        也可以自己增加一步工作。
      </p>
      <p className="minor-info mt-2.5 text-[0.625rem] text-ink-mute">拖动空白区域移动画布 · 滚轮缩放</p>
    </div>
  )
}


