import { create } from 'zustand'
import type { ProviderMode, RoleId } from '../harness/types'
import { ACTIVE_MODE, DEFAULT_LLM_BASEURL, DEFAULT_LLM_MODEL } from '../harness/defaults'
import { clearAll, loadJSON, saveJSON } from '../lib/storage'
import { conceal, reveal } from '../lib/secretBox'

/** 数据源模式（v0.5 M1①）：seed 内置演示数据 / remote 远端数据平台 */
export type DataSourceMode = 'seed' | 'remote'

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
  /** 数据源模式：seed 演示 / remote 远端（v0.5 M1①） */
  dataSource: DataSourceMode
  /** 远端数据源地址（轻后端 /api/sources 前缀） */
  sourceUrl: string
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

/** 界面字号（v0.6.1 评审修订）：12–22px 连续可调（设置面板拖拽滑杆）。
 *  v0.6.1 起全局生效：main.tsx 按档位缩放根字号（html font-size = 16 × 档位/14），
 *  全部 rem 类文字（侧边栏/顶栏/底部抽屉/徽标等）随动，阅读区经 --content-fs 精确到档位值。
 *  ≥18px 视为「超大档」：并隐藏次要信息（时间戳/来源/字数等）聚焦核心内容 */
export const FONT_SIZE_MIN = 12
export const FONT_SIZE_MAX = 22
export const FONT_SIZE_DEFAULT = 14

/** 旧版四档枚举 → px 映射（v0.3 遗留持久化数据兼容） */
const LEGACY_FONT_SIZE: Record<string, number> = { small: 13, medium: 14, large: 16, xlarge: 20 }

/** 字号归一：数值 clamp 到 [12, 22]；旧版字符串档位映射为 px；非法值回退默认 */
export function normalizeFontSize(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(v)))
  }
  if (typeof v === 'string' && LEGACY_FONT_SIZE[v] !== undefined) return LEGACY_FONT_SIZE[v]
  return FONT_SIZE_DEFAULT
}

/** 导出水印设置（v0.5 M5③）：导出 Word/PDF 时在页脚附加「机构 · 人员 · 日期」水印 */
export interface WatermarkSettings {
  enabled: boolean
  org: string
  person: string
}

export const DEFAULT_WATERMARK: WatermarkSettings = { enabled: false, org: '', person: '' }

/** 单任务 token 预算（v0.5 M3③）：0 = 不限制；超出后 Agent 提前收尾 */
export const DEFAULT_TOKEN_BUDGET = 60000

/** 三栏栏宽（v0.6 M4③）：桌面工作台左/右栏可拖拽调整，持久化 */
export interface ColumnWidths {
  left: number
  right: number
}

export const DEFAULT_COLUMN_WIDTHS: ColumnWidths = { left: 320, right: 400 }
/** 栏宽约束：左栏 220–420、右栏 320–560（保证中栏最小可用宽度） */
export const COLUMN_LIMITS = { leftMin: 220, leftMax: 420, rightMin: 320, rightMax: 560 } as const

export function clampColumnWidth(side: 'left' | 'right', width: number): number {
  const { leftMin, leftMax, rightMin, rightMax } = COLUMN_LIMITS
  const min = side === 'left' ? leftMin : rightMin
  const max = side === 'left' ? leftMax : rightMax
  return Math.min(max, Math.max(min, Math.round(width)))
}

export const DEFAULT_LLM_SETTINGS: LLMSettings = {
  mode: ACTIVE_MODE,
  baseUrl: DEFAULT_LLM_BASEURL,
  model: DEFAULT_LLM_MODEL,
  apiKey: '',
  proxyUrl: '',
  dataSource: 'seed',
  sourceUrl: 'http://localhost:8787/api/sources',
}

