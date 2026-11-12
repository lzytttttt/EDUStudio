/**
 * 引用校验（v1.1 P0-3 · Citation verification）
 *
 * 目的：真 LLM 接入后，产物里的「统计型数字」必须能回溯到本次 mission 冻结的
 * FactSnapshot（./facts.ts）；没有出处的数字只标「待核」，不阻断上屏。
 *
 * 纯函数、零依赖、不碰 DOM / 网络 / 全局 store —— planner、store、UI 均可复用。
 *
 * 分型（CitationStatus）：
 *  - verified    命中快照值（同指标 + 同单位）
 *  - derived     命中派生值（如三科均分 80.4），引用时必须显式标「派生」
 *  - conflict    同指标异值 / 单位错配 / 百分比 >100（重复 ×100）/ 变化值与快照环比不符
 *  - unverified  统计型数字但快照里无出处（只标「待核」）
 *  - structural  结构性数字（3 封 / 8 页 / 12 题 / 15 分钟 / 46 份 …），不参与溯源
 *
 * 特殊约定：
 *  - `{{值~来源}}` 溯源标记（Markdown 行内渲染器同款）直接视为已验证；命中派生值仍记 derived。
 *  - 无单位数字（`专注度 86`、`较上次 +2.1`）按上下文指标词推断单位；推断不出则 skipped，
 *    不参与校验（例如序号、日期、版本号）。
 *  - 结构性白名单 = 单位词表里除「分/%/百分点」以外、且快照事实未使用的单位。
 */
import type { ArtifactTile, Fact, FactUnit } from './types'

export type CitationStatus = 'verified' | 'derived' | 'conflict' | 'unverified' | 'structural'

export interface CitationCheck {
  /** 原文 token（数字部分，如 `82.4`、`+2.1`、`3`；结构型数字不含单位） */
  raw: string
  value: number
  /** 配对单位：统计型为 FactUnit；结构型为原文单位（如「封」「页」）；无单位为 null */
  unit: string | null
  status: CitationStatus
  /** 命中（或冲突）关联的事实 id */
  factId?: string
  /** 中文说明：冲突/待核原因，可直接上屏 */
  reason?: string
  /** 命中 `{{值~来源}}` 标记（来源由作者提供） */
  cited?: boolean
  /** cited 时保留完整标记原文，便于 UI 展示出处 */
  marker?: string
  /** token 在原文中的起始下标（UI 高亮/定位用） */
  index: number
}

export interface CitationReport {
  checks: CitationCheck[]
  /** 参与校验的统计型 token 数（verified + derived + conflicts + unverified） */
  total: number
  verified: number
  /** verified 之外单列：命中派生值需标「派生」 */
  derived: number
  conflicts: number
  unverified: number
  /** 结构性数字（白名单，不参与溯源） */
  structural: number
  /** 无单位且推断不出指标的数字（序号/日期/版本等），不参与校验 */
  skipped: number
  /** 可溯源率 = (verified + derived) / total；无统计型数字时记 1 */
  coverage: number
  /** 无冲突且无待核 */
  ok: boolean
}

export interface ArtifactCitationEntry {
  artifactId: string
  title: string
  report: CitationReport
}

export interface ArtifactsCitationReport {
  artifacts: ArtifactCitationEntry[]
  /** 全部产物合并后的总报告 */
  all: CitationReport
}

/* ------------------------------------------------------------------ */
/* 词表                                                                */
/* ------------------------------------------------------------------ */

/** 数字后允许的单位（长的在前，避免「分钟」被当成「分」）；含结构性白名单单位 */
const UNIT_WORDS = [
  '百分点', '分钟', '小时', '个月',
  '封', '页', '题', '份', '件', '位', '名', '所', '节', '天', '周', '个', '门', '次', '张', '条',
  '项', '人', '年', '月', '日', '倍', '篇', '场', '轮', '道', '届', '期', '岁', '套', '家',
  '分', '%', '％',
]

