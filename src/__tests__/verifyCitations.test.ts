import { describe, expect, it } from 'vitest'
import { verifyArtifactCitations, verifyCitations } from '../harness/director/verifyCitations'
import type { CitationCheck, CitationReport } from '../harness/director/verifyCitations'
import { freezeFacts } from '../harness/director/facts'
import { MISSION_TEMPLATES } from '../harness/director/data'
import { BRIEFING_DECKS } from '../harness/scripts/briefing'

/* 引用校验（v1.1 P0-3）：82.4 过 / 80.4 需 derived / 84 unverified / 9100、1.8 conflicts / 3 封 structural */

const facts = freezeFacts()

function checkOf(report: CitationReport, predicate: (c: CitationCheck) => boolean): CitationCheck {
  const hit = report.checks.find(predicate)
  if (!hit) throw new Error(`未找到匹配的 token：${JSON.stringify(report.checks)}`)
  return hit
}

function statCheck(report: CitationReport, value: number): CitationCheck {
  return checkOf(report, (c) => c.value === value && c.status !== 'structural')
}

function t8Text(): string {
  const payload = BRIEFING_DECKS.teacher.find((c) => c.id === 't8')?.payload
  return payload?.kind === 'editable' ? payload.text : ''
}

describe('verifyCitations · 命中快照（verified）', () => {
  it('82.4 分 / 78.6 分 / 80.2 分 命中三科均分', () => {
    const report = verifyCitations('本次单元考物理均分 82.4 分、数学均分 78.6 分、化学均分 80.2 分。', facts)
    expect(statCheck(report, 82.4)).toMatchObject({ status: 'verified', factId: 'f-physics-avg', unit: '分' })
    expect(statCheck(report, 78.6)).toMatchObject({ status: 'verified', factId: 'f-math-avg' })
    expect(statCheck(report, 80.2)).toMatchObject({ status: 'verified', factId: 'f-chem-avg' })
    expect(report.ok).toBe(true)
    expect(report.coverage).toBe(1)
  })

  it('无单位数字按上下文指标推断单位（物理 82.4）', () => {
    const report = verifyCitations('物理 82.4，这是本次单元考的数据。', facts)
    expect(statCheck(report, 82.4).status).toBe('verified')
    expect(report.ok).toBe(true)
  })

  it('作业完成率 93% / 课堂专注度 86 / 函数单调性掌握率 61% 命中快照', () => {
    const report = verifyCitations('作业完成率 93%，课堂专注度 86，函数单调性判定掌握率 61%。', facts)
    expect(statCheck(report, 93)).toMatchObject({ status: 'verified', factId: 'f-homework-completion', unit: '%' })
    expect(statCheck(report, 86)).toMatchObject({ status: 'verified', factId: 'f-class-attention' })
    expect(statCheck(report, 61)).toMatchObject({ status: 'verified', factId: 'f-weak-mastery' })
    expect(report.ok).toBe(true)
  })

  it('环比用「百分点」：+2.1 / -1.4 / +0.8 命中 trend 事实', () => {
    const report = verifyCitations(
      '物理均分环比 +2.1 百分点，数学均分环比 -1.4 百分点，化学均分环比 +0.8 百分点。',
      facts,
    )
    expect(statCheck(report, 2.1)).toMatchObject({ status: 'verified', factId: 'f-physics-trend', unit: '百分点' })
    expect(statCheck(report, -1.4)).toMatchObject({ status: 'verified', factId: 'f-math-trend' })
    expect(statCheck(report, 0.8)).toMatchObject({ status: 'verified', factId: 'f-chem-trend' })
    expect(report.ok).toBe(true)
  })
})

describe('verifyCitations · 派生值（derived）', () => {
  it('80.4 需按派生值校验：status=derived 且提示标「派生」', () => {
    for (const text of ['三科均分 80.4 分。', '80.4 分。']) {
      const report = verifyCitations(text, facts)
      const c = statCheck(report, 80.4)
      expect(c.status).toBe('derived')
      expect(c.factId).toBe('f-class-subject-avg')
      expect(c.reason).toContain('派生')
      expect(report.ok).toBe(true)
    }
  })
})

