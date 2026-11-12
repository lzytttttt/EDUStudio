/**
 * 事实快照 FactSnapshot（v1.1 P0-3）
 *
 * 规划（planning）阶段从 SourceProvider / seed 冻结的「统计型事实」；整条 mission 只读，
 * 产物里的数字必须能回溯到这里的条目（校验见 ./verifyCitations.ts）。
 *
 * 口径（与 doc/v1.0-roadmap.md 附录 C、./data.ts 对齐）：
 * - 82.4 / 78.6 / 80.2 = 高一（3）班物理 / 数学 / 化学「均分」（单位：分）；
 * - +2.1 / -1.4 / +0.8 = 三科均分环比（单位：百分点，不是 %）；
 * - 93% = 作业完成率；86 = 课堂专注度（0–100，按 % 计）；61% = 函数单调性判定掌握率；
 * - 80.4 = 三科均分（(82.4+78.6+80.2)/3），derived=true，引用时必须显式标「派生」。
 *
 * 纯函数、确定性：缺省不读 Date.now / 网络 / 全局 store，
 * 无参调用永远得到同一份 10 条快照（9 条基础 + 1 条派生），便于持久化与单测复现。
 */
import type { ClassLearning, SubjectScore } from '../../data/seed'
import { CLASS_LEARNING } from '../../data/seed'
import type { ClassProfileResult, SourceMeta } from '../sources'
import type { Fact } from './types'

/** 演示数据时点锚点：无 meta 时固定使用，保证无参调用可复现（真实数据用 meta.fetchedAt 派生） */
export const FACT_AS_OF = '2026-11-06'

/** 学科 → 指标键前缀（verifyCitations 的指标词表与 facts 键保持一致） */
const SUBJECT_KEY: Record<string, string> = {
  物理: 'physics',
  数学: 'math',
  化学: 'chem',
  语文: 'chinese',
  英语: 'english',
}

function subjectKey(subject: string): string {
  return SUBJECT_KEY[subject] ?? subject
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** 本地时区日期（含 meta 时用于 asOf；无 meta 固定锚点，单测无需 mock 时间） */
export function formatFactDate(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 数据来源文案：seed 用演示叙事口径；CSV / 远端如实写来源名；降级如实标注 */
function sourceLabel(profile: ClassLearning, meta?: SourceMeta | null): string {
  const base =
    meta && meta.kind !== 'seed'
      ? `${meta.label} · ${profile.className} · 单元考`
      : `学情库 · ${profile.className} · 单元考`
  return meta?.degraded ? `${base} · 服务不可用，取演示数据` : base
}

/** 从薄弱点标签里解析掌握率（seed：'函数单调性判定（掌握率 61%）'） */
function parseMastery(weakPoints: string[]): { label: string; value: number } | null {
  for (const point of weakPoints) {
    const m = /^(.+?)（掌握率\s*(\d+(?:\.\d+)?)%）$/.exec(point)
    if (m) return { label: m[1], value: Number(m[2]) }
  }
  return null
}

/** 派生值：前 3 科均分（seed 恰为物理/数学/化学 → 80.4）；不足 2 科不派生 */
function deriveSubjectAvg(scores: SubjectScore[]): { value: number; label: string; subjects: string[] } | null {
  const used = scores.slice(0, 3)
  if (used.length < 2) return null
  const sum = used.reduce((acc, s) => acc + s.avg, 0)
  const cn = used.length === 2 ? '两' : '三'
  return { value: round1(sum / used.length), label: `${cn}科均分（派生）`, subjects: used.map((s) => s.subject) }
}

export interface FreezeFactsInput {
  /** SourceProvider 返回的班级学情；缺省取 seed 第一班（演示口径） */
  profile?: ClassLearning | null
  /** 数据源元信息：degraded / kind / label 如实落进 source 与 asOf */
  meta?: SourceMeta | null
  /** 数据时点覆盖（缺省：有 meta 取 meta.fetchedAt 日期，否则固定 FACT_AS_OF） */
  asOf?: string
}

/**
 * 冻结事实快照（纯函数）：同一入参永远得到同一结果。
 * - 无参调用：seed 高一（3）班 → 10 条（9 基础 + 1 派生）；
 * - planner 从 SourceProvider 取到 profile 后，用 freezeFacts({ profile, meta }) 或
 *   freezeFactsFromSource(result) 冻结。
 */
export function freezeFacts(input: FreezeFactsInput = {}): Fact[] {
  const profile = input.profile === undefined ? CLASS_LEARNING[0] ?? null : input.profile
  if (!profile) return []
  const meta = input.meta ?? null
  const source = sourceLabel(profile, meta)
  const asOf = input.asOf ?? (meta ? formatFactDate(meta.fetchedAt) : FACT_AS_OF)
  const facts: Fact[] = []

  /* 1) 三科均分 */
  for (const s of profile.scores) {
    const key = subjectKey(s.subject)
    facts.push({
      factId: `f-${key}-avg`,
      key: `${key}.avg`,
      value: s.avg,
      unit: '分',
      label: `${s.subject}均分`,
      source,
      asOf,
    })
  }

  /* 2) 三科环比（百分点） */
  for (const s of profile.scores) {
    const key = subjectKey(s.subject)
    facts.push({
      factId: `f-${key}-trend`,
      key: `${key}.trend`,
      value: s.trend,
      unit: '百分点',
      label: `${s.subject}均分环比`,
      source,
      asOf,
    })
  }

  /* 3) 作业完成率 / 课堂专注度 */
  facts.push({
    factId: 'f-homework-completion',
    key: 'homework.completion',
    value: profile.homeworkCompletion,
    unit: '%',
    label: '作业完成率',
    source,
    asOf,
  })
  facts.push({
    factId: 'f-class-attention',
    key: 'class.attention',
    value: profile.attentionIndex,
    unit: '%',
    label: '课堂专注度',
    source,
    asOf,
  })

  /* 4) 薄弱点掌握率（seed：函数单调性 61%） */
  const mastery = parseMastery(profile.weakPoints)
  if (mastery) {
    facts.push({
      factId: 'f-weak-mastery',
      key: 'weak.mastery',
      value: mastery.value,
      unit: '%',
      label: `${mastery.label}掌握率`,
      source,
      asOf,
    })
  }

  /* 5) 派生值：三科均分 80.4（derived=true，引用时必须标「派生」） */
  const derived = deriveSubjectAvg(profile.scores)
  if (derived) {
    facts.push({
      factId: 'f-class-subject-avg',
      key: 'class.three-subject-avg',
      value: derived.value,
      unit: '分',
      label: derived.label,
      source,
      asOf,
      derived: true,
    })
  }

  return facts
}

/** SourceProvider 结果 → 冻结快照（planning 阶段桥接；profile 为空时返回空快照） */
export function freezeFactsFromSource(result: ClassProfileResult): Fact[] {
  if (!result.profile) return []
  return freezeFacts({ profile: result.profile, meta: result.meta })
}
