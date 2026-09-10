/**
 * 演示直达入口判定（v0.9.3 P1-B②）：
 * URL 带 `?demo=1`（或 `?demo=true`）时跳过引导、直达今日简报；
 * 未登录则自动以教师身份进入，供展会演示与 E2E 复用同一条路径。
 */
export function isDemoEntry(search: string): boolean {
  const value = new URLSearchParams(search).get('demo')
  return value === '1' || value === 'true'
}
