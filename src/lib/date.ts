/**
 * 演示日期实时化（v0.9.3 P0-C）
 *
 * 简报头日期与公文落款统一走本地实时日期，避免演示日显示陈旧硬编码。
 * 纯函数，可注入 now 便于单测固化。
 */

/** 中文年月日：2026 年 9 月 10 日（简报头） */
export function formatCnDate(now: number = Date.now()): string {
  const d = new Date(now)
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

/** 中文年月：2026 年 9 月（公文落款） */
export function formatCnYearMonth(now: number = Date.now()): string {
  const d = new Date(now)
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`
}