describe('verifyCitations · 冲突（conflict）', () => {
  it('9100% 判为冲突（重复 ×100 的旧 bug 形态）', () => {
    const report = verifyCitations('及格率 9100%，优秀率 3800%。', facts)
    const c = statCheck(report, 9100)
    expect(c.status).toBe('conflict')
    expect(c.reason).toContain('×100')
    expect(report.ok).toBe(false)
    expect(report.conflicts).toBeGreaterThanOrEqual(1)
  })

  it('旧 t8 文案：1.8 与快照环比 +2.1 冲突', () => {
    const old = '各位家长：\n\n本次月考班级均分 82.4，较上次提升 1.8 分…'
    const report = verifyCitations(old, facts)
    const c = statCheck(report, 1.8)
    expect(c.status).toBe('conflict')
    expect(c.reason).toContain('环比')
    expect(report.ok).toBe(false)
  })

  it('同指标异值：数学均分 82.4 与快照冲突', () => {
    const report = verifyCitations('数学均分 82.4 分。', facts)
    expect(statCheck(report, 82.4)).toMatchObject({ status: 'conflict' })
    expect(report.ok).toBe(false)
  })

  it('单位混用：物理均分 82.4%（把分写成 %）→ conflict', () => {
    const report = verifyCitations('物理均分 82.4%。', facts)
    const c = statCheck(report, 82.4)
    expect(c.status).toBe('conflict')
    expect(c.reason).toContain('单位')
  })

  it('变化值写成 % → conflict（应使用百分点）', () => {
    const report = verifyCitations('物理均分环比 +2.1%。', facts)
    const c = statCheck(report, 2.1)
    expect(c.status).toBe('conflict')
    expect(c.reason).toContain('百分点')
  })
})

describe('verifyCitations · 无据（unverified）', () => {
  it('84 分不在快照里 → unverified，只标待核', () => {
    const report = verifyCitations('本次均分 84 分。', facts)
    const c = statCheck(report, 84)
    expect(c.status).toBe('unverified')
    expect(c.reason).toContain('待核')
    expect(report.ok).toBe(false)
    expect(report.coverage).toBe(0)
  })

  it('快照没有的指标（优秀率）→ unverified，不误判成同指标冲突', () => {
    const report = verifyCitations('物理优秀率 38%。', facts)
    expect(statCheck(report, 38)).toMatchObject({ status: 'unverified' })
  })
})

describe('verifyCitations · 结构性白名单（structural）', () => {
  it('3 封 / 8 页 / 12 题 / 15 分钟 / 46 份 / 4 件 不参与溯源', () => {
    const report = verifyCitations(
      '先发 3 封家长信，做 8 页 PPT，配 12 题练习，每天 15 分钟复盘，收 46 份回执，交付 4 件。',
      facts,
    )
    const structural = report.checks.filter((c) => c.status === 'structural')
    expect(structural).toHaveLength(6)
    expect(structural.map((c) => c.unit)).toEqual(['封', '页', '题', '分钟', '份', '件'])
    expect(report.total).toBe(0)
    expect(report.structural).toBe(6)
    expect(report.coverage).toBe(1)
    expect(report.ok).toBe(true)
  })

  it('分层比例属于设计参数 → structural；带统计词的正确率仍走待核', () => {
    const params = verifyCitations('分层练习：基础 70% / 提高 30%，比例可改为 60% / 40%。', facts)
    expect(params.checks.filter((c) => c.status === 'structural')).toHaveLength(4)
    expect(params.total).toBe(0)
    expect(params.ok).toBe(true)

    const stats = verifyCitations('基础题正确率 74%，提高题正确率 52%。', facts)
    expect(statCheck(stats, 74).status).toBe('unverified')
    expect(statCheck(stats, 52).status).toBe('unverified')

    /* 参数白名单不能被用来绕过 ×100 检查 */
    const polluted = verifyCitations('分层练习：基础 9100% / 提高 30%。', facts)
    expect(statCheck(polluted, 9100).status).toBe('conflict')
  })
})

describe('verifyCitations · {{值~来源}} 标记', () => {
  it('标记直接视为 verified，并保留 cited 标记', () => {
    const report = verifyCitations('物理 82.4{{82.4~学情库 · 单元考}}，薄弱点 61%{{61%~近14天测验}}。', facts)
    const cited = report.checks.filter((c) => c.cited)
    expect(cited).toHaveLength(2)
    expect(cited[0]).toMatchObject({ status: 'verified', value: 82.4, factId: 'f-physics-avg' })
    expect(cited[1]).toMatchObject({ status: 'verified', value: 61 })
    expect(report.ok).toBe(true)
    expect(report.coverage).toBe(1)
  })

  it('标记命中派生值仍记 derived', () => {
    const report = verifyCitations('三科均分 {{80.4~seed · 派生}}。', facts)
    const cited = checkOf(report, (c) => c.cited === true)
    expect(cited.status).toBe('derived')
    expect(cited.factId).toBe('f-class-subject-avg')
  })
})

