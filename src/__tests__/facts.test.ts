import { describe, expect, it } from 'vitest'
import { FACT_AS_OF, formatFactDate, freezeFacts, freezeFactsFromSource } from '../harness/director/facts'
import type { Fact } from '../harness/director/types'
import { CLASS_LEARNING } from '../data/seed'
import { seedMeta } from '../harness/sources'

/* 事实快照（v1.1 P0-3）：数字口径、确定性、派生标注、降级如实写、SourceProvider 桥接 */

const VALUE_TABLE: { key: string; value: number; unit: string }[] = [
  { key: 'physics.avg', value: 82.4, unit: '分' },
  { key: 'math.avg', value: 78.6, unit: '分' },
  { key: 'chem.avg', value: 80.2, unit: '分' },
  { key: 'physics.trend', value: 2.1, unit: '百分点' },
  { key: 'math.trend', value: -1.4, unit: '百分点' },
  { key: 'chem.trend', value: 0.8, unit: '百分点' },
  { key: 'homework.completion', value: 93, unit: '%' },
  { key: 'class.attention', value: 86, unit: '%' },
  { key: 'weak.mastery', value: 61, unit: '%' },
  { key: 'class.three-subject-avg', value: 80.4, unit: '分' },
]

function byKey(facts: Fact[], key: string): Fact {
  const f = facts.find((x) => x.key === key)
  if (!f) throw new Error(`缺少事实 ${key}`)
  return f
}

describe('freezeFacts · seed 快照', () => {
  it('无参调用冻结 10 条事实（9 基础 + 1 派生）且口径与 seed 一致', () => {
    const facts = freezeFacts()
    expect(facts).toHaveLength(10)
    expect(facts.filter((f) => f.derived)).toHaveLength(1)
    /* factId 唯一、可持久化 */
    expect(new Set(facts.map((f) => f.factId)).size).toBe(10)
    expect(new Set(facts.map((f) => f.key)).size).toBe(10)

    for (const row of VALUE_TABLE) {
      const f = byKey(facts, row.key)
      expect(f.value, row.key).toBe(row.value)
      expect(f.unit, row.key).toBe(row.unit)
      expect(f.value).toBeTypeOf('number')
      expect(Number.isFinite(f.value)).toBe(true)
    }
  })

  it('派生三科均分 80.4 标 derived=true，其余事实不标派生', () => {
    const facts = freezeFacts()
    const derived = byKey(facts, 'class.three-subject-avg')
    expect(derived.derived).toBe(true)
    expect(derived.value).toBe(80.4)
    expect(derived.label).toContain('派生')
    /* (82.4 + 78.6 + 80.2) / 3 = 80.4 */
    const avg = (82.4 + 78.6 + 80.2) / 3
    expect(derived.value).toBeCloseTo(avg, 10)
    for (const f of facts.filter((x) => x.key !== 'class.three-subject-avg')) {
      expect(f.derived, f.key).not.toBe(true)
    }
  })

  it('每条第来源/时点/中文标签，且 asOf 固定可复现', () => {
    const facts = freezeFacts()
    for (const f of facts) {
      expect(f.source).toContain('高一（3）班')
      expect(f.source).toContain('单元考')
      expect(f.asOf).toBe(FACT_AS_OF)
      expect(f.label.length).toBeGreaterThan(0)
      expect(f.factId).toMatch(/^f-/)
    }
    expect(byKey(facts, 'physics.avg').label).toBe('物理均分')
    expect(byKey(facts, 'homework.completion').label).toBe('作业完成率')
    expect(byKey(facts, 'class.attention').label).toBe('课堂专注度')
    expect(byKey(facts, 'weak.mastery').label).toContain('掌握率')
  })

  it('纯函数：同参多次调用深相等、返回新数组，外部修改不影响后续快照', () => {
    const first = freezeFacts()
    const second = freezeFacts()
    expect(second).toEqual(first)
    expect(second).not.toBe(first)
    first[0].value = -1
    expect(freezeFacts()[0].value).toBe(82.4)
  })
})

describe('freezeFacts · 数据源边界', () => {
  it('meta.degraded 如实写进来源文案；正常 seed 不出现降级标注', () => {
    const degraded = freezeFacts({ meta: { ...seedMeta(), degraded: true } })
    expect(degraded).toHaveLength(10)
    for (const f of degraded) expect(f.source).toContain('服务不可用')
    const normal = freezeFacts({ meta: seedMeta() })
    for (const f of normal) expect(f.source).not.toContain('服务不可用')
  })

  it('CSV/远端来源如实写 label，asOf 由 fetchedAt 派生', () => {
    const fetchedAt = new Date(2026, 10, 6, 12, 0, 0).getTime()
    const facts = freezeFacts({
      profile: CLASS_LEARNING[1],
      meta: { fetchedAt, kind: 'csv', label: '本地导入 · 月考.csv' },
    })
    expect(facts[0].source).toContain('本地导入 · 月考.csv')
    expect(facts[0].source).toContain('高一（7）班')
    expect(facts[0].asOf).toBe('2026-11-06')
    expect(byKey(facts, 'physics.avg').value).toBe(74.1)
  })

  it('换班级 fork 快照：值随 SourceProvider 数据走，不写死 seed 数字', () => {
    const facts = freezeFacts({ profile: CLASS_LEARNING[1] })
    expect(byKey(facts, 'physics.avg').value).toBe(74.1)
    expect(byKey(facts, 'math.avg').value).toBe(76.8)
    expect(byKey(facts, 'class.three-subject-avg').value).toBe(76.8)
  })

  it('profile 为空 → 空快照；不足 2 科不派生', () => {
    expect(freezeFacts({ profile: null })).toEqual([])
    const oneSubject = { ...CLASS_LEARNING[0], scores: CLASS_LEARNING[0].scores.slice(0, 1) }
    const facts = freezeFacts({ profile: oneSubject })
    expect(facts.some((f) => f.derived)).toBe(false)
  })

  it('freezeFactsFromSource 桥接 SourceProvider 结果', () => {
    const facts = freezeFactsFromSource({ profile: CLASS_LEARNING[0], meta: seedMeta() })
    expect(facts).toHaveLength(10)
    expect(freezeFactsFromSource({ profile: null, meta: seedMeta() })).toEqual([])
  })
})

describe('formatFactDate', () => {
  it('本地时区 YYYY-MM-DD', () => {
    expect(formatFactDate(new Date(2026, 10, 6).getTime())).toBe('2026-11-06')
    expect(formatFactDate(new Date(2026, 0, 1).getTime())).toBe('2026-01-01')
  })
})
