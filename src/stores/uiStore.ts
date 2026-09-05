import { create } from 'zustand'

export type SidebarTab = 'tasks' | 'fav' | 'docs' | 'skills'

/**
 * uiStore —— 轻量 UI 状态（v0.7）
 * 侧栏 tab 受控化：简报页「收藏夹」跳转链接可先定位 tab 再进入工作台。
 */
interface UiState {
  sidebarTab: SidebarTab
  setSidebarTab: (tab: SidebarTab) => void
}

export const useUiStore = create<UiState>((set) => ({
  sidebarTab: 'tasks',
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
}))
