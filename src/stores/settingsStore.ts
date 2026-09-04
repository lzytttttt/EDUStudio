import { create } from 'zustand'
import type { ProviderMode } from '../harness/types'
import { ACTIVE_MODE } from '../harness/providerRegistry'
import { clearAll } from '../lib/storage'

interface SettingsState {
  /** 当前 harness 模式（本阶段恒为 mock，API 接入后由 ACTIVE_MODE 决定） */
  mode: ProviderMode
  clearAllData: () => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  mode: ACTIVE_MODE,
  clearAllData: () => {
    clearAll()
    set({ mode: ACTIVE_MODE })
    window.location.reload()
  },
}))
