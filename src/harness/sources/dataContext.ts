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
import {
  getSourceProvider,
  formatAge,
  type ClassProfileResult,
  type RegionResult,
  type SchoolOverviewResult,
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
