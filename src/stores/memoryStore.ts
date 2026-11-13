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

/* ------------------------------------------------------------------ */
/* v1.2 M2 · Agent 记忆命名空间（roadmap §2.3 F5 / §2.4 / §3.5）         */
/* 维度：MemoryEntry.agentId?（Lead 已加）。语义键约定 `agent.<id>.*`，   */
/* 与角色层 `${role}.*` 并行、互不污染；旧选择器与旧写入行为字节级不变。   */
/* ------------------------------------------------------------------ */

/** Agent 语义键命名空间：`agent.<id>.<key>`（导出供单测 / Provider 复用） */
export function agentSemanticKey(agentId: string, key: string): string {
  return `agent.${agentId}.${key}`
}

/** 命名空间前缀（内部工具） */
function agentKeyPrefix(agentId: string): string {
  return `agent.${agentId}.`
}

/** 情景按 agentId 过滤 + 时间倒序取前 limit 条（默认 3；导出供单测） */
export function selectEpisodicAgent(entries: MemoryEntry[], agentId: string, limit = 3): MemoryEntry[] {
  return entries
    .filter((e) => e.agentId === agentId)
    .sort((a, b) => b.t - a.t)
    .slice(0, Math.max(0, limit))
}

/**
 * 语义按 `agent.<id>.` 前缀过滤 + 置信度降序（导出供单测）。
 * 返回条目的 key 已剥离命名空间前缀（展示口径，如 'pref.quiz.count'），agentId 原样保留。
 */
export function selectSemanticAgent(map: Record<string, MemoryEntry>, agentId: string): MemoryEntry[] {
  const prefix = agentKeyPrefix(agentId)
  return Object.values(map)
    .filter((e) => typeof e.key === 'string' && e.key.startsWith(prefix))
    .map((e) => ({ ...e, key: e.key!.slice(prefix.length) }))
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
}

/** 从 `agent.<id>.<key>` 剥离命名空间，返回 `<key>`；非命名空间键原样返回（展示/聚合用） */
export function stripAgentSemanticKey(key: string): string {
  const matched = /^agent\.[^.]+\.([\s\S]+)$/.exec(key)
  return matched ? matched[1] : key
}

/** 「已学会」只读聚合（战队页 TeamView 用；导出供单测）：成员数 + 最近一条 key/goal */
export interface AgentLearningSummary {
  /** 已积累经验的成员数（semantic 命名空间键或带 agentId 的情景记忆任一命中即计） */
  agents: number
  /** 最近一条经验（语义键剥离前缀；无语义时回退最近一条情景目标）；无数据为 null */
  recent: string | null
}

/**
 * 按 agentId 聚合记忆（v1.2 M2 F5「已学会」，只读、不新增依赖）：
 * - 成员数 = semantic `agent.<id>.*` 键的 agentId 集合 ∪ episodic 带 agentId 的集合；
 * - recent = 时间最新的语义条目（剥离前缀）或情景目标（无 key 时），无数据 → null。
 */
export function summarizeAgentLearning(
  semantic: Record<string, MemoryEntry>,
  episodic: MemoryEntry[],
): AgentLearningSummary {
  const agentIds = new Set<string>()
  let latest: MemoryEntry | null = null

  for (const entry of Object.values(semantic)) {
    if (typeof entry.key !== 'string') continue
    const matched = /^agent\.([^.]+)\.([\s\S]+)$/.exec(entry.key)
    if (!matched) continue
    agentIds.add(matched[1])
    if (!latest || (entry.t ?? 0) > (latest.t ?? 0)) latest = entry
  }
  for (const entry of episodic) {
    if (!entry.agentId) continue
    agentIds.add(entry.agentId)
    if (!latest || (entry.t ?? 0) > (latest.t ?? 0)) latest = entry
  }

  const recent = latest
    ? latest.kind === 'semantic' && latest.key
      ? stripAgentSemanticKey(latest.key)
      : latest.goal ?? null
    : null
  return { agents: agentIds.size, recent }
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
  /**
   * v1.2 M2：记录某执行成员的情景记忆（要求 entry.agentId；环形裁剪与旧口径一致）。
   * 缺 agentId 的条目直接忽略（不抛错，避免打断反馈回路）。
   */
  recordAgentEpisodic: (entry: MemoryEntry, limit?: number) => void
  /**
   * v1.2 M2：合并某执行成员的语义偏好（key 自动加 `agent.<id>.` 命名空间前缀；
   * 同 key 走旧 mergeSemantic 策略；缺 agentId / key 的条目忽略）。
   */
  upsertAgentSemantic: (entry: MemoryEntry) => void
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

  recordAgentEpisodic: (entry, limit = EPISODIC_LIMIT) => {
    if (!entry.agentId) return
    const episodic = [...get().episodic, entry].slice(-limit)
    set({ episodic })
    persist({ episodic, semantic: get().semantic })
  },

  upsertAgentSemantic: (entry) => {
    if (!entry.agentId || !entry.key) return
    /* key 已带本 Agent 命名空间时保持幂等（重复 upsert 不会出现 agent.x.agent.x.*） */
    const key = entry.key.startsWith(agentKeyPrefix(entry.agentId))
      ? entry.key
      : agentSemanticKey(entry.agentId, entry.key)
    const next: MemoryEntry = { ...entry, key }
    const semantic = { ...get().semantic, [key]: mergeSemantic(get().semantic[key], next) }
    set({ semantic })
    persist({ episodic: get().episodic, semantic })
  },

  clear: () => {
    set({ episodic: [], semantic: {} })
    persist({ episodic: [], semantic: {} })
  },
}))
