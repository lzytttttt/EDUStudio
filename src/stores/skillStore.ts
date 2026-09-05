import { create } from 'zustand'
import type { Skill } from '../harness/skills/types'
import { MAX_LEARNED_SKILLS } from '../harness/skills/types'
import { getBuiltinSkills, recordBuiltinUsage, getBuiltinUsage } from '../harness/skills/library'
import { loadJSON, saveJSON } from '../lib/storage'

/**
 * 技能库状态（v0.6 M1④）：
 * - 学习技能持久化（edustudio:skills）；内置技能由剧本派生（不落盘，stats 会话内有效）
 * - recordUsage 统一入口：按 origin 分流到持久化 store 或内置内存统计
 */
interface SkillState {
  learned: Skill[]
  addLearned: (skill: Skill) => void
  removeLearned: (id: string) => void
  /** 编辑触发词/启停（仅学习技能；内置技能仅支持启停外的只读展示） */
  updateLearned: (id: string, patch: Partial<Pick<Skill, 'triggers' | 'enabled' | 'name'>>) => void
  /** 用进化后的技能整体替换（版本+1，含进化日志） */
  replaceLearned: (skill: Skill) => void
  /** 统一使用统计入口：learned 走持久化，builtin 走内存 */
  recordUsage: (id: string, origin: Skill['origin'], success?: boolean) => void
  clearLearned: () => void
}

function persist(learned: Skill[]): void {
  saveJSON('skills', learned)
}

/** 超上限时淘汰最久未用（lastUsedAt 0 视为最旧） */
function evict(learned: Skill[]): Skill[] {
  if (learned.length <= MAX_LEARNED_SKILLS) return learned
  const sorted = [...learned].sort((a, b) => a.stats.lastUsedAt - b.stats.lastUsedAt)
  return sorted.slice(learned.length - MAX_LEARNED_SKILLS)
}

const persistedLearned = loadJSON<Skill[]>('skills', [])

export const useSkillStore = create<SkillState>((set, get) => ({
  learned: persistedLearned,

  addLearned: (skill) => {
    const learned = evict([...get().learned, skill])
    set({ learned })
    persist(learned)
  },

  removeLearned: (id) => {
    const learned = get().learned.filter((s) => s.id !== id)
    set({ learned })
    persist(learned)
  },

  updateLearned: (id, patch) => {
    const learned = get().learned.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: Date.now() } : s))
    set({ learned })
    persist(learned)
  },

  replaceLearned: (skill) => {
    const learned = get().learned.map((s) => (s.id === skill.id ? skill : s))
    set({ learned })
    persist(learned)
  },

  recordUsage: (id, origin, success = true) => {
    if (origin === 'builtin') {
      recordBuiltinUsage(id, success)
      return
    }
    const learned = get().learned.map((s) =>
      s.id === id
        ? {
            ...s,
            stats: {
              usageCount: s.stats.usageCount + 1,
              successCount: s.stats.successCount + (success ? 1 : 0),
              lastUsedAt: Date.now(),
            },
          }
        : s,
    )
    set({ learned })
    persist(learned)
  },

  clearLearned: () => {
    set({ learned: [] })
    persist([])
  },
}))

/** 全量技能视图：学习技能在前（检索优先级一致），内置技能在后 */
export function allSkills(learned: Skill[]): Skill[] {
  return [...learned, ...getBuiltinSkills()]
}

/** 技能统计读取：builtin 从内存统计取，learned 从技能本体取 */
export function statsOf(skill: Skill) {
  return skill.origin === 'builtin' ? getBuiltinUsage(skill.id) : skill.stats
}
