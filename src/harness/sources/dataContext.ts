/**
 * 数据上下文层（v0.8 M1①）
 *
 * 按角色聚合 SourceProvider 真实数据 → 结构化 prompt 文本，供 LLM 调用注入
 * （简报生成 / 文档生成），保证「数据驱动、不编造」：
 *  - teacher：班级学情（各科均分/作业完成率/专注度/薄弱点）
 *  - schoolAdmin：校情周趋势 + 结构化预警
 *  - bureau：区域指标（值/趋势/备注）
 *
 * 纯函数格式化（formatDataContext）与异步聚合（buildDataContext）分离，便于单测；
 * 单源失败不阻断（返回空段），总长有截断护栏控制 token 成本。
 */
import type { RoleId } from '../types'
import type { ClassLearning, RegionMetric, School, SchoolAlert } from '../../data/seed'
import { CLASSES, CLASS_LEARNING, SCHOOLS } from '../../data/seed'
import { useDataFocusStore } from '../../stores/dataFocusStore'
import {
  getSourceProvider,
  formatAge,
  type ClassProfileResult,
  type RegionResult,
  type SchoolOverviewResult,
  type SourceMeta,
  type SourceProvider,
} from './index'

/** 注入 prompt 的数据上下文总长上限（字符） */
export const DATA_CONTEXT_MAX_CHARS = 1800

