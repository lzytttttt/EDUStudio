/**
 * v1.2 M1 · 统一壳 / 功能开关的入口判定（主 chunk 薄函数）
 *
 * 只读 URL 与角色：`?v2=1` 进统一壳（影子期），`?legacy=1` 强制回滚到旧壳；
 * 具体每个能力开关由 `src/studio/flags.ts` 的 resolveFlag 解析（M2 接 settings.studio）。
 */
import type { RoleId } from '../harness/types'
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

/** 是否启用统一工作区（`?v2=1` 且未要求回滚；影子期角色默认 off） */
export function isStudioV2Enabled(search: string, role: RoleId | null): boolean {
  if (isLegacyRequested(search)) return false
  return resolveFlag('studioV2', role, { search, defaultMode: 'shadow' }).value
}
