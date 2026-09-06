import { create } from 'zustand'
import type { MemoryEntry, RoleId } from '../harness/types'
import { loadJSON, saveJSON } from '../lib/storage'

/**
 * 记忆分层状态（v0.9.1，设计文档「记忆分层」落地）：
 * - L2 情景记忆（episodic）：环形上限 200 条，"上次做过什么"时间轴；
 * - L3 语义偏好（semantic）：key → 条目（键以 `${role}.` 前缀隔离角色），"这个用户偏好什么"；
 * - 持久化单键 `edustudio:memory`（设计文档双键合并为单键，对齐 v0.9 备份白名单机制）；
 * - 纯函数（extractPrefs / selectEpisodicRole / selectSemanticRole）导出供单测与 Provider 复用。
 */

/** L2 情景记忆环形上限（设计文档：200 条） */
export const EPISODIC_LIMIT = 200

/** 语义偏好置信度步长与封顶（同 value 重复印证加权） */
const CONF_STEP = 0.05
const CONF_MAX = 0.99

function clamp01(v: number | undefined, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.min(1, Math.max(0, v))
}

/** 语义合并（导出供单测）：同 value 加权印证；异 value 高置信度胜出（相等取新，败方置信度衰减 ×0.5 可被后续证据覆盖） */
export function mergeSemantic(existing: MemoryEntry | undefined, next: MemoryEntry): MemoryEntry {
  const conf = clamp01(next.confidence, 0.6)
  if (!existing) return { ...next, confidence: conf }
  const sameValue = JSON.stringify(existing.value) === JSON.stringify(next.value)
  if (sameValue) {
    const oldConf = clamp01(existing.confidence, 0.5)
    return {
      ...existing,
      t: next.t,
      ref: next.ref ?? existing.ref,
      confidence: Math.min(CONF_MAX, Math.max(oldConf, oldConf + CONF_STEP)),
    }
  }
  const oldConf = clamp01(existing.confidence, 0.5)
  if (conf > oldConf) return { ...next, confidence: conf }
  if (conf < oldConf) return { ...existing, confidence: oldConf * 0.5 }
  return { ...next, confidence: conf }
}

/**
 * 偏好提炼规则（v0.9.1，规则版零 LLM 成本，导出供单测）：
 * accept/edited → 正例（出题数量 / 课时分钟 / 导出格式）；rejected → 负例（避免同风格摘要）；
 * executed（任务完成）→ 仅情景记忆，不提炼。
 */
export function extractPrefs(entry: MemoryEntry): MemoryEntry[] {
  if (entry.kind !== 'episodic' || !entry.goal) return []
  const out: MemoryEntry[] = []
  const base = { t: entry.t, role: entry.role, kind: 'semantic' as const, ref: entry.ref }
  const goal = entry.goal
  const positive = entry.outcome === 'accepted' || entry.outcome === 'edited'
  if (positive) {
    const quiz = goal.match(/(\d{1,4})\s*(?:道)?题/)
    if (quiz) out.push({ ...base, key: `${entry.role}.pref.quiz.count`, value: Number(quiz[1]), confidence: 0.8 })
    const minutes = goal.match(/(\d{1,3})\s*分钟/)
    if (minutes && /教案|课时|课堂/.test(goal)) {
      out.push({ ...base, key: `${entry.role}.pref.lessonPlan.minutes`, value: Number(minutes[1]), confidence: 0.8 })
    }
    if (/word|docx|doc\b/i.test(goal)) {
      out.push({ ...base, key: `${entry.role}.pref.export.format`, value: 'docx', confidence: 0.8 })
    }
  }
  if (entry.outcome === 'rejected') {
    out.push({ ...base, key: `${entry.role}.avoid.last`, value: goal.slice(0, 24), confidence: 0.6 })
  }
  return out
}

/** 情景按角色过滤 + 时间倒序取前 limit 条（导出供单测） */
export function selectEpisodicRole(entries: MemoryEntry[], role: RoleId, limit = 3): MemoryEntry[] {
  return entries
    .filter((e) => e.role === role)
    .sort((a, b) => b.t - a.t)
    .slice(0, Math.max(0, limit))
}

/** 语义按 `${role}.` 前缀过滤 + 置信度降序（导出供单测） */
export function selectSemanticRole(map: Record<string, MemoryEntry>, role: RoleId): MemoryEntry[] {
  const prefix = `${role}.`
  return Object.values(map)
    .filter((e) => typeof e.key === 'string' && e.key.startsWith(prefix))
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
}

interface PersistedMemory {
  episodic: MemoryEntry[]
  semantic: Record<string, MemoryEntry>
}

interface MemoryState {
  episodic: MemoryEntry[]
  semantic: Record<string, MemoryEntry>
  /** 记录情景记忆（环形裁剪 limit 条，超限淘汰最旧） */
  recordEpisodic: (entry: MemoryEntry, limit?: number) => void
  /** 合并语义偏好（同 key 走 mergeSemantic 策略） */
  upsertSemantic: (entry: MemoryEntry) => void
  /** 清空全部记忆（设置页「一键清空」覆盖，不新增管理 UI） */
  clear: () => void
}

const persisted = loadJSON<PersistedMemory>('memory', { episodic: [], semantic: {} })

function persist(s: { episodic: MemoryEntry[]; semantic: Record<string, MemoryEntry> }): void {
  saveJSON('memory', { episodic: s.episodic, semantic: s.semantic })
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  episodic: persisted.episodic ?? [],
  semantic: persisted.semantic ?? {},

  recordEpisodic: (entry, limit = EPISODIC_LIMIT) => {
    const episodic = [...get().episodic, entry].slice(-limit)
    set({ episodic })
    persist({ episodic, semantic: get().semantic })
  },

  upsertSemantic: (entry) => {
    if (!entry.key) return
    const semantic = { ...get().semantic, [entry.key]: mergeSemantic(get().semantic[entry.key], entry) }
    set({ semantic })
    persist({ episodic: get().episodic, semantic })
  },

  clear: () => {
    set({ episodic: [], semantic: {} })
    persist({ episodic: [], semantic: {} })
  },
}))
