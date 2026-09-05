import { describe, expect, it } from 'vitest'
import {
  DATA_CONTEXT_MAX_CHARS,
  buildDataContext,
  formatClassProfile,
  formatDataContext,
  formatRegionMetrics,
  formatSchoolOverview,
} from '../harness/sources/dataContext'
import { seedMeta } from '../harness/sources'
import type { ClassLearning, RegionMetric, SchoolAlert, SchoolTrendPoint } from '../data/seed'

/* 数据上下文层 v0.8 M1：角色分支格式化、截断护栏、异步聚合容错 */

const profile: ClassLearning = {
  classId: 'c1',
  className: '高一(2)班',
  scores: [{ subject: '语文', avg: 82.5, passRate: 0.91, excellenceRate: 0.35, trend: 1.2 }],
  homeworkCompletion: 0.86,
  attentionIndex: 78,
  weakPoints: ['文言文阅读', '二次函数'],
}

const trend: SchoolTrendPoint[] = [
  { week: '第1周', avgScore: 76.2, homework: 0.82, attention: 74 },
  { week: '第2周', avgScore: 77.1, homework: 0.84, attention: 75 },
]
const alerts: SchoolAlert[] = [
  { level: 'high', title: '数学连续两周下滑', detail: '均分环比 -3.5', className: '高二(3)班' },
]

const metrics: RegionMetric[] = [
  { name: '区域平均分', value: '76.5', trend: 0.8, note: '稳中有升', history: [75, 75.5, 76, 76.5] },
]

describe('formatClassProfile', () => {
  it('输出班级/各科/作业/薄弱点与来源标注', () => {
    const text = formatClassProfile({ profile, meta: seedMeta() })
    expect(text).toContain('高一(2)班')
    expect(text).toContain('语文 均分82.5')
    expect(text).toContain('作业完成率：86%')
    expect(text).toContain('文言文阅读')
    expect(text).toContain('演示数据')
  })
  it('profile 为空 → 暂无数据', () => {
    expect(formatClassProfile({ profile: null, meta: seedMeta() })).toContain('暂无')
  })
})

describe('formatSchoolOverview / formatRegionMetrics', () => {
  it('趋势取最近 4 期，预警带级别标注', () => {
    const text = formatSchoolOverview({ trend, alerts, meta: seedMeta() })
    expect(text).toContain('近 2 周趋势')
    expect(text).toContain('[高] 高二(3)班')
  })
  it('区域指标输出值/环比/备注', () => {
    const text = formatRegionMetrics({ metrics, meta: seedMeta() })
    expect(text).toContain('区域平均分：76.5（环比+0.8）')
    expect(text).toContain('稳中有升')
  })
  it('空数据 → 暂无', () => {
    expect(formatSchoolOverview({ trend: [], alerts: [], meta: seedMeta() })).toContain('暂无')
    expect(formatRegionMetrics({ metrics: [], meta: seedMeta() })).toContain('暂无')
  })
})

describe('formatDataContext 角色分支', () => {
  it('teacher 只消费班级学情；schoolAdmin 只消费校情；bureau 只消费区域', () => {
    expect(formatDataContext('teacher', { classProfile: { profile, meta: seedMeta() } })).toContain('班级学情')
    expect(formatDataContext('schoolAdmin', { school: { trend, alerts, meta: seedMeta() } })).toContain('校情数据')
    expect(formatDataContext('bureau', { region: { metrics, meta: seedMeta() } })).toContain('区域指标')
  })
  it('角色与数据不匹配 → 空串（调用方跳过数据段）', () => {
    expect(formatDataContext('teacher', { region: { metrics, meta: seedMeta() } })).toBe('')
    expect(formatDataContext('bureau', {})).toBe('')
  })
  it('超长内容截断并标注', () => {
    const long: ClassLearning = { ...profile, weakPoints: ['x'.repeat(DATA_CONTEXT_MAX_CHARS)] }
    const text = formatDataContext('teacher', { classProfile: { profile: long, meta: seedMeta() } })
    expect(text.length).toBeLessThanOrEqual(DATA_CONTEXT_MAX_CHARS + 20)
    expect(text).toContain('已截断')
  })
})

describe('buildDataContext 异步聚合', () => {
  it('seed 数据源下各角色均能产出非空上下文', async () => {
    expect(await buildDataContext('teacher')).toContain('班级学情')
    expect(await buildDataContext('schoolAdmin')).toContain('校情数据')
    expect(await buildDataContext('bureau')).toContain('区域指标')
  })
})
