/**
 * loomStore —— 空间任务台状态（v0.9.4 M1）
 *
 * 边界与决策（见 doc/v0.9.4-01-loom-implementation.md）：
 * - 每个角色一张画布（不按周组织），key = role；
 * - 节点是 BriefingCard / ChatSession / ArtifactDoc 的空间视图，只存绑定 id；
 * - 拖动过程不写 store（组件 transient），pointerup 调用 moveNode 一次；
 * - 结构变更写盘走 300ms 合并（createDebouncedWriter），关键节点可 flush；
 * - 「从画布移除」简报任务节点写入 removedCardIds 墓碑，防止幂等重建复活。
 */
import { create } from 'zustand'
import type { RoleId } from '../harness/types'
import type {
  LoomBoard,
  LoomEdgeType,
  LoomNode,
  LoomNodeStatus,
  LoomNodeType,
  LoomPosition,
  LoomRunProgress,
  LoomSnapshot,
  LoomViewport,
  PersistedLoom,
} from '../harness/loom/types'
import {
  LOOM_HISTORY_MAX,
  LOOM_NODE_WIDTH,
  LOOM_SCHEMA_VERSION,
  LOOM_ZOOM_DEFAULT,
} from '../harness/loom/types'
import { addEdge, removeEdge } from '../lib/loomGraph'
import { autoLayout } from '../lib/loomLayout'
import { loadJSON, saveJSON } from '../lib/storage'
import { createDebouncedWriter } from '../lib/debouncedWrite'

/* ---------- 画布命名（v0.9.4-02：统一「xx画布」口径） ---------- */

const ROLE_BOARD_TITLE: Record<RoleId, string> = {
  teacher: '教学画布',
  schoolAdmin: '管理画布',
  bureau: '区域画布',
}

/** 角色 → 画布标题；渲染与迁移共用，保证旧数据也显示新口径 */
export function roleBoardTitle(role: RoleId): string {
  return ROLE_BOARD_TITLE[role] ?? '空间任务台'
}

/* ---------- 持久化 ---------- */

let persistWriter = createDebouncedWriter(() => writeNow())
let pendingBoards: LoomBoard[] | null = null

function writeNow(): void {
  if (pendingBoards) {
    /* 历史栈不落盘：体量大且刷新后无需保留，刷新即从空历史开始 */
    const boards = pendingBoards.map((b) => {
      if (!b.history) return b
      const { history: _drop, ...rest } = b
      return rest as LoomBoard
    })
    saveJSON('loom', { schemaVersion: LOOM_SCHEMA_VERSION, boards })
  }
  pendingBoards = null
}

function persist(boards: LoomBoard[]): void {
  pendingBoards = boards
  persistWriter.schedule()
}

/** 立即落盘（页面隐藏 / 卸载 / 关键结构变更 / 单测） */
export function flushLoomPersist(): void {
  /* 先 flush 让 writeNow 读到 pendingBoards，再由 writeNow 自行清空 */
  persistWriter.flush()
  pendingBoards = null
}

/** 清空待写（重置 / 备份前，避免把旧状态写回） */
export function cancelLoomPersist(): void {
  pendingBoards = null
  persistWriter.cancel()
}

function migrate(raw: PersistedLoom): LoomBoard[] {
  /* v1 → 未来版本在此链式迁移；损坏数据整体回退空画布 */
  if (!raw || !Array.isArray(raw.boards)) return []
  return raw.boards
    .filter((b): b is LoomBoard => !!b && typeof b.id === 'string' && !!b.role)
    /* 标题归一化：历史数据里存的旧口径（"今日教学任务"等）在加载时校正 */
    .map((b) => ({ ...b, title: roleBoardTitle(b.role) }))
}

const persisted = loadJSON<PersistedLoom>('loom', { schemaVersion: LOOM_SCHEMA_VERSION, boards: [] })
/* 刷新后 running 恢复为 queued：避免「执行中」僵死状态（v0.9.4-01 决策） */
const initialBoards: LoomBoard[] = migrate(persisted).map((b) => ({
  ...b,
  nodes: (b.nodes ?? []).map((n) => (n.status === 'running' ? { ...n, status: 'queued' as LoomNodeStatus } : n)),
}))

/* ---------- 历史（Undo / Redo，仅结构变更；随画布存储，跨画布互不影响） ---------- */

function snapshotOf(board: LoomBoard): LoomSnapshot {
  return { nodes: board.nodes, edges: board.edges, removedCardIds: board.removedCardIds }
}

function historyOf(board: LoomBoard): { past: LoomSnapshot[]; future: LoomSnapshot[] } {
  return board.history ?? { past: [], future: [] }
}

