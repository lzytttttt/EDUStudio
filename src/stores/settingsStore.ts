import { create } from 'zustand'
import type { ProviderMode, RoleId } from '../harness/types'
import { ACTIVE_MODE, DEFAULT_LLM_BASEURL, DEFAULT_LLM_MODEL } from '../harness/defaults'
import { clearAll, loadJSON, saveJSON } from '../lib/storage'
import { conceal, reveal } from '../lib/secretBox'

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

/** 用户偏好画像：注入 system prompt，让 AI「记得你是谁」（v0.3 专项 ③） */
export interface UserPreferences {
  /** 称呼，如「张老师」 */
  nickname: string
  /** 学段学科背景，如「初中物理」 */
  stage: string
  /** 表达风格偏好，如「简洁务实，少用套话」 */
  style: string
  /** 自定义快捷指令（按角色覆盖默认 SCENES；空数组表示未自定义） */
  scenes: Partial<Record<RoleId, string[]>>
}

export const EMPTY_PREFERENCES: UserPreferences = { nickname: '', stage: '', style: '', scenes: {} }

/** 界面字号档位：作用于对话气泡 / Markdown 文档 / 编辑器等阅读区
 *  xlarge（超大）面向高龄用户：阅读区 20px，并隐藏次要信息（时间戳/来源/字数等）聚焦核心内容 */
export type FontSize = 'small' | 'medium' | 'large' | 'xlarge'

export const DEFAULT_LLM_SETTINGS: LLMSettings = {
  mode: ACTIVE_MODE,
  baseUrl: DEFAULT_LLM_BASEURL,
  model: DEFAULT_LLM_MODEL,
  apiKey: '',
  proxyUrl: '',
}

interface PersistedSettings extends LLMSettings {
  preferences?: UserPreferences
  fontSize?: FontSize
  guideSeen?: boolean
}

const persisted = loadJSON<Partial<PersistedSettings>>('settings', {})
/** apiKey 落盘为混淆串（v0.4 M5③），读回时还原；历史明文由 reveal 兼容 */
persisted.apiKey = reveal(persisted.apiKey ?? '')

/** 偏好字段限长（防 prompt 超长，见 v0.3-03 风险对策） */
export const PREF_MAX_LEN = 40

export function clampPref(value: string): string {
  return value.slice(0, PREF_MAX_LEN)
}

interface SettingsState extends LLMSettings {
  preferences: UserPreferences
  fontSize: FontSize
  /** 操作引导是否已看过（首次进入简报/工作台时展示） */
  guideSeen: boolean
  update: (patch: Partial<LLMSettings>) => void
  updatePreferences: (patch: Partial<UserPreferences>) => void
  setFontSize: (size: FontSize) => void
  markGuideSeen: () => void
  resetLLMSettings: () => void
  clearAllData: () => void
}

function persist(s: SettingsState): void {
  saveJSON('settings', {
    mode: s.mode,
    baseUrl: s.baseUrl,
    model: s.model,
    apiKey: conceal(s.apiKey),
    proxyUrl: s.proxyUrl,
    preferences: s.preferences,
    fontSize: s.fontSize,
    guideSeen: s.guideSeen,
  })
}

export const useSettingsStore = create<SettingsState>((set) => ({
  ...DEFAULT_LLM_SETTINGS,
  ...persisted,
  preferences: { ...EMPTY_PREFERENCES, ...persisted.preferences },
  fontSize: persisted.fontSize ?? 'medium',
  guideSeen: persisted.guideSeen ?? false,
  update: (patch) => {
    set(patch)
    persist(useSettingsStore.getState())
  },
  updatePreferences: (patch) => {
    set({ preferences: { ...useSettingsStore.getState().preferences, ...patch } })
    persist(useSettingsStore.getState())
  },
  setFontSize: (size) => {
    set({ fontSize: size })
    persist(useSettingsStore.getState())
  },
  markGuideSeen: () => {
    set({ guideSeen: true })
    persist(useSettingsStore.getState())
  },
  resetLLMSettings: () => {
    set({ ...DEFAULT_LLM_SETTINGS })
    persist(useSettingsStore.getState())
  },
  clearAllData: () => {
    clearAll()
    set({ ...DEFAULT_LLM_SETTINGS, preferences: { ...EMPTY_PREFERENCES }, fontSize: 'medium', guideSeen: false })
    window.location.reload()
  },
}))

/** key 脱敏显示：sk-****last4 */
export function maskKey(key: string): string {
  if (!key) return ''
  return `${key.slice(0, 3)}****${key.slice(-4)}`
}
