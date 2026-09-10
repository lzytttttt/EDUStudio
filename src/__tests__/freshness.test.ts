import { describe, expect, it } from 'vitest'
import { STALE_AFTER_MS, isStale, seedBaseline, seedMeta } from '../harness/sources'
import { formatCnDate, formatCnYearMonth } from '../lib/date'

/** 固定「现在」：2026-09-10 12:00 本地时间 */
const NOW = new Date(2026, 8, 10, 12, 0).getTime()
const DAY = 24 * 3600 * 1000

describe('seed 新鲜度（v0.9.3 P0-C：基线「今天 − 1 天」）', () => {
  it('seedBaseline 固定 now → 恰好一天前', () => {
    expect(seedBaseline(NOW)).toBe(NOW - DAY)
  })

  it('seedMeta 固定 now → fetchedAt 一天前、kind/label 不变', () => {
    const meta = seedMeta('演示数据', NOW)
    expect(meta.fetchedAt).toBe(NOW - DAY)
    expect(meta.kind).toBe('seed')
    expect(meta.label).toBe('演示数据')
  })

  it('seed 模式默认不再「建议刷新」：固定 now 下 isStale=false', () => {
    expect(isStale(seedMeta('演示数据', NOW), STALE_AFTER_MS, NOW)).toBe(false)
  })

  it('isStale 往返：7 天边界内不告警，超过告警（remote 旧数据仍提示）', () => {
    const remoteOld = { fetchedAt: NOW - 8 * DAY, kind: 'remote' as const, label: '区域数据平台' }
    const remoteFresh = { fetchedAt: NOW - 3 * DAY, kind: 'remote' as const, label: '区域数据平台' }
    expect(isStale(remoteOld, STALE_AFTER_MS, NOW)).toBe(true)
    expect(isStale(remoteFresh, STALE_AFTER_MS, NOW)).toBe(false)
    // 恰满 7 天不算过期（严格大于）
    expect(isStale({ fetchedAt: NOW - 7 * DAY, kind: 'csv' as const, label: '本地导入' }, STALE_AFTER_MS, NOW)).toBe(false)
    expect(isStale(null, STALE_AFTER_MS, NOW)).toBe(false)
  })
})

describe('日期格式化（v0.9.3 P0-C）', () => {
  it('formatCnDate → 本地化年月日', () => {
    expect(formatCnDate(new Date(2026, 8, 10, 9, 0).getTime())).toBe('2026 年 9 月 10 日')
    expect(formatCnDate(new Date(2026, 11, 31, 23, 59).getTime())).toBe('2026 年 12 月 31 日')
  })

  it('formatCnYearMonth → 公文落款年月', () => {
    expect(formatCnYearMonth(new Date(2026, 8, 10).getTime())).toBe('2026 年 9 月')
  })
})
