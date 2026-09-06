import { describe, expect, it } from 'vitest'
import { relativeTime } from '../lib/relativeTime'

/** 固定「现在」：2026-09-06（周日）12:00 本地时间 */
const NOW = new Date(2026, 8, 6, 12, 0).getTime()

describe('relativeTime（v0.9.2 P1-A 任务卡相对时间）', () => {
  it('今天 → 显示 HH:mm', () => {
    const ts = new Date(2026, 8, 6, 9, 30).getTime()
    expect(relativeTime(ts, NOW)).toBe('09:30')
  })

  it('未来时间（时钟回拨兜底）→ 按今天处理', () => {
    const ts = new Date(2026, 8, 6, 23, 0).getTime()
    expect(relativeTime(ts, NOW)).toBe('23:00')
  })

  it('昨天 → 「昨天 HH:mm」', () => {
    const ts = new Date(2026, 8, 5, 18, 5).getTime()
    expect(relativeTime(ts, NOW)).toBe('昨天 18:05')
  })

  it('本周早于昨天 → 星期几（2026-09-02 为周三）', () => {
    const ts = new Date(2026, 8, 2, 10, 0).getTime()
    expect(relativeTime(ts, NOW)).toBe('周三')
  })

  it('上周 → 「上周X」（2026-08-27 为周四）', () => {
    const ts = new Date(2026, 7, 27, 15, 0).getTime()
    expect(relativeTime(ts, NOW)).toBe('上周四')
  })

  it('更早（今年）→ M月D日', () => {
    const ts = new Date(2026, 6, 15, 8, 0).getTime()
    expect(relativeTime(ts, NOW)).toBe('7月15日')
  })

  it('跨年 → 带年份', () => {
    const ts = new Date(2025, 11, 31, 8, 0).getTime()
    expect(relativeTime(ts, NOW)).toBe('2025年12月31日')
  })

  it('非法时间戳 → 空串兜底', () => {
    expect(relativeTime(Number.NaN, NOW)).toBe('')
  })
})
