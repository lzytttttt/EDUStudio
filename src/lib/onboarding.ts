/**
 * v1.2 M4 · 两段式引导合并（roadmap §5.2「引导设计（合并两套）」/ §5.3 / §7.2）
 *
 * 背景：v1.1 有三套「看过没」的口径 —— Director 自己的 guideSeen（`edustudio:director`）、
 * 经典工作台 GuideDialog 的 settings.guideSeen、以及 M2 起预留的 `settings.studio.onboarded`。
 * M4 起统一为**一个事实源**：`settings.studio.onboarding: OnboardingProgress`，
 * `settings.studio.onboarded` 只是它派生出的布尔（directorSeen && classicSeen），
 * 旧的两套只作**首次加载迁移来源**保留一个版本（`migrateLegacyOnboarding`）。
 *
 * 本文件是纯函数（唯一例外是文件末尾「页面加载参数锁存」，只读 window.location，不做 IO），
 * 供 main chunk（settingsShell / AppShell / SettingsDialog）与 Director chunk（CommandCenter）
 * 共用 —— 两侧只共享契约、不共享视图实现。
 *
 * 状态机（roadmap §5.2）：not-seen → director（总指挥 3 步）→ classic（经典 3 步）→ done。
 */

/** 引导进度（持久化在 settings.studio.onboarding；旧数据无此字段） */
export interface OnboardingProgress {
  /** 总指挥工作区 3 步引导（GuideBar）是否已看过 */
  directorSeen: boolean
  /** 经典工作区操作说明（GuideDialog）是否已看过 */
  classicSeen: boolean
  /** 「新增：总指挥工作区」升级提示条是否已关闭（只看过一次，不重复打扰） */
  noticeSeen: boolean
}

/**
 * 已走到的引导阶段（「完成了哪一段」）：
 * - not-seen：两段都没看过（全新用户）
 * - director：总指挥段已完成、经典段未完成（下一步去经典）
 * - classic：只有经典段完成（老用户迁移；下一步补总指挥）
 * - done：两段都完成
 */
export type OnboardingStage = 'not-seen' | 'director' | 'classic' | 'done'

/** 还需要补的引导站点 */
export type OnboardingStation = 'director' | 'classic'

/** `?tour` 语义：0 关闭 / 1 强制重看 / 缺省按进度自动 */
export type TourMode = 'off' | 'force' | 'auto'

/** 空进度（不改原对象；调用方需要新对象时用 mergeOnboarding 复制） */
export const EMPTY_ONBOARDING: OnboardingProgress = {
  directorSeen: false,
  classicSeen: false,
  noticeSeen: false,
}

