import type { ArtifactKind, EvalCheck, EvalResult, Evaluator, RoleId } from '../types'

/**
 * 产出自评（v0.9.1，规则版零 LLM 成本）：
 * 按 ArtifactKind 检查项权重表评分（各项权重合计 10 → 分数即 0-10），
 * 未通过项映射为可执行建议。纯同步字符串规则，无网络开销，mock / api 共用。
 * 结果仅供用户参考（UI 侧标注「AI 自评」），不阻断产出使用。
 */

/** 单条检查规则：name 展示名 / weight 满分权重 / test 纯字符串判定 / suggestion 未通过时的可执行建议 */
interface CheckRule {
  name: string
  weight: number
  test: (content: string) => boolean
  suggestion: string
}

/* ---------- 通用判定 ---------- */

const headingCount = (content: string): number => (content.match(/^#{1,6}\s+\S/gm) ?? []).length

/** 去除 Markdown 语法与空白后的正文字符数（中文场景按字计） */
function textLength(content: string): number {
  return content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[#*`>|\-_[\]()]/g, '')
    .replace(/\s/g, '').length
}

const hasStructure =
  (minHeadings = 2) =>
  (content: string): boolean =>
    headingCount(content) >= minHeadings

function wordRangeCheck(content: string, min: number, max: number): boolean {
  const n = textLength(content)
  return n >= min && n <= max
}

/* ---------- 各 kind 权重表（各项权重合计 10） ---------- */

const LESSON_PLAN_RULES: CheckRule[] = [
  {
    name: '四段结构',
    weight: 4,
    test: (c) =>
      /教学目标|学习目标/.test(c) && /教学过程|教学环节/.test(c) && /板书/.test(c) && /作业/.test(c),
    suggestion: '补全教案四段结构（教学目标 / 教学过程 / 板书设计 / 作业布置）',
  },
  {
    name: '环节时间标注',
    weight: 3,
    test: (c) => /\d+\s*(?:min|分钟)/i.test(c) || /\d+'/.test(c),
    suggestion: '教学环节补充时间标注（如 5 min / 12 分钟）',
  },
  {
    name: '篇幅适中',
    weight: 3,
    test: (c) => wordRangeCheck(c, 400, 1200),
    suggestion: '教案篇幅建议 400-1200 字，避免过简或冗长',
  },
]

const REPORT_RULES: CheckRule[] = [
  {
    name: '结论与数据',
    weight: 4,
    test: (c) => /结论|总结|建议/.test(c) && /\d+(?:\.\d+)?\s*%|\d+\.\d+/.test(c),
    suggestion: '补充关键结论与数据引用（如「及格率 85%」「均分 72.5」）',
  },
  {
    name: '篇幅适中',
    weight: 3,
    test: (c) => wordRangeCheck(c, 200, 2000),
    suggestion: '报告篇幅建议 200-2000 字',
  },
  {
    name: '结构完整',
    weight: 3,
    test: hasStructure(2),
    suggestion: '使用 Markdown 标题分层（至少两级），便于阅读',
  },
]

const NOTICE_RULES: CheckRule[] = [
  {
    name: '三要素齐全',
    weight: 5,
    test: (c) =>
      /(\d{1,2}\s*月\d{1,2}\s*日|第\s*\d+\s*周|周[一二三四五六日]|\d{4}\s*年|本学期)/.test(c) &&
      /(各校|各班级|各年级|各科|全体|老师们|家长|同学们|各中小学校)/.test(c) &&
      /(报送|邮箱|提交|反馈至|发送至|回执|一式两份|上报)/.test(c),
    suggestion: '通知需包含时间、对象、报送方式三要素',
  },
  {
    name: '篇幅适中',
    weight: 2.5,
    test: (c) => wordRangeCheck(c, 200, 1200),
    suggestion: '通知篇幅建议 200-1200 字',
  },
  {
    name: '结构完整',
    weight: 2.5,
    test: hasStructure(2),
    suggestion: '使用 Markdown 标题分层（至少两级），便于阅读',
  },
]

const GENERIC_RULES: CheckRule[] = [
  {
    name: '结论或建议',
    weight: 4,
    test: (c) => /结论|总结|建议|下一步/.test(c),
    suggestion: '补充结论或建议段，让产出可执行',
  },
  {
    name: '篇幅适中',
    weight: 3,
    test: (c) => wordRangeCheck(c, 150, 1500),
    suggestion: '篇幅建议 150-1500 字',
  },
  {
    name: '结构完整',
    weight: 3,
    test: hasStructure(2),
    suggestion: '使用 Markdown 标题分层（至少两级），便于阅读',
  },
]

const RULES: Record<ArtifactKind, CheckRule[]> = {
  lessonPlan: LESSON_PLAN_RULES,
  report: REPORT_RULES,
  notice: NOTICE_RULES,
  analysis: GENERIC_RULES,
  generic: GENERIC_RULES,
}

/** 纯函数评分（导出供单测）：加权合成 0-10，未通过项按建议文案表映射 */
export function evaluateDoc(doc: { kind: ArtifactKind; content: string }): EvalResult {
  const rules = RULES[doc.kind] ?? GENERIC_RULES
  const checks: EvalCheck[] = rules.map((r) => ({ name: r.name, pass: r.test(doc.content), weight: r.weight }))
  const suggestions = rules.filter((_, i) => !checks[i].pass).map((r) => r.suggestion)
  const score = Math.round(checks.reduce((sum, c) => sum + (c.pass ? c.weight : 0), 0) * 10) / 10
  return { score, checks, suggestions }
}

/** Evaluator 契约实现（规则版）；LLM 版二期再引入 */
export class RuleEvaluator implements Evaluator {
  async evaluate(doc: { kind: ArtifactKind; content: string; role: RoleId }): Promise<EvalResult> {
    return evaluateDoc(doc)
  }
}
