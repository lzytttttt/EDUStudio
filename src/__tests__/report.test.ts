import { describe, expect, it } from 'vitest'
import reportSrc from '../harness/scripts/report.ts?raw'
import { renderReport } from '../harness/scripts/report'
import { buildRenderContext, cite, citeLabel } from '../harness/sources/dataContext'
import { getSourceProvider, seedMeta } from '../harness/sources'
import { renderMarkdown } from '../lib/markdown'
import { REGION_METRICS, SCHOOLS, SCHOOL_ALERTS, CLASS_LEARNING } from '../data/seed'
import { getTemplateById } from '../harness/scripts/artifacts'
import { useDataFocusStore } from '../stores/dataFocusStore'

/** 报告正文里所有溯源标记的数值（hover 前人眼看到的就是这些） */
function citedValues(md: string): string[] {
  return [...md.matchAll(/\{\{([^|~{}]+)~/g)].map((m) => m[1])
}

describe('renderReport · 按数据渲染（v0.9.5 P0-A）', () => {
  it('ctx 为空时不编数字，退回数据不可用说明', () => {
    const md = renderReport('区域质量分析', null)
    expect(md).toContain('未取到可用数据')
    expect(citedValues(md)).toEqual([])
  })

  it('报告里的每个区域指标都出现在总体情况，且带溯源标记', async () => {
    const ctx = await buildRenderContext()
    const md = renderReport('区域质量分析', ctx)
    for (const m of REGION_METRICS) {
      expect(md).toContain(m.name)
      expect(md).toContain(cite(m.value, ctx!.regionCite))
    }
  })

  it('存在性向表格逐条列出结构化预警', async () => {
    const ctx = await buildRenderContext()
    const md = renderReport('区域质量分析', ctx)
    expect(md).toContain('| 维度 | 现状 | 环比 | 风险等级 |')
    for (const a of SCHOOL_ALERTS) {
      expect(md).toContain(a.title)
      expect(md).toContain(a.detail)
    }
  })

  it('学校数与 SCHOOLS 同源，不再写死', async () => {
    const ctx = await buildRenderContext()
    const md = renderReport('区域质量分析', ctx)
    expect(md).toContain(cite(String(SCHOOLS.length), ctx!.regionCite))
  })
})

describe('renderReport · 聚焦范围（v0.9.5 P0-B）', () => {
  it('未选择时走全区口径，无聚焦小节', async () => {
    useDataFocusStore.setState({ schoolId: '', classId: '' })
    const md = renderReport('区域质量分析', await buildRenderContext())
    expect(md).not.toContain('聚焦范围')
  })

  it('聚焦到班级时报告数字随之变化，且带上该校学情的真实数字', async () => {
    const c1 = CLASS_LEARNING[0]
    const c10 = CLASS_LEARNING[CLASS_LEARNING.length - 1]
    useDataFocusStore.setState({ schoolId: 's1', classId: c1.classId })
    const ctxA = await buildRenderContext()
    const a = renderReport('区域质量分析', ctxA)
    useDataFocusStore.setState({ schoolId: 's11', classId: c10.classId })
    const b = renderReport('区域质量分析', await buildRenderContext())

    expect(a).toContain('聚焦范围：实验一中 高一（3）班')
    expect(a).toContain(cite(c1.scores[0].avg, ctxA!.focus!.cite))
    expect(b).toContain('聚焦范围：城南中学 初二（3）班')
    /* 切换班级 → 正文里的数字确实不同，这就是「报告不是冻结快照」的可演证据 */
    expect(a).not.toBe(b)
    useDataFocusStore.setState({ schoolId: '', classId: '' })
  })

  it('聚焦到没有学情的班级时如实留空，不回落别班数据', async () => {
    /* c6 在 CLASSES 中存在但无学情数据：SourceProvider 会回落到第一条，
       resolveFocus 必须识别并留空，否则报告会顶着别的班的数字。 */
    useDataFocusStore.setState({ schoolId: 's4', classId: 'c6' })
    const ctx = await buildRenderContext()
    expect(ctx!.focus).not.toBeNull()
    expect(ctx!.focus!.profile).toBeNull()
    const md = renderReport('区域质量分析', ctx)
    expect(md).toContain('聚焦范围：朝阳中学 初三（4）班')
    expect(md).not.toContain('| 学科 | 均分 |')
    useDataFocusStore.setState({ schoolId: '', classId: '' })
  })
})

describe('renderReport · 溯源（v0.9.5 P0-C）', () => {
  it('数据来源小节如实标注来源与新鲜度', async () => {
    const ctx = await buildRenderContext()
    const md = renderReport('区域质量分析', ctx)
    expect(md).toContain('## 六、数据来源')
    expect(md).toContain(ctx!.regionCite)
    expect(md).toContain(ctx!.schoolCite)
  })

  it('降级时来源标注写明「取演示数据」，不假装连着服务', () => {
    expect(citeLabel({ ...seedMeta(), degraded: true })).toContain('服务不可用，取演示数据')
  })

  it('cite 生成的标记能被渲染器解析出 hover 文本', () => {
    const html = renderMarkdown(`综合指数 ${cite('86.4', '演示数据 · 1 天前')}`)
    expect(html).toContain('title="演示数据 · 1 天前"')
  })
})

describe('模板源码不得持有数据字面量', () => {
  /* 验收动作「全仓 grep 模板源码无数字字面量」的可执行版本。
     只查报告相关的两处：懒加载渲染器与随模板库分发的报告骨架。
     规则阈值（如风险分档的 1）是判据不是数据，故只禁小数字面量与指标取值。 */
  it('报告渲染器源码无小数字面量，也不含任何区域指标取值', () => {
    /* 注释里的版本号（v0.9.5）不算字面量，先剥掉注释再查 */
    const src = reportSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(src).not.toMatch(/\d+\.\d+/)
    for (const m of REGION_METRICS) expect(src).not.toContain(m.value)
  })

  it('报告骨架正文无任何数字（新建文档得到的是空框架）', () => {
    const skeleton = getTemplateById('report').render('区域质量分析')
    expect(skeleton).not.toMatch(/[0-9]/)
  })
})

describe('cite 分隔符不与 Markdown 表格冲突', () => {
  it('cite 内部不含竖线', () => {
    expect(cite('86.4', '演示数据 · 1 天前')).not.toContain('|')
  })
})

describe('buildRenderContext · 源对齐', () => {
  it('取到的区域指标就是 seed 里的那批，不是副本', async () => {
    const res = await getSourceProvider().getRegionMetrics()
    expect(res.metrics).toEqual(REGION_METRICS)
  })
})
