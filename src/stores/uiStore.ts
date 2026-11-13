import { create } from 'zustand'
import type { RoleId } from '../harness/types'
import { DEFAULT_RIGHT_TAB, type RightTab } from '../lib/rightPanel'

export type SidebarTab = 'tasks' | 'fav' | 'docs' | 'skills'

/** 画布轻通知级别（v0.9.4-02）：success = 操作完成；error = 被拒；info = 状态说明 */
export type LoomToastKind = 'info' | 'success' | 'error'

/* ------------------------------------------------------------------ */
/* v1.2 M2 · 统一轻提示（roadmap §2.3 F6 / §3.4 / §3.5 notify.toast）    */
/* 吸收 Loom / Director / 收件箱三套提示；旧 loomToasts 保持字节级不动。   */
/* ------------------------------------------------------------------ */

/** 统一 toast 类别（与 contracts 的 ToastKind 同域；主 chunk 自持，不依赖 chunk 契约） */
export type ToastKind = 'info' | 'success' | 'error'

/** 统一轻提示条目：只放展示字段（不存实体）；`text` 在合并后形如「已保存 ×2」 */
export interface StudioToast {
  /** 模块级自增 id（同一时刻全局唯一） */
  id: number
  kind: ToastKind
  text: string
  /** 最近一次推送时间（毫秒）：同文案合并窗口与自动消失都以此为准 */
  at: number
}

/** 同文案合并窗口：1.5s 内的同文案推送折叠为「文案 ×N」，不新增条目（§3.4） */
export const STUDIO_TOAST_MERGE_MS = 1500
/** 同屏最多保留条数（超出丢弃最旧一条：新反馈永远可见） */
export const STUDIO_TOAST_MAX = 3
/** 自动消失时间（毫秒） */
export const STUDIO_TOAST_TTL_MS = 3200

/** 合并计数后缀：`文案 ×N`（N>1 时展示） */
const TOAST_COUNT_RE = /^(.*) ×(\d+)$/s

/**
 * 拆分合并后的文案（导出供单测/展示层）：
 * '已保存 ×3' → { base: '已保存', count: 3 }；无计数后缀 → { base: 原文, count: 1 }。
 */
export function splitToastText(text: string): { base: string; count: number } {
  const matched = TOAST_COUNT_RE.exec(text)
  if (!matched) return { base: text, count: 1 }
  return { base: matched[1], count: Number(matched[2]) }
}

/** 组装合并文案（导出供单测）：count ≤ 1 时保持原文，避免「×1」噪音 */
export function formatToastText(base: string, count: number): string {
  return count > 1 ? `${base} ×${count}` : base
}

/** 统一 toast id 自增（模块级，避免与 store 状态耦合；与旧 loomToastSeq 互不影响） */
let studioToastSeq = 0
/** 每个 toast 的自动消失定时器（合并/手动关闭时需清理，避免重复 dismiss 与泄漏） */
const studioToastTimers = new Map<number, number>()

/** 重排某个 toast 的自动消失定时器（合并计数时从最近一次推送起算 3.2s） */
function scheduleStudioToastDismiss(id: number): void {
  const existing = studioToastTimers.get(id)
  if (existing !== undefined) window.clearTimeout(existing)
  const timer = window.setTimeout(() => {
    studioToastTimers.delete(id)
    useUiStore.getState().dismissToast(id)
  }, STUDIO_TOAST_TTL_MS)
  studioToastTimers.set(id, timer)
}

/** 清理指定 toast 的定时器（手动关闭 / 超限淘汰时调用） */
function clearStudioToastTimer(id: number): void {
  const timer = studioToastTimers.get(id)
  if (timer === undefined) return
  window.clearTimeout(timer)
  studioToastTimers.delete(id)
}

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
  /**
   * v1.2 M2 统一轻提示（吸收 Loom / Director / 收件箱三套提示）：
   * 同文案 1.5s 内合并计数、最多 3 条、3.2s 自动消失；旧 loomToasts 仍然独立可用。
   */
  toasts: StudioToast[]
  pushToast: (kind: ToastKind, text: string) => void
  dismissToast: (id: number) => void
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

  toasts: [],
  /**
   * 统一轻提示（v1.2 M2）：同文案 1.5s 内合并为计数（条目 id 不变、`text` 记 `×N`、
   * 自动消失从最近一次推送重新计时）；最多保留 3 条（丢弃最旧）；id 模块级自增。
   */
  pushToast: (kind, text) => {
    const now = Date.now()
    const toasts = get().toasts
    /* ① 合并窗口：从最新一条往前找同文案（跨越不同的中间条目也算「最近」），命中即计数 +1 */
    for (let i = toasts.length - 1; i >= 0; i--) {
      const toast = toasts[i]
      if (now - toast.at > STUDIO_TOAST_MERGE_MS) break
      const { base, count } = splitToastText(toast.text)
      if (base !== text) continue
      const merged: StudioToast = { ...toast, kind, text: formatToastText(base, count + 1), at: now }
      set({ toasts: [...toasts.slice(0, i), merged, ...toasts.slice(i + 1)] })
      scheduleStudioToastDismiss(merged.id)
      return
    }

    /* ② 新增：超限丢弃最旧一条（并清掉它的定时器），新反馈永远可见 */
    const id = ++studioToastSeq
    const next = [...toasts, { id, kind, text: formatToastText(text, 1), at: now }]
    const dropped = next.length > STUDIO_TOAST_MAX ? next.splice(0, next.length - STUDIO_TOAST_MAX) : []
    dropped.forEach((toast) => clearStudioToastTimer(toast.id))
    set({ toasts: next })
    scheduleStudioToastDismiss(id)
  },
  dismissToast: (id) => {
    clearStudioToastTimer(id)
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },

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