describe('verifyCitations · 序数/日期/无单位数字', () => {
  it('日期、版本号等推断不出指标的数字计入 skipped，不产生冲突', () => {
    const report = verifyCitations('v1.1 版本，数据时点 2026-11-06。', facts)
    expect(report.skipped).toBeGreaterThan(0)
    expect(report.total).toBe(0)
    expect(report.structural).toBe(0)
    expect(report.ok).toBe(true)
  })

  it('空文本：total=0、coverage=1、ok=true', () => {
    expect(verifyCitations('', facts)).toMatchObject({ total: 0, coverage: 1, ok: true, checks: [] })
  })
})

describe('verifyCitations · 与 t8 文案联动（P0-2 回归）', () => {
  it('修正后的 t8 文案 100% 可溯源', () => {
    const report = verifyCitations(t8Text(), facts)
    expect(report.total).toBeGreaterThanOrEqual(2)
    expect(statCheck(report, 82.4).status).toBe('verified')
    expect(statCheck(report, 2.1).status).toBe('verified')
    expect(report.ok).toBe(true)
    expect(report.coverage).toBe(1)
  })
})

describe('verifyCitations · 正确性与稳定性', () => {
  it('纯函数：同参两次结果深相等，不依赖调用顺序', () => {
    const text = '物理均分 82.4 分，较上次 +2.1 分；3 封家长信。'
    expect(verifyCitations(text, facts)).toEqual(verifyCitations(text, facts))
  })

  it('report 计数自洽：total = verified + derived + conflicts + unverified', () => {
    const report = verifyCitations('物理均分 82.4 分，84 分待核，及格率 9100%，三科均分 80.4 分。', facts)
    expect(report.total).toBe(report.verified + report.derived + report.conflicts + report.unverified)
    expect(report.coverage).toBeCloseTo((report.verified + report.derived) / report.total, 10)
    expect(report.ok).toBe(report.conflicts === 0 && report.unverified === 0)
  })
})

describe('verifyArtifactCitations · 产物扫描冒烟', () => {
  it('两条剧本的全部 Mock 产物均可扫描，分型合法、{{}} 标记与结构数字被识别', () => {
    for (const template of Object.values(MISSION_TEMPLATES)) {
      expect(template.artifacts.length).toBeGreaterThan(0)
      const scanned = verifyArtifactCitations(template.artifacts, facts)
      expect(scanned.artifacts).toHaveLength(template.artifacts.length)
      expect(scanned.artifacts.map((a) => a.artifactId)).toEqual(template.artifacts.map((a) => a.id))
      const allowed = new Set(['verified', 'derived', 'conflict', 'unverified', 'structural'])
      for (const entry of scanned.artifacts) {
        expect(entry.report.total + entry.report.structural + entry.report.skipped).toBeGreaterThan(0)
        for (const c of entry.report.checks) expect(allowed.has(c.status)).toBe(true)
      }
      const sumTotal = scanned.artifacts.reduce((acc, a) => acc + a.report.total, 0)
      expect(scanned.all.total).toBe(sumTotal)
      expect(scanned.all.checks.length).toBe(scanned.artifacts.reduce((acc, a) => acc + a.report.checks.length, 0))
      expect(scanned.all.checks.some((c) => c.cited === true)).toBe(true)
      expect(scanned.all.checks.some((c) => c.status === 'structural')).toBe(true)
    }
    /* v1.0 父剧本仍有「3 封家长信」这类结构性数字 */
    const parent = verifyArtifactCitations(MISSION_TEMPLATES.parent_meeting.artifacts, facts)
    expect(parent.all.checks.some((c) => c.status === 'structural' && c.unit === '封')).toBe(true)
  })

  it('全部模板合并扫描：{{}} 标记全部视为已验证（派生 80.4 记 derived）', () => {
    const allArtifacts = Object.values(MISSION_TEMPLATES).flatMap((t) => t.artifacts)
    const scanned = verifyArtifactCitations(allArtifacts, facts)
    const cited = scanned.all.checks.filter((c) => c.cited === true)
    expect(cited.length).toBeGreaterThan(0)
    expect(cited.some((c) => c.value === 80.4 && c.status === 'derived')).toBe(true)
    expect(cited.every((c) => c.status === 'verified' || c.status === 'derived')).toBe(true)
  })
})
