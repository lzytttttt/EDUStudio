import { create } from 'zustand'
import type { RoleId } from '../harness/types'
import { DEFAULT_RIGHT_TAB, type RightTab } from '../lib/rightPanel'

export type SidebarTab = 'tasks' | 'fav' | 'docs' | 'skills'

/**
 * uiStore —— 轻量 UI 状态（v0.7）
 * 侧栏 tab 受控化：简报页「收藏夹」跳转链接可先定位 tab 再进入工作台。
 * v0.9.3 P0-A：右栏 tab 上移至此，新增「占位即切文档」焦点请求与回退提示开关。
 */
interface UiState {
  sidebarTab: SidebarTab
  setSidebarTab: (tab: SidebarTab) => void
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
