import { create } from 'zustand'
import type { ProviderMode, RoleId } from '../harness/types'
import type { StudioDigest, StudioSettings } from '../studio/contracts'
import {
  EMPTY_ONBOARDING,
  isOnboarded,
  migrateLegacyOnboarding,
  mergeOnboarding,
  type OnboardingProgress,
} from '../lib/onboarding'
import {
  ACTIVE_MODE,
  DEFAULT_LLM_BASEURL,
  DEFAULT_LLM_MODEL,
  DEFAULT_PROXY_URL,
  DEFAULT_SOURCE_URL,
} from '../harness/defaults'
import { clearAll, loadJSON, saveJSON } from '../lib/storage'
import { createDebouncedWriter } from '../lib/debouncedWrite'
import { conceal, reveal } from '../lib/secretBox'

/**
 * v1.2 M4：settings.studio 的本地扩展形状。
 *
 * 契约文件 `src/studio/contracts.ts` 的 `StudioSettings` 保持不变（M4-A 写入范围不含 contracts），
 * 这里用「可选增量」扩展：`onboarding` 是新增可选字段，旧数据没有它 → 读回归一 / 首次迁移补齐；
 * 其余字段与契约逐字一致，`StudioSettings` 的消费方（entryPlan / flags）无需改动。
 */
export interface StudioSettingsState extends StudioSettings {
  /** 两段式引导进度（M4 唯一事实源；`onboarded` 由它派生） */
  onboarding?: OnboardingProgress
}

/** v1.2 M2：工作区设置默认值（landing/execution 为 auto 时沿用角色默认；onboarded 为引导唯一已读位） */
export const DEFAULT_STUDIO_SETTINGS: StudioSettingsState = {
  landing: 'auto',
  execution: 'auto',
  onboarded: false,
  onboarding: { ...EMPTY_ONBOARDING },
  digest: {
    pendingDecisions: 0,
    runningMissions: 0,
    runningTasks: 0,
    unreadDocs: 0,
    unreadNotices: 0,
    updatedAt: 0,
  },
}

/** 工作区设置读回归一（损坏/旧值不白屏；字段缺省回落默认；onboarding 逐字段归一） */
export function normalizeStudioSettings(raw: unknown): StudioSettingsState {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<StudioSettingsState>
  const landing = src.landing
  const execution = src.execution
  const digest = (src.digest && typeof src.digest === 'object' ? src.digest : {}) as Partial<StudioDigest>
  return {
    landing: landing === 'inbox' || landing === 'briefing' || landing === 'workbench' ? landing : 'auto',
    execution: execution === 'real' || execution === 'mock' ? execution : 'auto',
    onboarded: src.onboarded === true,
    /* 坏值/缺省一律按全 false 归一；显式传 onboarding: undefined 也回到空进度（清空工作区数据用） */
    onboarding: mergeOnboarding(src.onboarding),
    digest: {
      pendingDecisions: Number.isFinite(digest.pendingDecisions) ? Number(digest.pendingDecisions) : 0,
      runningMissions: Number.isFinite(digest.runningMissions) ? Number(digest.runningMissions) : 0,
      runningTasks: Number.isFinite(digest.runningTasks) ? Number(digest.runningTasks) : 0,
      unreadDocs: Number.isFinite(digest.unreadDocs) ? Number(digest.unreadDocs) : 0,
      unreadNotices: Number.isFinite(digest.unreadNotices) ? Number(digest.unreadNotices) : 0,
      ...(digest.activeMission ? { activeMission: digest.activeMission } : {}),
      ...(digest.team ? { team: digest.team } : {}),
      updatedAt: Number.isFinite(digest.updatedAt) ? Number(digest.updatedAt) : 0,
    },
    ...(src.flags && typeof src.flags === 'object' ? { flags: src.flags } : {}),
  }
}

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
  proxyUrl: DEFAULT_PROXY_URL,
  dataSource: 'seed',
  sourceUrl: DEFAULT_SOURCE_URL,
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
  /** 显示技术细节（v0.9.2 P0-A）：开启后执行轨迹展示 JSON 返回数据入口（默认关，业务化文案不受影响） */
  showTechDetails?: boolean
  /** v1.2 M2：工作区设置（landing / execution / onboarded / digest；缺省 = 旧行为） */
  studio?: StudioSettingsState
}

const persisted = loadJSON<Partial<PersistedSettings>>('settings', {})
/** apiKey 落盘为混淆串（v0.4 M5③），读回时还原；历史明文由 reveal 兼容 */
persisted.apiKey = reveal(persisted.apiKey ?? '')

/* ------------------------------------------------------------------ */
/* v1.2 M4 · 首次加载的引导迁移（§5.2 / §5.3）                            */
/* ------------------------------------------------------------------ */

