import { create } from 'zustand'
import type { ProviderMode } from '../harness/types'
import { ACTIVE_MODE, DEFAULT_LLM_BASEURL, DEFAULT_LLM_MODEL } from '../harness/defaults'
import { clearAll, loadJSON, saveJSON } from '../lib/storage'

export interface LLMSettings {
  /** harness 模式：mock 剧本 / api 真实模型 */
  mode: ProviderMode
  /** API 直连 baseUrl（OpenAI 兼容 /chat/completions 前缀） */
  baseUrl: string
  /** 模型 ID */
  model: string
  /** API key（仅存浏览器 LocalStorage；生产环境建议走代理） */
  apiKey: string
  /** 轻后端代理地址（非空时优先于直连，且无需 key） */
  proxyUrl: string
}

export const DEFAULT_LLM_SETTINGS: LLMSettings = {
  mode: ACTIVE_MODE,
  baseUrl: DEFAULT_LLM_BASEURL,
  model: DEFAULT_LLM_MODEL,
  apiKey: '',
  proxyUrl: '',
}

const persisted = loadJSON<Partial<LLMSettings>>('settings', {})

interface SettingsState extends LLMSettings {
  update: (patch: Partial<LLMSettings>) => void
  resetLLMSettings: () => void
  clearAllData: () => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  ...DEFAULT_LLM_SETTINGS,
  ...persisted,
  update: (patch) => {
    set(patch)
    const s = useSettingsStore.getState()
    saveJSON('settings', {
      mode: s.mode,
      baseUrl: s.baseUrl,
      model: s.model,
      apiKey: s.apiKey,
      proxyUrl: s.proxyUrl,
    })
  },
  resetLLMSettings: () => {
    set({ ...DEFAULT_LLM_SETTINGS })
    saveJSON('settings', DEFAULT_LLM_SETTINGS)
  },
  clearAllData: () => {
    clearAll()
    set({ ...DEFAULT_LLM_SETTINGS })
    window.location.reload()
  },
}))

/** key 脱敏显示：sk-****last4 */
export function maskKey(key: string): string {
  if (!key) return ''
  return `${key.slice(0, 3)}****${key.slice(-4)}`
}
