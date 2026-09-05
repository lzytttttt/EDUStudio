/**
 * 简报卡运行时校验（v0.7）
 *
 * LLM 输出不可信：逐卡校验字段与 payload 判别联合，非法字段丢弃/修正，
 * 整卡不合法返回 null（调用方过滤），保证进入 store 的卡片结构完整。
 */
import type { BriefingCard, CardLink, CardPayload, CardType, RoleId } from '../types'

const CARD_TYPES: readonly CardType[] = ['insight', 'decision', 'creation', 'todo', 'data', 'question']
const LINK_KINDS: readonly CardLink['kind'][] = ['source', 'task', 'favorite']

function asString(v: unknown, maxLen: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s.slice(0, maxLen) : null
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/* ---------- payload 校验：按 kind 判别，非法返回 null ---------- */

function validatePayload(raw: unknown): CardPayload | null {
  const p = asRecord(raw)
  if (!p) return null
  switch (p.kind) {
    case 'chart': {
      const title = asString(p.title, 60)
      if (!title || !Array.isArray(p.bars) || p.bars.length === 0) return null
      const bars = p.bars
        .slice(0, 8)
        .map((b) => {
          const bar = asRecord(b)
          if (!bar) return null
          const label = asString(bar.label, 12)
          const value = typeof bar.value === 'number' && Number.isFinite(bar.value) ? bar.value : null
          if (!label || value === null) return null
          return {
            label,
            value,
            ...(typeof bar.display === 'string' && bar.display ? { display: bar.display.slice(0, 12) } : {}),
            ...(bar.peak === true ? { peak: true } : {}),
          }
        })
        .filter((b): b is NonNullable<typeof b> => b !== null)
      return bars.length ? { kind: 'chart', title, bars } : null
    }
    case 'options': {
      if (!Array.isArray(p.options) || p.options.length === 0) return null
      const options = p.options
        .slice(0, 4)
        .map((o) => {
          const opt = asRecord(o)
          const text = opt ? asString(opt.text, 60) : null
          if (!text) return null
          const sub = opt ? asString(opt.sub, 60) : null
          return sub ? { text, sub } : { text }
        })
        .filter((o): o is NonNullable<typeof o> => o !== null)
      return options.length ? { kind: 'options', options } : null
    }
    case 'editable': {
      const text = asString(p.text, 2000)
      return text ? { kind: 'editable', text } : null
    }
    case 'todos': {
      if (!Array.isArray(p.todos) || p.todos.length === 0) return null
      const todos = p.todos
        .slice(0, 6)
        .map((t) => {
          const todo = asRecord(t)
          const text = todo ? asString(todo.text, 80) : null
          if (!text) return null
          const meta = todo ? asString(todo.meta, 30) : null
          return { text, ...(meta ? { meta } : {}), done: todo?.done === true }
        })
        .filter((t): t is NonNullable<typeof t> => t !== null)
      return todos.length ? { kind: 'todos', todos } : null
    }
    case 'expandable': {
      const title = asString(p.title, 60)
      const content = asString(p.content, 1200)
      return title && content ? { kind: 'expandable', title, content } : null
    }
    default:
      return null
  }
}

function validateAction(raw: unknown): BriefingCard['action'] {
  const a = asRecord(raw)
  if (!a || a.kind !== 'openTask') return undefined
  const goal = asString(a.goal, 200)
  return goal ? { kind: 'openTask', goal } : undefined
}

function validateLink(raw: unknown): CardLink | undefined {
  const l = asRecord(raw)
  if (!l || !LINK_KINDS.includes(l.kind as CardLink['kind'])) return undefined
  const label = asString(l.label, 30)
  if (!label) return undefined
  const goal = asString(l.goal, 200)
  return { kind: l.kind as CardLink['kind'], label, ...(goal ? { goal } : {}) }
}

/**
 * 逐卡校验：必填字段（id/type/title/body）缺失或类型不符 → null（整卡丢弃）；
 * 可选字段（tag/confidence/payload/action/link）非法时修正或省略，不整卡失败。
 */
export function validateBriefingCard(raw: unknown, role: RoleId): BriefingCard | null {
  const r = asRecord(raw)
  if (!r) return null
  const id = asString(r.id, 64)
  const type = CARD_TYPES.includes(r.type as CardType) ? (r.type as CardType) : null
  const title = asString(r.title, 120)
  const body = asString(r.body, 600)
  if (!id || !type || !title || !body) return null

  const payload = validatePayload(r.payload)
  const action = validateAction(r.action)
  const link = validateLink(r.link)
  const confidence = r.confidence === 1 || r.confidence === 2 || r.confidence === 3 ? r.confidence : 2

  return {
    id,
    role,
    type,
    tag: asString(r.tag, 8) ?? 'AI',
    title,
    body,
    confidence,
    source: asString(r.source, 60) ?? 'AI 生成',
    ...(payload ? { payload, extra: payload.kind } : {}),
    ...(action ? { action } : {}),
    ...(link ? { link } : {}),
  }
}

/**
 * 从 LLM 文本输出中提取 JSON 卡片数组：
 * 容忍 ```json 代码块包裹与前后缀噪声；解析失败或非数组返回 null。
 */
export function extractJsonArray(text: string): unknown[] | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = (fenced?.[1] ?? text).trim()
  const start = candidate.indexOf('[')
  const end = candidate.lastIndexOf(']')
  if (start === -1 || end <= start) return null
  try {
    const parsed: unknown = JSON.parse(candidate.slice(start, end + 1))
    return Array.isArray(parsed) ? parsed : null
  } catch (err) {
    console.warn('[briefing] JSON 解析失败:', (err as Error)?.message)
    return null
  }
}