interface PersistedSettings extends LLMSettings {
  preferences?: UserPreferences
  /** v0.6.1 起为 px 数值；历史数据为 'small'|'medium'|'large'|'xlarge' 字符串，读回时经 normalizeFontSize 迁移 */
  fontSize?: number | string
  guideSeen?: boolean
  tokenBudget?: number
  watermark?: WatermarkSettings
  columnWidths?: ColumnWidths
  /** 专注模式（v0.7）：采纳简报后台执行，批示完成后统一处理 */
  focusMode?: boolean
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
  /** 界面字号（px，12–22），全局缩放根字号 */
  fontSize: number
  /** 操作引导是否已看过（首次进入简报/工作台时展示） */
  guideSeen: boolean
  /** 单任务 token 预算（v0.5 M3③） */
  tokenBudget: number
  /** 导出水印（v0.5 M5③） */
  watermark: WatermarkSettings
  /** 三栏栏宽（v0.6 M4③） */
  columnWidths: ColumnWidths
  /** 专注模式（v0.7）：默认开启；关闭时采纳简报立即跳工作台（原行为） */
  focusMode: boolean
  update: (patch: Partial<LLMSettings> & { tokenBudget?: number }) => void
  updatePreferences: (patch: Partial<UserPreferences>) => void
  setFontSize: (px: number) => void
  setWatermark: (patch: Partial<WatermarkSettings>) => void
  setColumnWidth: (side: 'left' | 'right', width: number) => void
  setFocusMode: (enabled: boolean) => void
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
    dataSource: s.dataSource,
    sourceUrl: s.sourceUrl,
    preferences: s.preferences,
    fontSize: s.fontSize,
    guideSeen: s.guideSeen,
    tokenBudget: s.tokenBudget,
    watermark: s.watermark,
    columnWidths: s.columnWidths,
    focusMode: s.focusMode,
  })
}

export const useSettingsStore = create<SettingsState>((set) => ({
  ...DEFAULT_LLM_SETTINGS,
  ...persisted,
  preferences: { ...EMPTY_PREFERENCES, ...persisted.preferences },
  fontSize: normalizeFontSize(persisted.fontSize),
  guideSeen: persisted.guideSeen ?? false,
  tokenBudget: persisted.tokenBudget ?? DEFAULT_TOKEN_BUDGET,
  watermark: { ...DEFAULT_WATERMARK, ...persisted.watermark },
  columnWidths: {
    left: clampColumnWidth('left', persisted.columnWidths?.left ?? DEFAULT_COLUMN_WIDTHS.left),
    right: clampColumnWidth('right', persisted.columnWidths?.right ?? DEFAULT_COLUMN_WIDTHS.right),
  },
  focusMode: persisted.focusMode ?? true,
  setFocusMode: (enabled) => {
    set({ focusMode: enabled })
    persist(useSettingsStore.getState())
  },
  update: (patch) => {
    set(patch)
    persist(useSettingsStore.getState())
  },
  updatePreferences: (patch) => {
    set({ preferences: { ...useSettingsStore.getState().preferences, ...patch } })
    persist(useSettingsStore.getState())
  },
  setFontSize: (px) => {
    set({ fontSize: normalizeFontSize(px) })
    persist(useSettingsStore.getState())
  },
  setWatermark: (patch) => {
    set({ watermark: { ...useSettingsStore.getState().watermark, ...patch } })
    persist(useSettingsStore.getState())
  },
  setColumnWidth: (side, width) => {
    const cur = useSettingsStore.getState().columnWidths
    set({ columnWidths: { ...cur, [side]: clampColumnWidth(side, width) } })
    persist(useSettingsStore.getState())
  },
  markGuideSeen: () => {
    set({ guideSeen: true })
    persist(useSettingsStore.getState())
  },
  resetLLMSettings: () => {
    set({ ...DEFAULT_LLM_SETTINGS, tokenBudget: DEFAULT_TOKEN_BUDGET })
    persist(useSettingsStore.getState())
  },
  clearAllData: () => {
    clearAll()
    set({
      ...DEFAULT_LLM_SETTINGS,
      preferences: { ...EMPTY_PREFERENCES },
      fontSize: FONT_SIZE_DEFAULT,
      guideSeen: false,
      tokenBudget: DEFAULT_TOKEN_BUDGET,
      watermark: { ...DEFAULT_WATERMARK },
      columnWidths: { ...DEFAULT_COLUMN_WIDTHS },
      focusMode: true,
    })
    window.location.reload()
  },
}))

/** key 脱敏显示：sk-****last4 */
export function maskKey(key: string): string {
  if (!key) return ''
  return `${key.slice(0, 3)}****${key.slice(-4)}`
}