const ONBOARDING_KEYS = ['directorSeen', 'classicSeen', 'noticeSeen'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 归一 + 局部合并：
 * - `base` 为任意坏值（null / 字符串 / 数组 / 缺字段）时一律按 false，不抛错、不白屏；
 * - 只有**严格的 true / false** 才生效（'yes' / 1 / 'true' 都不算，避免脏数据误判已读）；
 * - `patch` 是局部更新：显式 `false` 可以把已读位复位（设置页「重看引导」），缺省字段保留 base。
 */
export function mergeOnboarding(base: unknown, patch?: unknown): OnboardingProgress {
  const baseRecord = isRecord(base) ? base : {}
  const patchRecord = isRecord(patch) ? patch : {}
  const next: OnboardingProgress = { directorSeen: false, classicSeen: false, noticeSeen: false }
  for (const key of ONBOARDING_KEYS) {
    const patched = patchRecord[key]
    next[key] = typeof patched === 'boolean' ? patched : baseRecord[key] === true
  }
  return next
}

/** `settings.studio.onboarded` 的唯一派生口径（不要在任何地方手写这个布尔） */
export function isOnboarded(progress: OnboardingProgress): boolean {
  return progress.directorSeen && progress.classicSeen
}

/** 当前阶段（见 OnboardingStage 注释） */
export function onboardingStage(progress: OnboardingProgress): OnboardingStage {
  if (progress.directorSeen && progress.classicSeen) return 'done'
  if (progress.directorSeen) return 'director'
  if (progress.classicSeen) return 'classic'
  return 'not-seen'
}

/** 下一站：总指挥优先（老用户只有经典已读时也先补总指挥） */
export function nextStep(progress: OnboardingProgress): OnboardingStation | null {
  if (!progress.directorSeen) return 'director'
  if (!progress.classicSeen) return 'classic'
  return null
}

/** 老用户升级提示：有 M4 之前遗留数据、且没关闭过提示（「只在首次登录 + 版本升级各一次」打扰预算） */
export function shouldShowUpgradeNotice(progress: OnboardingProgress, hasLegacyData: boolean): boolean {
  return hasLegacyData === true && progress.noticeSeen !== true
}

export interface LegacyOnboardingInput {
  /** 已经存在的 M4 onboarding（有则以它为准，绝不拿旧 guideSeen 覆盖用户在新版里的进度） */
  current?: unknown
  /** 旧 settings.guideSeen（经典工作台 GuideDialog 已读位） */
  settingsGuideSeen?: unknown
  /** `edustudio:director` 键里的 guideSeen（Director 引导已读位） */
  directorGuideSeen?: unknown
}

/**
 * 首次加载迁移（纯函数）：
 * - 已有 `current.onboarding` 对象 → 只做坏值归一（M4 之后写入的数据永远优先，保证「清空工作区数据」后
 *   不会在下次启动被 `settings.guideSeen=true` 再次误判成已引导）；
 * - 否则：旧 settings.guideSeen=true → classicSeen；director 键 guideSeen=true → directorSeen；noticeSeen=false。
 */
export function migrateLegacyOnboarding(input: LegacyOnboardingInput): OnboardingProgress {
  if (isRecord(input.current)) return mergeOnboarding(input.current)
  return {
    directorSeen: input.directorGuideSeen === true,
    classicSeen: input.settingsGuideSeen === true,
    noticeSeen: false,
  }
}

function isSwitchOn(raw: string | null): boolean {
  return raw === '1' || raw === 'true'
}

/** `?tour` 解析（纯函数，便于单测）：只有显式 0/false 关闭、1/true 强制，其余自动 */
export function resolveTourMode(search: string): TourMode {
  let raw: string | null = null
  try {
    raw = new URLSearchParams(search).get('tour')
  } catch {
    raw = null
  }
  if (raw === '0' || raw === 'false') return 'off'
  if (raw === '1' || raw === 'true') return 'force'
  return 'auto'
}

/** `?demo=1`（演示入口跳过引导，roadmap §5.2「演示模式跳过引导」） */
export function resolveDemoEntry(search: string): boolean {
  try {
    return isSwitchOn(new URLSearchParams(search).get('demo'))
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ */
/* 页面加载参数锁存（唯一读 window 的地方，模块加载时取一次）            */
/* ------------------------------------------------------------------ */

/**
 * 统一壳切换工作区会把 URL 规范化（经典工作区写 `/`，查询参数被丢掉），
 * 若组件在每次挂载时重新读 URL，`?tour=0`（截图 / 回归）会在往返后退化成「自动开引导」。
 * 因此这里在模块**加载时**锁存一次进入页面的查询串，所有引导/演示语义都以它为准。
 */
const PAGE_LOAD_SEARCH = typeof window === 'undefined' ? '' : window.location.search

/** 进入页面时的 `?tour` 语义（AppShell / CommandCenter 共用同一口径） */
export function tourModeAtLoad(): TourMode {
  return resolveTourMode(PAGE_LOAD_SEARCH)
}

/** 进入页面时是否 `?demo=1`（演示入口不插播引导） */
export function demoAtLoad(): boolean {
  return resolveDemoEntry(PAGE_LOAD_SEARCH)
}
