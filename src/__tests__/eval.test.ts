import { describe, expect, it } from 'vitest'
import { RuleEvaluator, evaluateDoc } from '../harness/eval/ruleEvaluator'
import { getEvaluator } from '../harness/eval'

/* 产出自评 v0.9.1：按 kind 权重表评分（合计 10）、建议生成、契约工厂 */

const para = (s: string, n: number) => Array(n).fill(s).join('')

const goodLessonPlan = [
  '# 《分数乘法》教学设计',
  '## 教学目标',
  para('理解分数乘法的算理，能正确计算简单分数乘法。', 8),
  '## 教学过程',
  para('导入新课 5 min，新知探究 12 分钟，巩固练习 10 分钟，课堂小结 3 min。', 6),
  '## 板书设计',
  para('板书呈现分数乘法算理图示与计算步骤。', 5),
  '## 作业布置',
  para('完成课本练习第 1-5 题。', 5),
].join('\n\n')

const goodReport = [
  '# 五年级数学期中质量分析',
  '## 结论',
  para('本次考试及格率 85.5%，优秀率 32%，均分 72.5，与上次相比提升 5%。', 8),
  '## 建议',
  para('针对薄弱知识点安排专项练习。', 5),
].join('\n\n')

const goodNotice = [
  '# 关于开展教学常规检查的通知',
  '## 时间',
  para('9月10日至9月12日。', 5),
  '## 对象',
  para('全体任课教师、各年级组。', 5),
  '## 报送方式',
  para('请于9月12日前将自查表一式两份报送教务处。', 5),
].join('\n\n')

const goodGeneric = ['# 教学工作建议', '## 建议', para('建议加强课堂互动，关注学困生。', 12), '## 结论', para('整体态势向好。', 6)].join('\n\n')

describe('evaluateDoc 按 kind 评分', () => {
  it('教案：高完成度模板满分，残缺文本 0 分 + 3 条建议', () => {
    const good = evaluateDoc({ kind: 'lessonPlan', content: goodLessonPlan })
    expect(good.score).toBe(10)
    expect(good.suggestions).toEqual([])
    expect(good.checks.map((c) => c.name)).toEqual(['四段结构', '环节时间标注', '篇幅适中'])

    const bad = evaluateDoc({ kind: 'lessonPlan', content: '请写一份教案。' })
    expect(bad.score).toBe(0)
    expect(bad.suggestions).toHaveLength(3)
    expect(bad.suggestions[0]).toContain('四段结构')
  })

  it('教案：缺时间标注 → 扣对应权重并给建议', () => {
    const noTime = goodLessonPlan.replace(/5 min/g, '片刻').replace(/12 分钟/g, '一会儿').replace(/10 分钟/g, '一会儿').replace(/3 min/g, '片刻')
    const out = evaluateDoc({ kind: 'lessonPlan', content: noTime })
    expect(out.checks.find((c) => c.name === '环节时间标注')?.pass).toBe(false)
    expect(out.score).toBe(7)
    expect(out.suggestions).toContain('教学环节补充时间标注（如 5 min / 12 分钟）')
  })

  it('报告：结论+数据+结构齐备满分', () => {
    const out = evaluateDoc({ kind: 'report', content: goodReport })
    expect(out.score).toBe(10)
  })

  it('通知：三要素齐全满分；缺报送方式 → 5 分档', () => {
    expect(evaluateDoc({ kind: 'notice', content: goodNotice }).score).toBe(10)
    // 负例需摘除全部正文与「报送方式」标题（段落 ×5 重复 + 标题本身含「报送」关键词）
    const noChannel = goodNotice
      .replace(/## 报送方式/g, '## 材料接收')
      .replace(/一式两份报送教务处/g, '当面交给教务处')
    const out = evaluateDoc({ kind: 'notice', content: noChannel })
    expect(out.checks.find((c) => c.name === '三要素齐全')?.pass).toBe(false)
    expect(out.score).toBe(5)
  })

  it('通用/analysis：结论建议 + 篇幅 + 结构', () => {
    expect(evaluateDoc({ kind: 'generic', content: goodGeneric }).score).toBe(10)
    expect(evaluateDoc({ kind: 'analysis', content: goodGeneric }).score).toBe(10)
    const bad = evaluateDoc({ kind: 'generic', content: '随便说说' })
    expect(bad.score).toBe(0)
    expect(bad.suggestions).toHaveLength(3)
  })

  it('空内容 → 0 分且建议非空；score 恒在 [0,10]', () => {
    for (const kind of ['lessonPlan', 'report', 'notice', 'analysis', 'generic'] as const) {
      const out = evaluateDoc({ kind, content: '' })
      expect(out.score).toBe(0)
      expect(out.suggestions.length).toBeGreaterThan(0)
    }
    const out = evaluateDoc({ kind: 'report', content: goodReport + goodReport })
    expect(out.score).toBeGreaterThanOrEqual(0)
    expect(out.score).toBeLessThanOrEqual(10)
  })
})

describe('Evaluator 契约与工厂', () => {
  it('getEvaluator 返回 RuleEvaluator；evaluate 异步返回结果', async () => {
    const evaluator = getEvaluator()
    expect(evaluator).toBeInstanceOf(RuleEvaluator)
    const result = await evaluator.evaluate({ kind: 'report', content: goodReport, role: 'teacher' })
    expect(result.score).toBe(10)
    expect(result.checks.every((c) => typeof c.pass === 'boolean' && typeof c.weight === 'number')).toBe(true)
  })
})