/**
 * 旧数据来源（只读原始键，**不 import directorStore**，避免把 Director 实现拉进主 chunk）：
 * - `edustudio:director` 键（schemaVersion 任意）里的 guideSeen → directorSeen；
 * - 旧 `settings.guideSeen` → classicSeen；
 * - 两者都缺 → 空进度；已有 `studio.onboarding` → 以它为准（见 migrateLegacyOnboarding）。
 */
const legacyDirectorRaw = loadJSON<unknown>('director', null)
const legacyDirectorGuideSeen =
  !!legacyDirectorRaw &&
  typeof legacyDirectorRaw === 'object' &&
  (legacyDirectorRaw as { guideSeen?: unknown }).guideSeen === true

/** 首次迁移前的归一结果（onboarding 缺省 = 尚未迁移，需要按旧 guideSeen 推导） */
const BASE_STUDIO = normalizeStudioSettings(persisted.studio)
const MIGRATED_ONBOARDING = migrateLegacyOnboarding({
  current: (persisted.studio as StudioSettingsState | undefined)?.onboarding,
  settingsGuideSeen: persisted.guideSeen,
  directorGuideSeen: legacyDirectorGuideSeen,
})
/** 迁移后的唯一事实源布尔：onboarded = directorSeen && classicSeen（派生，不手写） */
const MIGRATED_ONBOARDED = isOnboarded(MIGRATED_ONBOARDING)
const INITIAL_STUDIO: StudioSettingsState = {
  ...BASE_STUDIO,
  onboarded: MIGRATED_ONBOARDED,
  onboarding: MIGRATED_ONBOARDING,
}

/**
 * 升级提示的「老用户」判定：M4 之前就有数据、且还没有 M4 的 onboarding 字段。
 * 在模块加载时算一次（不持久化）：
 * - 新用户首会话：没有 director 键、guideSeen=false → false；
 * - 新用户第二会话：settings 里已有 onboarding（任何一次持久化都会带上）→ false（不会误弹升级提示）；
 * - M1–M3 老用户：有 director 键或旧 guideSeen、且没有 onboarding → true（弹一次，关闭即 noticeSeen）。
 * 只认「对象」：`onboarding: null` 等坏值视作未迁移（与 migrateLegacyOnboarding 的归一一致）。
 */
const HAS_PERSISTED_ONBOARDING =
  !!persisted.studio && !!persisted.studio.onboarding && typeof persisted.studio.onboarding === 'object'
const STUDIO_ONBOARDING_LEGACY_USER =
  !HAS_PERSISTED_ONBOARDING && (legacyDirectorRaw != null || persisted.guideSeen === true)

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
  /** 显示技术细节（v0.9.2 P0-A）：默认关；开启后执行轨迹展示「查看返回数据」JSON 入口 */
  showTechDetails: boolean
  /** v1.2 M2：工作区设置（启动页 / 默认执行模式 / 唯一引导已读位 / 主 chunk 只读投影 digest） */
  studio: StudioSettingsState
  /**
   * v1.2 M4：是否为「M4 之前就有数据」的老用户（模块加载时算一次，不持久化）。
   * 只用于升级提示条（`!noticeSeen && 老用户` → 显示一次）；新用户第二会话不会误判。
   */
  onboardingLegacyUser: boolean
  update: (patch: Partial<LLMSettings> & { tokenBudget?: number }) => void
  /** 工作区设置局部更新（设置页「工作区」分组 / M4 默认切换用） */
  updateStudio: (patch: Partial<StudioSettingsState>) => void
  /**
   * v1.2 M4：更新两段式引导进度（局部；显式 false 可复位）。
   * `studio.onboarded` 由 merge 结果派生（directorSeen && classicSeen），是唯一写入口。
   */
  updateOnboarding: (patch: Partial<OnboardingProgress>) => void
  /** v1.2 M4：设置页「启动页」便捷 action（等价 updateStudio({ landing })） */
  setStudioLanding: (landing: StudioSettings['landing']) => void
  /** 只读投影写回（studioDigestStore 300ms 合并调用；不触发额外的业务副作用） */
  updateStudioDigest: (digest: StudioDigest) => void
  /** v1.2 M2：重看操作引导（清旧 guideSeen + 工作区两段引导进度；Director 自身引导用 ?tour=1） */
  resetStudioGuide: () => void
  updatePreferences: (patch: Partial<UserPreferences>) => void
  setFontSize: (px: number) => void
  setWatermark: (patch: Partial<WatermarkSettings>) => void
  setColumnWidth: (side: 'left' | 'right', width: number) => void
  setFocusMode: (enabled: boolean) => void
  setShowTechDetails: (enabled: boolean) => void
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
    showTechDetails: s.showTechDetails,
    studio: s.studio,
  })
}

/**
 * 合并写盘（v0.9.3 P2-A②）：字号滑杆 / 栏宽拖拽逐帧触发，
 * 300ms trailing 窗口内的连续变更只落盘一次；拖拽结束 / 页面隐藏时强制 flush。
 */
