/**
 * v1.2 M1/M4 · 统一壳 / 功能开关的入口判定（主 chunk 薄函数）
 *
 * 优先级（roadmap §3.9 / §5.1）：
 * 1. `?legacy=1`：强制回滚旧壳（同时作用于经典工作区与旧整屏只读）；
 * 2. `?v2=1/0`：显式开关（最高优先，演示/排障）；
 * 3. `?stage=login|briefing|workbench`：旧阶段机显式入口（旧 E2E/视觉回归专用，M4 起不再默认）；
 * 4. `?demo=1`：演示路径保持旧壳（行为不变）；
 * 5. settings.studio.flags / landing，角色默认（M4 起 teacher 默认进统一壳），构建默认。
 */
import type { RoleId } from '../harness/types'
import type { StudioSettings } from '../studio/contracts'
import { resolveFlag } from '../studio/flags'

/** M4 起默认期：teacher 无显式参数时默认进统一壳（战情台） */
export const STUDIO_DEFAULT_MODE = 'default' as const

export type LegacyStage = 'login' | 'briefing' | 'workbench' | 'command'
const LEGACY_STAGES: readonly LegacyStage[] = ['login', 'briefing', 'workbench', 'command']

function paramsOf(search: string): URLSearchParams {
  try {
    return new URLSearchParams(search)
  } catch {
    return new URLSearchParams()
  }
}

function isSwitchOn(value: string | null): boolean {
  return value === '1' || value === 'true'
}

/** `?legacy=1`：强制旧壳（回滚开关，优先于 v2） */
export function isLegacyRequested(search: string): boolean {
  return isSwitchOn(paramsOf(search).get('legacy'))
}

/** `?v2=` 显式值：1/true → true，0/false → false，其余 → null */
export function explicitStudioV2(search: string): boolean | null {
  const value = paramsOf(search).get('v2')
  if (value === '1' || value === 'true') return true
  if (value === '0' || value === 'false') return false
  return null
}

/** `?stage=` 旧阶段机显式入口（M4 起的回滚/旧 E2E 参数） */
export function requestedLegacyStage(search: string): LegacyStage | null {
  const value = paramsOf(search).get('stage')
  return LEGACY_STAGES.includes(value as LegacyStage) ? (value as LegacyStage) : null
}

/** `?demo=1`：演示路径（旧壳 + 简报直达；行为与 v1.1 一致） */
export function isDemoRequested(search: string): boolean {
  return isSwitchOn(paramsOf(search).get('demo'))
}

/**
 * 是否启用统一工作区（M4 默认期：teacher 缺省 on）。
 * 优先级：`?legacy=1` 强制 off > `?v2=` 显式 > `?stage=`/`?demo=1` 旧路径 > 设置 > 角色默认 > 构建默认。
 */
export function isStudioV2Enabled(
  search: string,
  role: RoleId | null,
  studio?: Partial<StudioSettings>,
): boolean {
  if (isLegacyRequested(search)) return false
  const explicit = explicitStudioV2(search)
  if (explicit !== null) return explicit
  if (requestedLegacyStage(search)) return false
  if (isDemoRequested(search)) return false
  return resolveFlag('studioV2', role, { search, settings: studio, defaultMode: STUDIO_DEFAULT_MODE }).value
}