const UNIT_LOOKAHEAD_RE = new RegExp(`^[ \\t]*(${UNIT_WORDS.join('|')})`)

/** 数字 token：前一个字符不能是数字/字母/点，避免把日期（2026-11-06）与 v1.1 拆成负数/小数 */
const NUMBER_RE = /(?<![\d.\w])[+\-−]?\d+(?:\.\d+)?/g

/** 与 src/lib/markdown.ts 的行内溯源标记一致：{{值~来源}} */
const MARKER_RE = /\{\{([^|~{}]+)~([^}]+)\}\}/g

/** 统计型单位（快照事实可能扩展「人/题/分钟」，故以快照实际单位为准） */
const STAT_UNITS = new Set(['分', '%', '百分点'])

/** 表示「变化」的词：出现即视为变化型数字（同指标异值 → 冲突） */
const DELTA_WORDS = [
  '较上次', '环比', '同比', '提升', '上升', '增长', '增加', '下降', '下滑',
  '减少', '降低', '变化', '涨幅', '跌幅', '退步', '相差', '差距', '高出', '低于',
]

type MetricKind = 'avg' | 'trend' | 'homework' | 'attention' | 'mastery' | 'derived' | 'other'

/** 指标词表：上下文出现这些词 → 定位到快照里的某一族指标（v1 快照键约定 + 中文标签兜底） */
const METRIC_RULES: { kind: MetricKind; keywords: string[] }[] = [
  { kind: 'derived', keywords: ['三科均分', '班级均分', '班级平均分', '三科'] },
  { kind: 'avg', keywords: ['均分', '平均分', '得分'] },
  { kind: 'other', keywords: ['优秀率', '及格率', '合格率', '优良率', '达标率', '覆盖率', '巩固率'] },
  { kind: 'homework', keywords: ['作业完成率', '作业'] },
  { kind: 'attention', keywords: ['课堂专注度', '专注度', '专注'] },
  { kind: 'mastery', keywords: ['掌握率', '函数单调性'] },
  { kind: 'trend', keywords: DELTA_WORDS },
]

/** 上下文窗口（字符）：指标词允许出现在数字前/后；变化词只看前面，避免把「较上次」误配给前一个数字 */
const CONTEXT_BEFORE = 18
const CONTEXT_AFTER = 14
const DELTA_BEFORE = 10

/**
 * 设计参数上下文（v1.1 P0-3 收窄口径）：分层比例（基础 70% / 提高 30%）、课时分配等是
 * 「交付参数」而非学情统计，按结构性白名单处理；同一行出现统计词（率/均分/掌握…）则不豁免。
 */
const PARAM_CONTEXT_WORDS = ['分层', '基础', '提高', '比例', '配比', '课时分配']
const STAT_CONTEXT_WORDS = ['率', '均分', '平均分', '完成', '掌握', '正确', '得分', '人数', '覆盖']