/** 历史可用性（供工具栏按钮禁用态） */
export function loomHistory(board: LoomBoard | null): { canUndo: boolean; canRedo: boolean } {
  const h = board ? historyOf(board) : { past: [], future: [] }
  return { canUndo: h.past.length > 0, canRedo: h.future.length > 0 }
}

/* ---------- 工具 ---------- */

let seq = 0
function nextId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq}`
}

function emptyBoard(role: RoleId): LoomBoard {
  return {
    id: `board-${role}`,
    role,
    title: roleBoardTitle(role),
    nodes: [],
    edges: [],
    removedCardIds: [],
    viewport: { x: 0, y: 0, zoom: LOOM_ZOOM_DEFAULT },
    updatedAt: Date.now(),
  }
}

/* ---------- Store ---------- */

interface LoomState {
  boards: LoomBoard[]
  activeBoardId: string | null

  /* board 生命周期 */
  setActiveBoard: (id: string) => void
  ensureBoard: (role: RoleId) => LoomBoard
  activeBoard: () => LoomBoard | null

  /* 节点 */
  addNode: (
    patch: Partial<Pick<LoomNode, 'title' | 'description' | 'instruction' | 'type'>> & { type: LoomNodeType },
  ) => string | null
  updateNode: (nodeId: string, patch: Partial<LoomNode>) => void
  moveNode: (nodeId: string, position: LoomPosition) => void
  /** 从画布移除节点：简报任务节点写墓碑（不删 ChatSession） */
  removeNode: (nodeId: string) => void
  setNodeStatus: (nodeId: string, status: LoomNodeStatus) => void

  /* 简报任务空间化（幂等） */
  ensureTaskNode: (args: {
    role: RoleId
    cardId: string
    title: string
    description?: string
    sessionId?: string
  }) => string | null

  /* 文档节点（v0.9.4-03：Agent 产出文档 → 画布同步出现，幂等按 artifactId 复用） */
  ensureArtifactOutputNode: (args: {
    role: RoleId
    artifactId: string
    title: string
    /** 触发产出的节点：文档节点落在其右侧；缺省用网格错开落点 */
    afterNodeId?: string
  }) => string | null
  /** 文档节点状态收口（running 生成中 / done 已生成 / error 未完成） */
  setArtifactNodeStatus: (artifactId: string, status: LoomNodeStatus, title?: string) => void

  /* 边 */
  connect: (from: string, to: string, type?: LoomEdgeType) => { ok: boolean; error?: string }
  disconnect: (edgeId: string) => void

  /* 视口 */
  setViewport: (viewport: LoomViewport) => void

  /* 布局 */
  tidyBoard: (subset?: string[]) => void

  /* 历史 */
  undo: () => boolean
  redo: () => boolean

  /* 运行器（M5 使用） */
  nextQueuedNode: () => LoomNode | null
  /** 运行进度（纯内存态，不持久化） */
  runProgress: LoomRunProgress
  /** 写入节点执行输出（运行时产出，不进入 undo 历史） */
  setNodeRunOutput: (nodeId: string, output: string) => void
  /** 批量置 queued 并初始化本轮进度（一次「开始处理」调用一次） */
  beginRun: (ids: string[]) => void
  /** 合并更新运行进度 */
  setRunProgress: (patch: Partial<LoomRunProgress>) => void
  /** 本轮结束：running 置 false */
  endRun: () => void
}

/** 取当前可写 board；不存在时自动按 activeBoardId 的首个 board 兜底 */
function currentBoard(state: LoomState): LoomBoard | null {
  if (!state.activeBoardId) return null
  return state.boards.find((b) => b.id === state.activeBoardId) ?? null
}

function updateBoard(boards: LoomBoard[], boardId: string, patch: (b: LoomBoard) => LoomBoard): LoomBoard[] {
  return boards.map((b) => (b.id === boardId ? { ...patch(b), updatedAt: Date.now() } : b))
}

function pushedHistory(board: LoomBoard): { past: LoomSnapshot[]; future: LoomSnapshot[] } {
  const h = historyOf(board)
  return { past: [...h.past, snapshotOf(board)].slice(-LOOM_HISTORY_MAX), future: [] }
}

export const useLoomStore = create<LoomState>((set, get) => {
  const mutate = (patch: (b: LoomBoard) => LoomBoard): void => {
    const board = currentBoard(get())
    if (!board) return
    const boards = updateBoard(get().boards, board.id, patch)
    set({ boards })
    persist(boards)
  }

  const mutateWithHistory = (patch: (b: LoomBoard) => LoomBoard): void => {
    const board = currentBoard(get())
    if (!board) return
    const history = pushedHistory(board)
    const boards = updateBoard(get().boards, board.id, (b) => ({ ...patch(b), history }))
    set({ boards })
    persist(boards)
  }

  return {
    boards: initialBoards,
    activeBoardId: initialBoards[0]?.id ?? null,
    runProgress: { running: false, total: 0, done: 0, failed: 0 },

    setActiveBoard: (id) => set({ activeBoardId: id }),

    ensureBoard: (role) => {
      const owned = get().boards.find((b) => b.role === role)
      if (owned) {
        if (get().activeBoardId !== owned.id) set({ activeBoardId: owned.id })
        return owned
      }
      const board = emptyBoard(role)
      const boards = [...get().boards, board]
      set({ boards, activeBoardId: board.id })
      persist(boards)
      return board
    },

    activeBoard: () => currentBoard(get()),

    addNode: (patch) => {
      const board = currentBoard(get())
      if (!board) return null
      const node: LoomNode = {
        id: nextId('lnode'),
        type: patch.type,
        title: patch.title ?? defaultTitle(patch.type),
        description: patch.description,
        instruction: patch.instruction,
        position: patchPosition(board),
        status: 'idle',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      mutateWithHistory((b) => ({ ...b, nodes: [...b.nodes, node] }))
      return node.id
    },

    updateNode: (nodeId, patch) => {
      mutate((b) => ({
        ...b,
        nodes: b.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch, id: n.id, updatedAt: Date.now() } : n)),
      }))
    },

    moveNode: (nodeId, position) => {
      mutateWithHistory((b) => ({
        ...b,
        nodes: b.nodes.map((n) => (n.id === nodeId ? { ...n, position, updatedAt: Date.now() } : n)),
      }))
    },

    removeNode: (nodeId) => {
      const board = currentBoard(get())
      if (!board) return
      const node = board.nodes.find((n) => n.id === nodeId)
      if (!node) return
      mutateWithHistory((b) => ({
        ...b,
        nodes: b.nodes.filter((n) => n.id !== nodeId),
        edges: b.edges.filter((e) => e.from !== nodeId && e.to !== nodeId),
        removedCardIds: node.cardId ? [...new Set([...b.removedCardIds, node.cardId])] : b.removedCardIds,
      }))
    },

    setNodeStatus: (nodeId, status) => {
      mutate((b) => ({
        ...b,
        nodes: b.nodes.map((n) => (n.id === nodeId ? { ...n, status, updatedAt: Date.now() } : n)),
      }))
    },

    ensureTaskNode: ({ role, cardId, title, description, sessionId }) => {
      const board = get().ensureBoard(role)
      if (board.removedCardIds.includes(cardId)) return null
      const owned = board.nodes.find((n) => n.cardId === cardId)
      if (owned) {
        /* 幂等：已有节点只补齐绑定，不重复创建 */
        if (sessionId && owned.sessionId !== sessionId) {
          get().updateNode(owned.id, { sessionId })
        }
        return owned.id
      }
      const node: LoomNode = {
        id: nextId('lnode'),
        type: 'task',
        title,
        description: description ?? '来自今日简报',
        position: patchPosition(board),
        status: 'idle',
        cardId,
        sessionId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      mutateWithHistory((b) => ({ ...b, nodes: [...b.nodes, node] }))
      return node.id
    },

    ensureArtifactOutputNode: ({ role, artifactId, title, afterNodeId }) => {
      const board = get().ensureBoard(role)
      const owned = board.nodes.find((n) => n.type === 'artifact' && n.artifactId === artifactId)
      if (owned) {
        /* 幂等：已有节点只刷新标题与生成态，不重复创建 */
        if (owned.title !== title || owned.status !== 'running') {
          get().updateNode(owned.id, { title, status: 'running' })
        }
        return owned.id
      }
      const anchor = afterNodeId ? board.nodes.find((n) => n.id === afterNodeId) : undefined
      const node: LoomNode = {
        id: nextId('lnode'),
        type: 'artifact',
        title,
        position: anchor
          ? { x: anchor.position.x + LOOM_NODE_WIDTH + 48, y: anchor.position.y }
          : patchPosition(board),
        status: 'running',
        artifactId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      /* 运行态产出不进 undo 历史（避免 Ctrl+Z 撤销系统节点，与 setNodeRunOutput 同策略） */
      mutate((b) => ({ ...b, nodes: [...b.nodes, node] }))
      return node.id
    },

    setArtifactNodeStatus: (artifactId, status, title) => {
      mutate((b) => ({
        ...b,
        nodes: b.nodes.map((n) =>
          n.type === 'artifact' && n.artifactId === artifactId
            ? { ...n, status, ...(title ? { title } : {}), updatedAt: Date.now() }
            : n,
        ),
      }))
    },

    connect: (from, to, type = 'dependency') => {
      const board = currentBoard(get())
      if (!board) return { ok: false, error: '画布不存在' }
      const result = addEdge(board.edges, from, to, type)
      if (result.error) return { ok: false, error: result.error }
      mutateWithHistory((b) => ({ ...b, edges: result.edges }))
      return { ok: true }
    },

    disconnect: (edgeId) => {
      mutateWithHistory((b) => ({ ...b, edges: removeEdge(b.edges, edgeId) }))
    },

    setViewport: (viewport) => {
      mutate((b) => ({ ...b, viewport }))
    },

    tidyBoard: (subset) => {
      const board = currentBoard(get())
      if (!board) return
      const positions = autoLayout(board, subset)
      if (Object.keys(positions).length === 0) return
      mutateWithHistory((b) => ({
        ...b,
        nodes: b.nodes.map((n) => (positions[n.id] ? { ...n, position: positions[n.id], updatedAt: Date.now() } : n)),
      }))
    },

    undo: () => {
      const board = currentBoard(get())
      if (!board) return false
      const h = historyOf(board)
      if (h.past.length === 0) return false
      const snapshot = h.past[h.past.length - 1]
      const history = {
        past: h.past.slice(0, -1),
        future: [snapshotOf(board), ...h.future].slice(0, LOOM_HISTORY_MAX),
      }
      const boards = updateBoard(get().boards, board.id, (b) => ({ ...b, ...snapshot, history }))
      set({ boards })
      persist(boards)
      return true
    },

    redo: () => {
      const board = currentBoard(get())
      if (!board) return false
      const h = historyOf(board)
      if (h.future.length === 0) return false
      const snapshot = h.future[0]
      const history = {
        past: [...h.past, snapshotOf(board)].slice(-LOOM_HISTORY_MAX),
        future: h.future.slice(1),
      }
      const boards = updateBoard(get().boards, board.id, (b) => ({ ...b, ...snapshot, history }))
      set({ boards })
      persist(boards)
      return true
    },

    nextQueuedNode: () => {
      const board = currentBoard(get())
      if (!board) return null
      return board.nodes.find((n) => n.status === 'queued') ?? null
    },

    setNodeRunOutput: (nodeId, output) => {
      /* 运行时产出不进 undo 历史（避免覆盖用户结构操作的历史栈） */
      mutate((b) => ({
        ...b,
        nodes: b.nodes.map((n) => (n.id === nodeId ? { ...n, runOutput: output, updatedAt: Date.now() } : n)),
      }))
    },

    beginRun: (ids) => {
      const board = currentBoard(get())
      if (!board) return
      const idSet = new Set(ids)
      const boards = updateBoard(get().boards, board.id, (b) => ({
        ...b,
        nodes: b.nodes.map((n) =>
          idSet.has(n.id) ? { ...n, status: 'queued' as LoomNodeStatus, updatedAt: Date.now() } : n,
        ),
      }))
      set({ boards, runProgress: { running: true, total: ids.length, done: 0, failed: 0 } })
      persist(boards)
    },

    setRunProgress: (patch) => {
      set((s) => ({ runProgress: { ...s.runProgress, ...patch } }))
    },

    endRun: () => {
      set((s) => ({ runProgress: { ...s.runProgress, running: false } }))
    },
  }
})

/* ---------- 辅助（纯函数，可单测） ---------- */

function defaultTitle(type: LoomNodeType): string {
  switch (type) {
    case 'agent':
      return 'AI 处理'
    case 'checkpoint':
      return '人工确认'
    case 'note':
      return '便签'
    case 'artifact':
      return '文档'
    case 'tool':
      return '工具'
    default:
      return '新任务'
  }
}

/** 新节点落点：横向简单错开，避免完全重叠（用户可拖动 / 自动整理） */
function patchPosition(board: LoomBoard): LoomPosition {
  const index = board.nodes.length
  return { x: (index % 4) * 260, y: Math.floor(index / 4) * 140 }
}

/** 运行器判定：本轮是否需要继续（存在 queued / running 节点） */
export function hasPendingNodes(board: LoomBoard): boolean {
  return board.nodes.some((n) => n.status === 'queued' || n.status === 'running')
}

/** 节点统计（供面板徽标） */
export function boardStats(board: LoomBoard): { total: number; done: number; pending: number; error: number } {
  return {
    total: board.nodes.length,
    done: board.nodes.filter((n) => n.status === 'done').length,
    pending: board.nodes.filter((n) => n.status === 'queued' || n.status === 'running' || n.status === 'waiting').length,
    error: board.nodes.filter((n) => n.status === 'error').length,
  }
}