/** 截断护栏：超长保留头部并标注 */
function clamp(text: string, max = DATA_CONTEXT_MAX_CHARS): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…（数据上下文过长已截断）`
}

/** 班级学情 → 文本段 */
export function formatClassProfile(res: ClassProfileResult): string {
  const { profile, meta } = res
  if (!profile) return '（暂无班级学情数据）'
  const subjects = profile.scores
    .map((s) => `${s.subject} 均分${s.avg}（及格率${Math.round(s.passRate * 100)}%、优秀率${Math.round(s.excellenceRate * 100)}%、环比${s.trend >= 0 ? '+' : ''}${s.trend}）`)
    .join('；')
  const weak = profile.weakPoints.length ? profile.weakPoints.join('、') : '无明显薄弱点'
  return [
    `【班级学情】（来源：${meta.label} · ${formatAge(meta.fetchedAt)}${meta.degraded ? ' · 降级演示数据' : ''}）`,
    `班级：${profile.className}（${profile.classId}）`,
    `各科：${subjects}`,
    `作业完成率：${Math.round(profile.homeworkCompletion * 100)}%；课堂专注度：${profile.attentionIndex}`,
    `薄弱点：${weak}`,
  ].join('\n')
}

/** 校情总览 → 文本段（趋势取最近 4 期，预警最多 5 条） */
export function formatSchoolOverview(res: SchoolOverviewResult): string {
  const { trend, alerts, meta } = res
  if (trend.length === 0 && alerts.length === 0) return '（暂无校情数据）'
  const lines = [`【校情数据】（来源：${meta.label} · ${formatAge(meta.fetchedAt)}${meta.degraded ? ' · 降级演示数据' : ''}）`]
  if (trend.length) {
    const recent = trend.slice(-4)
    lines.push(
      `近 ${recent.length} 周趋势：${recent.map((p) => `${p.week} 均分${p.avgScore}/作业${Math.round(p.homework * 100)}%/专注${p.attention}`).join(' → ')}`,
    )
  }
  if (alerts.length) {
    const levelLabel = { high: '高', mid: '中', low: '低' } as const
    lines.push(`预警（${alerts.length} 条，按级别）：`)
    for (const a of alerts.slice(0, 5)) {
      lines.push(`- [${levelLabel[a.level]}] ${a.className}：${a.title}（${a.detail}）`)
    }
  }
  return lines.join('\n')
}

/** 区域指标 → 文本段（最多 8 项） */
export function formatRegionMetrics(res: RegionResult): string {
  const { metrics, meta } = res
  if (metrics.length === 0) return '（暂无区域指标数据）'
  const lines = [`【区域指标】（来源：${meta.label} · ${formatAge(meta.fetchedAt)}${meta.degraded ? ' · 降级演示数据' : ''}）`]
  for (const m of metrics.slice(0, 8)) {
    lines.push(`- ${m.name}：${m.value}（环比${m.trend >= 0 ? '+' : ''}${m.trend}）${m.note}`)
  }
  return lines.join('\n')
}

/** 已取到的数据集合（按需传入，缺省段不输出） */
export interface DataContextInput {
  classProfile?: ClassProfileResult | null
  school?: SchoolOverviewResult | null
  region?: RegionResult | null
}

/** 纯函数：按角色把数据格式化为 prompt 文本（无任何可用数据 → 空串） */
export function formatDataContext(role: RoleId, data: DataContextInput): string {
  const parts: string[] = []
  if (role === 'teacher' && data.classProfile) parts.push(formatClassProfile(data.classProfile))
  if (role === 'schoolAdmin' && data.school) parts.push(formatSchoolOverview(data.school))
  if (role === 'bureau' && data.region) parts.push(formatRegionMetrics(data.region))
  if (parts.length === 0) return ''
  return clamp(parts.join('\n\n'))
}

/**
 * 异步聚合：按角色拉取所需数据源并格式化。
 * 容错：单源失败返回空串（LLM 调用方据此跳过数据段），绝不抛出。
 */
export async function buildDataContext(role: RoleId): Promise<string> {
  try {
    const sp = getSourceProvider()
    if (role === 'teacher') {
      const res = await sp.getClassProfile().catch(() => null)
      return formatDataContext(role, { classProfile: res })
    }
    if (role === 'schoolAdmin') {
      const res = await sp.getSchoolOverview().catch(() => null)
      return formatDataContext(role, { school: res })
    }
    const res = await sp.getRegionMetrics().catch(() => null)
    return formatDataContext(role, { region: res })
  } catch {
    return ''
  }
}

/* ---------- v0.9.5 P0-A/C：模板渲染数据上下文（结构化 + 溯源标注） ---------- */

/**
 * 文档模板渲染上下文。
 * 与 buildDataContext（prompt 文本）分开：这里给模板的是结构化数据，
 * 让报告按 REGION_METRICS / SCHOOL_ALERTS 逐项渲染，而不是誊抄一份冻结快照。
 */
export interface RenderContext {
  /** 区域指标（报告「总体情况 / 主要成效」） */
  metrics: RegionMetric[]
  /** 校情预警（报告「存在问题 / 原因分析 / 下一步建议」） */
  alerts: SchoolAlert[]
  /** 区域学校清单（口径校准：与区域看板同源） */
  schools: School[]
  /** 在线学情的班级数（监测覆盖面） */
  classCount: number
  /** 区域指标来源标注 */
  regionCite: string
  /** 校情预警来源标注 */
  schoolCite: string
  /** 聚焦范围（v0.9.5 P0-B）：为空即全区口径 */
  focus: RenderFocus | null
}

/** 报告聚焦到某校/某班时的明细（切下拉后报告数字随之变化的数据来源） */
export interface RenderFocus {
  schoolName: string
  className: string
  /** 聚焦班级学情；聚焦到学校但未选班级时为 null */
  profile: ClassLearning | null
  /** 聚焦范围数据来源标注 */
  cite: string
}

/** 来源元信息 → 脚注文案（v0.9.5 P0-C：降级状态如实显示） */
export function citeLabel(meta?: SourceMeta | null): string {
  if (!meta) return '未标注来源'
  return `${meta.label} · ${formatAge(meta.fetchedAt)}${meta.degraded ? ' · 服务不可用，取演示数据' : ''}`
}

/**
 * 溯源标记：把数字包成 hover 可见的带出处标记。
 * 渲染侧见 lib/markdown.ts 的 `{{值~来源}}` 行内规则。
 * 分隔符用 ~ 而非 |：报告会渲染成 Markdown 表格，| 会被表格解析器当成列分隔。
 */
export function cite(value: string | number, source: string): string {
  return `{{${value}~${source}}}`
}

/**
 * 异步聚合模板渲染所需的数据（区域 + 校情 + 当前聚焦范围）。
 * 容错：单源失败仍返回另一源；全失败返回 null，模板回退到无数字骨架。
 */
export async function buildRenderContext(): Promise<RenderContext | null> {
  try {
    const sp = getSourceProvider()
    const [region, school] = await Promise.all([
      sp.getRegionMetrics().catch(() => null),
      sp.getSchoolOverview().catch(() => null),
    ])
    if (!region && !school) return null
    const focus = await resolveFocus(sp)
    return {
      metrics: region?.metrics ?? [],
      alerts: school?.alerts ?? [],
      schools: SCHOOLS,
      classCount: CLASS_LEARNING.length,
      regionCite: citeLabel(region?.meta),
      schoolCite: citeLabel(school?.meta),
      focus,
    }
  } catch {
    return null
  }
}

/** 解析当前聚焦范围（v0.9.5 P0-B）：未选择时为 null，报告走全区口径 */
async function resolveFocus(sp: SourceProvider): Promise<RenderFocus | null> {
  const { schoolId, classId } = useDataFocusStore.getState()
  if (!schoolId && !classId) return null
  const school = SCHOOLS.find((s) => s.id === schoolId)
  if (classId) {
    const res = await sp.getClassProfile(classId).catch(() => null)
    /* SourceProvider 查不到时会回落第一条学情。若不校验 classId，
       「聚焦城南中学初二（3）班」会顶着高一（3）班的数字——正是本版要消灭的那类证伪。 */
    const profile = res?.profile?.classId === classId ? res.profile : null
    if (!school && !profile) return null
    return {
      schoolName: school?.name ?? '',
      className: profile?.className ?? CLASSES.find((c) => c.id === classId)?.name ?? '',
      profile,
      cite: citeLabel(res?.meta),
    }
  }
  if (!school) return null
  return { schoolName: school.name, className: '', profile: null, cite: '学校基础信息' }
}
