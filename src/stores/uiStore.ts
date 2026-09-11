import { create } from 'zustand'
import type { RoleId } from '../harness/types'
import { DEFAULT_RIGHT_TAB, type RightTab } from '../lib/rightPanel'

export type SidebarTab = 'tasks' | 'fav' | 'docs' | 'skills'

/** 画布轻通知级别（v0.9.4-02）：success = 操作完成；error = 被拒；info = 状态说明 */
export type LoomToastKind = 'info' | 'success' | 'error'

export interface LoomToast {
  id: number
  kind: LoomToastKind
  text: string
}

/** 画布高度边界（v0.9.4-02）：默认 300px，最小 180px，最大为中栏高度的 80% */
export const LOOM_PANEL_DEFAULT_HEIGHT = 300
export const LOOM_PANEL_MIN_HEIGHT = 180
export const LOOM_PANEL_MAX_RATIO = 0.8
/** 通知自动消失时间与并列上限 */
const LOOM_TOAST_TTL_MS = 3200
const LOOM_TOAST_MAX = 3
/** 通知 id 自增（模块级，避免与 store 状态耦合） */
let loomToastSeq = 0

/** 画布高度收敛（v0.9.4-02）：夹在 180px 与「父容器高度 × 80%」之间 */
export function clampLoomHeight(height: number, parentHeight: number): number {
  const max = Math.max(LOOM_PANEL_MIN_HEIGHT, Math.floor(parentHeight * LOOM_PANEL_MAX_RATIO))
  return Math.min(max, Math.max(LOOM_PANEL_MIN_HEIGHT, height))
}

/**
 * uiStore —— 轻量 UI 状态（v0.7）
 * 侧栏 tab 受控化：简报页「收藏夹」跳转链接可先定位 tab 再进入工作台。
 * v0.9.3 P0-A：右栏 tab 上移至此，新增「占位即切文档」焦点请求与回退提示开关。
 */
interface UiState {
  sidebarTab: SidebarTab
  setSidebarTab: (tab: SidebarTab) => void
  /** 中栏视图：chat = 对话流；loom = 空间任务台（v0.9.4 M2） */
  centerView: 'chat' | 'loom'
  setCenterView: (view: 'chat' | 'loom') => void
  /** 空间任务台展开态：false = 折叠（仅留入口条）；true = 展开画布 */
  loomOpen: boolean
  /** 沉浸态：画布占据整个中栏（v0.9.4 三级状态之三） */
  loomImmersive: boolean
  setLoomOpen: (open: boolean) => void
  setLoomImmersive: (immersive: boolean) => void
  /** 画布高度（px，非沉浸态生效；v0.9.4-02：可拖拽 180px ~ 中栏 80%，不持久化） */
  loomHeight: number
  setLoomHeight: (height: number) => void
  /** 画布轻通知队列（v0.9.4-02：分级 + 堆叠，最多 3 条，自动消失） */
  loomToasts: LoomToast[]
  pushLoomToast: (kind: LoomToastKind, text: string) => void
  dismissLoomToast: (id: number) => void
  /** 右栏当前 tab（桌面常驻与窄屏抽屉共用，抽屉开关不再丢失选择） */
  rightTab: RightTab
  /** rightTab 归属角色：角色切换时按角色默认重算（v0.9.2 P0-B 默认不被回退） */
  rightTabRole: RoleId | null
  setRightTab: (tab: RightTab) => void
  syncRightTabRole: (role: RoleId | null) => void
  /** 文档焦点请求计数：新占位 +1，RightPanel 消费后归零（仅「新占位」触发一次切换） */
  docFocusRequest: number
  requestDocFocus: () => void
  consumeDocFocus: () => void
  /** 「返回主工作台」轻提示是否已被用户收起（新占位时复位） */
  docNoticeDismissed: boolean
  dismissDocNotice: () => void
}

export const useUiStore = create<UiState>((set, get) => ({
  sidebarTab: 'tasks',
  setSidebarTab: (tab) => set({ sidebarTab: tab }),

  centerView: 'chat',
  setCenterView: (centerView) => set({ centerView }),
  loomOpen: false,
  loomImmersive: false,
  setLoomOpen: (loomOpen) => set({ loomOpen }),
  setLoomImmersive: (loomImmersive) => set({ loomImmersive }),

  loomHeight: LOOM_PANEL_DEFAULT_HEIGHT,
  setLoomHeight: (loomHeight) => set({ loomHeight }),

  loomToasts: [],
  pushLoomToast: (kind, text) => {
    const id = ++loomToastSeq
    /* 超出上限时丢弃最旧一条：新反馈永远可见 */
    set({ loomToasts: [...get().loomToasts, { id, kind, text }].slice(-LOOM_TOAST_MAX) })
    window.setTimeout(() => get().dismissLoomToast(id), LOOM_TOAST_TTL_MS)
  },
  dismissLoomToast: (id) => set({ loomToasts: get().loomToasts.filter((t) => t.id !== id) }),

  rightTab: 'doc',
  rightTabRole: null,
  setRightTab: (tab) => set({ rightTab: tab }),
  syncRightTabRole: (role) => {
    if (get().rightTabRole === role) return
    set({ rightTabRole: role, rightTab: role ? DEFAULT_RIGHT_TAB[role] : 'doc' })
  },

  docFocusRequest: 0,
  /** 新文档占位：切「文档」并复位轻提示（v0.9.3 P0-A ①） */
  requestDocFocus: () => set({ docFocusRequest: get().docFocusRequest + 1, rightTab: 'doc', docNoticeDismissed: false }),
  consumeDocFocus: () => {
    if (get().docFocusRequest !== 0) set({ docFocusRequest: 0 })
  },

  docNoticeDismissed: false,
  dismissDocNotice: () => set({ docNoticeDismissed: true }),
}))
