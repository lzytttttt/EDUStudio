import { describe, expect, it } from 'vitest'
import { parseScoreCsv, weakPointsFrom } from '../lib/csvImport'
import { SeedSourceProvider, formatAge, isStale } from '../harness/sources'
import { useDataStore } from '../stores/dataStore'

describe('csvImport · 宽表（一行一个学生）', () => {
  const wide = [
    '姓名,班级,语文,数学,英语',
    '张三,高一（3）班,80,60,90',
    '李四,高一（3）班,70,64,80',
    '王五,高一（3）班,90,68,100',
  ].join('\n')

  it('按科目聚合均分/及格率/优秀率', () => {
    const r = parseScoreCsv(wide)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.preview.className).toBe('高一（3）班')
    expect(r.preview.rowCount).toBe(3)
    const math = r.preview.scores.find((s) => s.subject === '数学')!
    expect(math.avg).toBe(64)
    expect(math.passRate).toBe(100) // 60/64/68 均 ≥60
    expect(math.excellenceRate).toBe(0) // 均 <85
    const eng = r.preview.scores.find((s) => s.subject === '英语')!
    expect(eng.excellenceRate).toBeCloseTo(66.7, 1) // 90/100 优秀
  })

  it('科目按均分降序输出', () => {
    const r = parseScoreCsv(wide)
    if (!r.ok) return
    const avgs = r.preview.scores.map((s) => s.avg)
    expect([...avgs].sort((a, b) => b - a)).toEqual(avgs)
  })
})

describe('csvImport · 长表（一行一条成绩）', () => {
  it('明细分数按科目分组聚合', () => {
    const long = [
      '班级,科目,分数',
      '高一（3）班,数学,70',
      '高一（3）班,数学,80',
      '高一（3）班,语文,90',
    ].join('\n')
    const r = parseScoreCsv(long)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.preview.scores.find((s) => s.subject === '数学')!.avg).toBe(75)
    expect(r.preview.scores.find((s) => s.subject === '语文')!.avg).toBe(90)
  })

  it('已聚合行直接采用，及格/优秀率缺省时按均分口径估算并提示', () => {
    const agg = '科目,平均分\n数学,72.5\n语文,88'
    const r = parseScoreCsv(agg)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const math = r.preview.scores.find((s) => s.subject === '数学')!
    expect(math.avg).toBe(72.5)
    expect(math.passRate).toBeGreaterThan(0)
    expect(r.preview.warnings.some((w) => w.includes('估算'))).toBe(true)
  })
})

describe('csvImport · 容错与提示', () => {
  it('容忍 BOM、分号分隔与「成绩」别名表头', () => {
    const csv = '\uFEFF学生;成绩\n张三;90\n李四;70'
    const r = parseScoreCsv(csv)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.preview.scores[0].avg).toBe(80)
    expect(r.preview.columnMap.some((c) => c.as === '姓名')).toBe(true)
  })

  it('未识别列进入 warnings，作业完成率列被采用', () => {
    const csv = ['姓名,语文,备注,作业完成率', '张三,80,班长,0.9', '李四,70,,0.8'].join('\n')
    const r = parseScoreCsv(csv)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.preview.warnings.some((w) => w.includes('备注'))).toBe(true)
    expect(r.preview.homeworkCompletion).toBe(85)
  })

  it('无班级列时用文件名兜底并提示', () => {
    const r = parseScoreCsv('姓名,数学\n张三,80', { fileName: '高一5班月考.csv' })
    if (!r.ok) return
    expect(r.preview.className).toBe('高一5班月考')
    expect(r.preview.warnings.some((w) => w.includes('文件名'))).toBe(true)
  })

  it('内容过少给出可修正错误', () => {
    expect(parseScoreCsv('姓名,数学').ok).toBe(false)
    expect(parseScoreCsv('').ok).toBe(false)
  })

  it('宽表缺科目列给出可修正错误', () => {
    const r = parseScoreCsv('姓名,备注\n张三,班长\n李四,组委')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('科目')
  })

  it('非数值分数行被跳过并提示', () => {
    const r = parseScoreCsv('姓名,数学\n张三,缺考\n李四,80')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.preview.rowCount).toBe(1)
    expect(r.preview.warnings.some((w) => w.includes('跳过'))).toBe(true)
  })
})

describe('weakPointsFrom', () => {
  it('取均分最低至多 3 科并带均分标注', () => {
    const r = parseScoreCsv('姓名,语文,数学,英语,物理\n张三,80,60,90,55')
    if (!r.ok) return
    expect(weakPointsFrom(r.preview)).toEqual(['物理（均分 55）', '数学（均分 60）', '语文（均分 80）'])
  })
})

describe('SeedSourceProvider · 导入数据优先', () => {
  it('存在导入数据时返回 csv meta，否则回落 seed meta', async () => {
    const provider = new SeedSourceProvider()
    useDataStore.setState({ profiles: [] })
    const seedResult = await provider.getClassProfile()
    expect(seedResult.meta.kind).toBe('seed')

    useDataStore.setState({
      profiles: [
        {
          classId: 'csv-x',
          className: '高一（9）班',
          scores: [{ subject: '数学', avg: 70, passRate: 70, excellenceRate: 10, trend: 0 }],
          homeworkCompletion: 88,
          attentionIndex: 80,
          weakPoints: ['数学（均分 70）'],
          importedAt: Date.now(),
          fileName: '月考.csv',
          studentCount: 40,
        },
      ],
    })
    const csvResult = await provider.getClassProfile('高一（9）班')
    expect(csvResult.meta.kind).toBe('csv')
    expect(csvResult.profile?.className).toBe('高一（9）班')
    useDataStore.setState({ profiles: [] })
  })
})

describe('新鲜度工具', () => {
  it('isStale：7 天内不告警，超过告警', () => {
    expect(isStale(null)).toBe(false)
    expect(isStale({ fetchedAt: Date.now() - 3 * 24 * 3600_000, kind: 'seed', label: 'x' })).toBe(false)
    expect(isStale({ fetchedAt: Date.now() - 8 * 24 * 3600_000, kind: 'seed', label: 'x' })).toBe(true)
  })

  it('formatAge：分钟/小时/天阶梯', () => {
    expect(formatAge(Date.now() - 30_000)).toBe('刚刚')
    expect(formatAge(Date.now() - 5 * 60_000)).toBe('5 分钟前')
    expect(formatAge(Date.now() - 3 * 3600_000)).toBe('3 小时前')
    expect(formatAge(Date.now() - 2 * 24 * 3600_000)).toBe('2 天前')
  })
})