/** 是否为设计参数（非学情统计）：同一行有参数词、且数字附近没有统计词 */
function isDesignParam(text: string, start: number, end: number): boolean {
  const lineStart = text.lastIndexOf('\n', start) + 1
  const newline = text.indexOf('\n', end)
  const line = text.slice(lineStart, newline < 0 ? text.length : newline)
  if (!PARAM_CONTEXT_WORDS.some((w) => line.includes(w))) return false
  const local = text.slice(Math.max(0, start - 20), Math.min(text.length, end + 20))
  return !STAT_CONTEXT_WORDS.some((w) => local.includes(w))
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function approx(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9
}

function normalizeUnit(u: string): string {
  return u === '％' ? '%' : u
}

function parseNum(raw: string): number {
  return Number(raw.replace('−', '-'))
}

function isTrendFact(f: Fact): boolean {
  return f.unit === '百分点'
}

function fmtFact(f: Fact): string {
  return `${f.label} ${f.value}${f.unit}${f.derived ? '（派生）' : ''}`
}

function subjectOf(f: Fact): string | null {
  const i = f.label.indexOf('均分')
  return i > 0 && !f.derived ? f.label.slice(0, i) : null
}

interface KeywordGroup<T> {
  value: T
  keywords: string[]
}

interface KeywordHit<T> {
  value: T
  keyword: string
  distance: number
  before: boolean
}

/** 在数字前后两个上下文窗口里找「离数字最近」的指标词（同距离取更长词，再取前置） */
function findBestKeyword<T>(before: string, after: string, groups: KeywordGroup<T>[]): KeywordHit<T> | null {
  let best: KeywordHit<T> | null = null
  const better = (distance: number, keyword: string, beforeFlag: boolean): boolean => {
    if (!best) return true
    if (distance !== best.distance) return distance < best.distance
    if (keyword.length !== best.keyword.length) return keyword.length > best.keyword.length
    return beforeFlag && !best.before
  }
  for (const group of groups) {
    for (const kw of group.keywords) {
      const bIdx = before.lastIndexOf(kw)
      if (bIdx >= 0) {
        const distance = before.length - (bIdx + kw.length)
        if (better(distance, kw, true)) best = { value: group.value, keyword: kw, distance, before: true }
      }
      const aIdx = after.indexOf(kw)
      if (aIdx >= 0) {
        const distance = aIdx + 1
        if (better(distance, kw, false)) best = { value: group.value, keyword: kw, distance, before: false }
      }
    }
  }
  return best
}

function detectMetric(before: string, after: string): MetricKind | null {
  return findBestKeyword<MetricKind>(before, after, METRIC_RULES.map((r) => ({ value: r.kind, keywords: r.keywords })))?.value ?? null
}

/** 学科词从事实标签派生（物理均分 → 物理），不写死科目表；学科词优先取数字前的上下文 */
function detectSubject(before: string, after: string, facts: Fact[]): string | null {
  const subjects = new Set<string>()
  for (const f of facts) {
    const s = subjectOf(f)
    if (s) subjects.add(s)
  }
  if (subjects.size === 0) return null
  const groups = [...subjects].map((s) => ({ value: s, keywords: [s] }))
  const beforeHit = findBestKeyword(before, '', groups)
  if (beforeHit) return beforeHit.value
  return findBestKeyword('', after, groups)?.value ?? null
}

/** 按「指标族 + 学科」解析同指标候选事实（用于「同指标异值 → conflict」） */
function resolveEntityFacts(
  facts: Fact[],
  kind: MetricKind | null,
  subject: string | null,
  isDelta: boolean,
): Fact[] {
  switch (kind) {
    case 'avg': {
      if (!subject) return []
      return facts.filter((f) => !f.derived && !isTrendFact(f) && subjectOf(f) === subject)
    }
    case 'trend': {
      const trends = facts.filter(isTrendFact)
      return subject ? trends.filter((f) => subjectOf(f) === subject) : trends
    }
    case 'homework':
      return facts.filter((f) => f.key.includes('homework') || f.label.includes('作业'))
    case 'attention':
      return facts.filter((f) => f.label.includes('专注'))
    case 'mastery':
      return facts.filter((f) => f.label.includes('掌握'))
    case 'derived':
      return facts.filter((f) => f.derived === true)
    default:
      return isDelta ? facts.filter(isTrendFact) : []
  }
}

/* ------------------------------------------------------------------ */
/* 分类                                                                */
/* ------------------------------------------------------------------ */

interface Analysis {
  value: number
  /** 统计单位（结构型 token 不进入分类） */
  unit: FactUnit
  /** 原文显式单位（归一后），无则为 null */
  rawUnit: string | null
  isDelta: boolean
  metricKind: MetricKind | null
  subject: string | null
  entityFacts: Fact[]
}

interface Outcome {
  status: Exclude<CitationStatus, 'structural'>
  factId?: string
  reason?: string
}

function hitFact(f: Fact): Outcome {
  if (f.derived) {
    return { status: 'derived', factId: f.factId, reason: '派生值，引用时必须显式标注「派生」' }
  }
  return { status: 'verified', factId: f.factId }
}

function summarizeTrends(facts: Fact[]): string {
  const trends = facts.filter(isTrendFact)
  if (trends.length === 0) return '快照无环比数据'
  return trends.map((f) => `${f.label} ${f.value >= 0 ? '+' : ''}${f.value}${f.unit}`).join('、')
}

/** 变化型数字（+2.1 / -1.4 / 环比…）：应与快照的 trend 事实一致，否则就是口径冲突 */
function classifyDelta(a: Analysis, facts: Fact[]): Outcome {
  const allTrends = facts.filter(isTrendFact)
  const pool = a.subject ? allTrends.filter((f) => subjectOf(f) === a.subject) : allTrends

  if (a.rawUnit === '%') {
    return {
      status: 'conflict',
      reason: `口径冲突：变化值应使用「百分点」而不是 %（快照：${summarizeTrends(facts)}）`,
    }
  }
  const hit = pool.find((f) => approx(f.value, a.value))
  if (hit) return hitFact(hit)
  return {
    status: 'conflict',
    reason: `口径冲突：变化值与快照环比不符（快照：${summarizeTrends(facts)}）`,
  }
}

function classifyStat(a: Analysis, facts: Fact[]): Outcome {
  const unit = a.unit

  /* 1) 百分比 >100：dataContext 旧 bug 的典型形态（9100% / 9300%），先于其他规则判冲突 */
  if (unit === '%' && a.value > 100) {
    const scaled = facts.find((f) => f.unit === '%' && approx(f.value * 100, a.value))
    return {
      status: 'conflict',
      reason: scaled
        ? `口径冲突：百分比超过 100%，疑似重复 ×100（快照「${scaled.label}」为 ${scaled.value}%）`
        : '口径冲突：百分比超过 100%，疑似重复 ×100',
    }
  }

  /* 2) 指标不在快照内（优秀率/及格率…）：无据 → 待核，不与快照做同指标冲突 */
  if (a.metricKind === 'other') {
    return { status: 'unverified', reason: '该指标不在事实快照内（待核）' }
  }

  /* 3) 变化型数字 */
  if (a.isDelta) return classifyDelta(a, facts)

  /* 4) 上下文能定位到具体指标 → 同指标异值即冲突 */
  if (a.entityFacts.length > 0) {
    const exact = a.entityFacts.find((f) => f.unit === unit && approx(f.value, a.value))
    if (exact) return hitFact(exact)
    const sameValue = a.entityFacts.find((f) => approx(f.value, a.value))
    if (sameValue) {
      return {
        status: 'conflict',
        reason: `口径冲突：单位不符（快照「${sameValue.label}」为 ${sameValue.value}${sameValue.unit}）`,
      }
    }
    return {
      status: 'conflict',
      reason: `口径冲突：与快照不一致（快照：${a.entityFacts.map(fmtFact).join('、')}）`,
    }
  }

  /* 5) 全局：同值同单位命中 */
  const exact = facts.find((f) => f.unit === unit && approx(f.value, a.value))
  if (exact) return hitFact(exact)

  /* 6) 同值异单位（2.1% 写成 百分点 之类的单位混用） */
  const sameValue = facts.find((f) => approx(f.value, a.value))
  if (sameValue) {
    return {
      status: 'conflict',
      reason: `口径冲突：单位不符（快照「${sameValue.label}」为 ${sameValue.value}${sameValue.unit}）`,
    }
  }

  /* 7) 数量级异常（重复 ×100 的漏网形态） */
  const scaled = facts.find(
    (f) => f.unit === unit && (approx(f.value * 100, a.value) || approx(f.value / 100, a.value)),
  )
  if (scaled) {
    return {
      status: 'conflict',
      reason: `口径冲突：疑似重复 ×100（快照「${scaled.label}」为 ${scaled.value}${scaled.unit}）`,
    }
  }

  return { status: 'unverified', reason: '快照中无此统计数字出处（待核）' }
}

/* ------------------------------------------------------------------ */
/* 单段文本校验                                                        */
/* ------------------------------------------------------------------ */

function buildReport(checks: CitationCheck[], skipped: number): CitationReport {
  const sorted = [...checks].sort((x, y) => x.index - y.index)
  let verified = 0
  let derived = 0
  let conflicts = 0
  let unverified = 0
  let structural = 0
  for (const c of sorted) {
    if (c.status === 'verified') verified += 1
    else if (c.status === 'derived') derived += 1
    else if (c.status === 'conflict') conflicts += 1
    else if (c.status === 'unverified') unverified += 1
    else structural += 1
  }
  const total = verified + derived + conflicts + unverified
  return {
    checks: sorted,
    total,
    verified,
    derived,
    conflicts,
    unverified,
    structural,
    skipped,
    coverage: total === 0 ? 1 : (verified + derived) / total,
    ok: conflicts === 0 && unverified === 0,
  }
}

/** 校验一段正文（Markdown / 纯文本）里的数字；facts 为本次 mission 冻结的快照 */
export function verifyCitations(text: string, facts: Fact[]): CitationReport {
  const checks: CitationCheck[] = []
  let skipped = 0

  /* 1) `{{值~来源}}` 标记：人工溯源通道，直接视为已验证 */
  const markerSpans: { start: number; end: number }[] = []
  const markers = text.matchAll(MARKER_RE)
  for (const m of markers) {
    const start = m.index ?? 0
    const end = start + m[0].length
    markerSpans.push({ start, end })
    const valueText = (m[1] ?? '').trim()
    const numMatch = /[+\-−]?\d+(?:\.\d+)?/.exec(valueText)
    if (!numMatch) continue
    const value = parseNum(numMatch[0])
    const unitStr = /％|%/.test(valueText)
      ? '%'
      : /百分点/.test(valueText)
        ? '百分点'
        : /分/.test(valueText)
          ? '分'
          : null
    const fact =
      (unitStr ? facts.find((f) => f.unit === unitStr && approx(f.value, value)) : undefined) ??
      facts.find((f) => approx(f.value, value))
    checks.push({
      raw: numMatch[0],
      value,
      unit: fact?.unit ?? unitStr,
      status: fact?.derived ? 'derived' : 'verified',
      factId: fact?.factId,
      reason: fact ? undefined : '人工溯源标记（出处由作者提供）',
      cited: true,
      marker: m[0],
      index: start,
    })
  }

  const inMarkerSpan = (idx: number, end: number): boolean =>
    markerSpans.some((s) => idx >= s.start && end <= s.end)

  /* 2) 数字 token：按单位配对 + 上下文指标推断 */
  const factUnits = new Set<string>(facts.map((f) => f.unit))
  const numbers = text.matchAll(NUMBER_RE)
  for (const m of numbers) {
    const start = m.index ?? 0
    const raw = m[0]
    const end = start + raw.length
    if (inMarkerSpan(start, end)) continue

    const value = parseNum(raw)
    const unitMatch = UNIT_LOOKAHEAD_RE.exec(text.slice(end))
    const rawUnitText = unitMatch ? normalizeUnit(unitMatch[1] ?? '') : null

    /* 序数/日期形态（`2. 数据`、`（3）班`、`2026-11-06`）：无单位时直接跳过，
       否则会被后面的指标词误配成统计数字（如列表序号 4 配到「函数单调性 61%」）。
       带正负号的数字（（-1.4）、（+2.1））是取值，不适用序数规则。 */
    if (!rawUnitText && !/^[+\-−]/.test(raw)) {
      const afterRaw = text.slice(end)
      const beforeRaw = text.slice(0, start)
      const ordinalLike = /^[ \t]*([.．、:：]|[-/](?=\d))/.test(afterRaw)
      const listParen = /[）)]/.test(afterRaw.charAt(0)) && /[（(]$/.test(beforeRaw) && raw.replace(/[^\d]/g, '').length <= 2
      if (ordinalLike || listParen) {
        skipped += 1
        continue
      }
    }

    /* 结构性白名单：单位不在统计口径（且快照未使用）→ 不参与溯源 */
    if (rawUnitText && !STAT_UNITS.has(rawUnitText) && !factUnits.has(rawUnitText)) {
      checks.push({
        raw,
        value,
        unit: rawUnitText,
        status: 'structural',
        index: start,
      })
      continue
    }

    const before = text.slice(Math.max(0, start - CONTEXT_BEFORE), start)
    const after = text.slice(end, end + CONTEXT_AFTER)
    const deltaBefore = text.slice(Math.max(0, start - DELTA_BEFORE), start)

    const signed = /^[+\-−]/.test(raw)
    const deltaWord = DELTA_WORDS.some((w) => deltaBefore.includes(w))
    const isDelta = signed || rawUnitText === '百分点' || deltaWord

    let metricKind = detectMetric(before, after)
    if (metricKind === 'trend' && !isDelta) metricKind = null
    const subject = detectSubject(before, after, facts)

    /* 无单位数字 → 按上下文推断单位；推断不出则 skipped（序号/日期/版本等） */
    let unit: FactUnit
    if (rawUnitText) {
      unit = rawUnitText as FactUnit
    } else if (isDelta) {
      unit = '百分点'
    } else if (metricKind === 'avg' || metricKind === 'derived' || (subject && metricKind === null)) {
      unit = '分'
    } else if (metricKind === 'homework' || metricKind === 'attention' || metricKind === 'mastery') {
      unit = '%'
    } else {
      const ctx = before + after
      if (/均分|平均分|得分/.test(ctx)) unit = '分'
      else if (/率|占比|比例/.test(ctx)) unit = '%'
      else {
        skipped += 1
        continue
      }
    }

    let kind = metricKind
    if (!kind && subject && unit === '分' && !isDelta) kind = 'avg'
    if (!kind && isDelta && subject) kind = 'trend'

    /* 设计参数（分层比例等）：非学情统计 → 结构性白名单。
       注意百分比 >100 仍先按口径冲突处理，不允许借「参数」名义绕过 ×100 检查。 */
    if (unit === '%' && value >= 0 && value <= 100 && isDesignParam(text, start, end)) {
      checks.push({
        raw,
        value,
        unit,
        status: 'structural',
        reason: '设计参数（非学情统计）',
        index: start,
      })
      continue
    }

    const analysis: Analysis = {
      value,
      unit,
      rawUnit: rawUnitText,
      isDelta,
      metricKind: kind,
      subject,
      entityFacts: resolveEntityFacts(facts, kind, subject, isDelta),
    }
    const outcome = classifyStat(analysis, facts)
    checks.push({
      raw,
      value,
      unit,
      status: outcome.status,
      factId: outcome.factId,
      reason: outcome.reason,
      index: start,
    })
  }

  return buildReport(checks, skipped)
}

/** 批量校验产物（data.ts 全量扫描 / planner 产物校验用）；纯函数，不依赖具体数据源 */
export function verifyArtifactCitations(artifacts: ArtifactTile[], facts: Fact[]): ArtifactsCitationReport {
  const entries: ArtifactCitationEntry[] = artifacts.map((a) => ({
    artifactId: a.id,
    title: a.title,
    report: verifyCitations(a.markdown, facts),
  }))
  const checks = entries.reduce<CitationCheck[]>((acc, e) => acc.concat(e.report.checks), [])
  const skipped = entries.reduce((acc, e) => acc + e.report.skipped, 0)
  return { artifacts: entries, all: buildReport(checks, skipped) }
}
