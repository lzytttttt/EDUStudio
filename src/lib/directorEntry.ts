/**
 * v1.0「总指挥模式」直达入口（预览）：
 * `?v1=1`（或 `?v1=true`）→ 跳过登录，取教师身份直接进入新首页；
 * `?tour=1` 强制重播引导，`?tour=0` 关闭引导（截图 / 回归用）。
 * 与 `?demo=1`（旧简报直达）互不干扰：v1 优先。
 */
export function isDirectorEntry(search: string): boolean {
  const value = new URLSearchParams(search).get('v1')
  return value === '1' || value === 'true'
}