const persistSoon = createDebouncedWriter(() => persist(useSettingsStore.getState()))

/** 立即写出待处理变更（Resizer 拖拽结束、main.tsx 在 visibilitychange / pagehide 兜底调用） */
export function flushSettingsPersist(): void {
  persistSoon.flush()
}

/** 立即全量落盘并撤销待合并写入（本节点已把最新 state 完整写出，避免窗口到期后重复写） */
function persistNow(): void {
  persistSoon.cancel()
  persist(useSettingsStore.getState())
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
  showTechDetails: persisted.showTechDetails ?? false,
  /* v1.2 M4：迁移结果（onboarded 由 onboarding 派生；旧 guideSeen 只作迁移来源） */
  studio: INITIAL_STUDIO,
  onboardingLegacyUser: STUDIO_ONBOARDING_LEGACY_USER,
  setFocusMode: (enabled) => {
    set({ focusMode: enabled })
    persistNow()
  },
  updateStudio: (patch) => {
    set({ studio: normalizeStudioSettings({ ...useSettingsStore.getState().studio, ...patch }) })
    persistNow()
  },
  updateOnboarding: (patch) => {
    const current = useSettingsStore.getState().studio
    const onboarding = mergeOnboarding(current.onboarding, patch)
    set({
      studio: {
        ...current,
        onboarding,
        /* 唯一派生口径：两段都完成才算 onboarded（不手写、不从别处读） */
        onboarded: isOnboarded(onboarding),
      },
    })
    persistNow()
  },
  setStudioLanding: (landing) => {
    set({ studio: normalizeStudioSettings({ ...useSettingsStore.getState().studio, landing }) })
    persistNow()
  },
  updateStudioDigest: (digest) => {
    /* digest 由 StudioBus 事件高频更新：合并写盘，随 settings 的 visibilitychange flush 落盘 */
    set({ studio: { ...useSettingsStore.getState().studio, digest } })
    persistSoon.schedule()
  },
  resetStudioGuide: () => {
    /* 重看引导：复位两段引导进度（保留 noticeSeen —— 升级提示不是引导，不重复打扰），
       guideSeen 同步清掉，兼容旧的 BriefingPage / AppShell 首次展示逻辑。 */
    const current = useSettingsStore.getState().studio
    const onboarding = mergeOnboarding(current.onboarding, { directorSeen: false, classicSeen: false })
    set({
      guideSeen: false,
      studio: { ...current, onboarding, onboarded: isOnboarded(onboarding) },
    })
    persistNow()
  },
  setShowTechDetails: (enabled) => {
    set({ showTechDetails: enabled })
    persistNow()
  },
  update: (patch) => {
    set(patch)
    persistNow()
  },
  updatePreferences: (patch) => {
    set({ preferences: { ...useSettingsStore.getState().preferences, ...patch } })
    persistNow()
  },
  /* 字号滑杆连续触发：合并写盘（v0.9.3 P2-A②） */
  setFontSize: (px) => {
    set({ fontSize: normalizeFontSize(px) })
    persistSoon.schedule()
  },
  setWatermark: (patch) => {
    set({ watermark: { ...useSettingsStore.getState().watermark, ...patch } })
    persistNow()
  },
  /* 栏宽拖拽逐帧触发：合并写盘，拖拽结束由 Resizer onEnd 强制 flush（v0.9.3 P2-A②） */
  setColumnWidth: (side, width) => {
    const cur = useSettingsStore.getState().columnWidths
    set({ columnWidths: { ...cur, [side]: clampColumnWidth(side, width) } })
    persistSoon.schedule()
  },
  markGuideSeen: () => {
    set({ guideSeen: true })
    persistNow()
  },
  resetLLMSettings: () => {
    set({ ...DEFAULT_LLM_SETTINGS, tokenBudget: DEFAULT_TOKEN_BUDGET })
    persistNow()
  },
  clearAllData: () => {
    /* 清库前撤销待合并写入，避免窗口到期把旧值写回（v0.9.3 P2-A②） */
    persistSoon.cancel()
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
      showTechDetails: false,
      studio: normalizeStudioSettings(DEFAULT_STUDIO_SETTINGS),
    })
    window.location.reload()
  },
}))

/**
 * v1.2 M4 迁移收尾：只在 `onboarded` 事实位真正变化时补一次写盘。
 * 目的是「旧用户升级后立刻落库」，同时避免每次启动都因为迁移推导而多写一次 settings
 * （onboarding 的推导是纯函数、幂等；未变化时不写也不会丢信息）。
 */
if (MIGRATED_ONBOARDED !== BASE_STUDIO.onboarded) persistNow()

/** key 脱敏显示：sk-****last4 */
export function maskKey(key: string): string {
  if (!key) return ''
  return `${key.slice(0, 3)}****${key.slice(-4)}`
}
