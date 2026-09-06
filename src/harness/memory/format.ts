import type { MemoryEntry, MemoryOutcome } from '../types'

/**
 * 记忆注入文本组装（v0.9.1 注入 A，纯函数）：
 * - 情景 ≤3 条，每条 ≤60 字，格式 `9月4日：五年级分数乘法出题（已采纳）`；
 * - 语义偏好 ≤6 条，按置信度降序，key 尾段映射为友好文案；
 * - 空输入返回空串——调用方据此跳过拼接，保证无记忆时 systemPrompt 与现状逐字节一致。
 * 注入块总量 <400 字符，控制 systemPrompt token 增量。
 */

const EPISODIC_MAX = 3
const SEMANTIC_MAX = 6
const LINE_MAX = 60

const OUTCOME_LABEL: Record<MemoryOutcome, string> = {
  accepted: '已采纳',
  rejected: '未采纳',
  edited: '修改后采纳',
  executed: '已完成',
}

function clip(text: string, max = LINE_MAX): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

function fmtDate(t: number): string {
  const d = new Date(t)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 语义偏好 key 尾段 → 用户可读文案（规则表，导出行为经单测固化） */
function semanticLine(key: string, value: unknown): string {
  if (key.endsWith('.pref.quiz.count')) return `出题默认 ${String(value)} 题`
  if (key.endsWith('.pref.lessonPlan.minutes')) return `教案课时偏好 ${String(value)} 分钟`
  if (key.endsWith('.pref.export.format')) {
    return String(value) === 'docx' ? '导出优先使用 Word' : `导出优先使用 ${String(value)}`
  }
  if (key.endsWith('.avoid.last')) return `上次「${String(value)}」未达预期，避免同风格`
  const tag = key.match(/\.pref\.card\.tag\.(.+)$/)
  if (tag && value) return `关注「${tag[1]}」类卡片`
  const tail = key.split('.').pop() ?? key
  const v = typeof value === 'boolean' ? (value ? '是' : '否') : String(value ?? '')
  return `${tail}：${v}`
}

/** 情景记忆 → 注入行（≤3 条，导出供单测与 buildSystemPrompt 复用） */
export function formatEpisodicLines(entries: MemoryEntry[]): string[] {
  return entries.slice(0, EPISODIC_MAX).map((e) => {
    const outcome = e.outcome ? `（${OUTCOME_LABEL[e.outcome]}）` : ''
    return `${fmtDate(e.t)}：${clip(e.goal ?? '（无目标）')}${outcome}`
  })
}

/** 语义偏好 → 注入行（≤6 条，置信度降序；导出供单测与 buildSystemPrompt 复用） */
export function formatSemanticLines(entries: MemoryEntry[]): string[] {
  return entries
    .slice()
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, SEMANTIC_MAX)
    .map((e) => (e.key ? semanticLine(e.key, e.value) : clip(String(e.value ?? ''))))
}

/** 组装「【场景记忆】/【用户偏好】」完整注入块；两段皆空返回空串 */
export function formatMemoryBlock(episodic: MemoryEntry[], semantic: MemoryEntry[]): string {
  const epi = formatEpisodicLines(episodic)
  const sem = formatSemanticLines(semantic)
  if (!epi.length && !sem.length) return ''
  const parts: string[] = []
  if (epi.length) parts.push(`【场景记忆】\n${epi.map((l) => `- ${l}`).join('\n')}`)
  if (sem.length) parts.push(`【用户偏好】\n${sem.map((l) => `- ${l}`).join('\n')}`)
  return parts.join('\n\n')
}
