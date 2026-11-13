/**
 * v1.2 M1 · 统一壳 / 功能开关的入口判定（主 chunk 薄函数）
 *
 * 只读 URL 与角色：`?v2=1` 进统一壳（影子期），`?legacy=1` 强制回滚到旧壳；
 * 具体每个能力开关由 `src/studio/flags.ts` 的 resolveFlag 解析（M2 接 settings.studio）。
 */
import type { RoleId } from '../harness/types'
import type { StudioSettings } from '../studio/contracts'
import { resolveFlag } from '../studio/flags'

function isSwitchOn(value: string | null): boolean {
  return value === '1' || value === 'true'
}

/** `?legacy=1`：强制旧壳（回滚开关，优先于 v2） */
export function isLegacyRequested(search: string): boolean {
  try {
    return isSwitchOn(new URLSearchParams(search).get('legacy'))
  } catch {
    return false
  }
}

/**
 * 是否启用统一工作区（影子期默认 off）。
 * 优先级（roadmap §3.9）：URL `?v2=1/0` > settings.studio（启动页/内部灰度 flags）> 角色默认 > 构建默认；
 * `?legacy=1` 强制旧壳（回滚优先于一切）。
 */
export function isStudioV2Enabled(
  search: string,
  role: RoleId | null,
  studio?: Partial<StudioSettings>,
): boolean {
  if (isLegacyRequested(search)) return false
  return resolveFlag('studioV2', role, { search, settings: studio, defaultMode: 'shadow' }).value
}
