import type { RoleId } from '../types'
import type { ScriptStep } from '../scripts/agent'

/** 技能来源：builtin = 由内置剧本派生；learned = 任务执行后自动沉淀 */
export type SkillOrigin = 'builtin' | 'learned'

/** 使用统计（Hermes 式可观测指标） */
export interface SkillStats {
  usageCount: number
  successCount: number
  lastUsedAt: number
}

export const EMPTY_STATS: SkillStats = { usageCount: 0, successCount: 0, lastUsedAt: 0 }

/** 进化日志条目：created 新建 / refined 复用中触发词扩充 / feedback 反馈修正 */
export interface SkillEvolutionEntry {
  at: number
  version: number
  kind: 'created' | 'refined' | 'feedback'
  note: string
}

/**
 * 技能（Self-Evolving Skills 核心契约，v0.6 M1①）。
 * steps 复用剧本步骤体系（ScriptStep），与 AGENT_SCRIPTS 同构，执行器零改动。
 */
export interface Skill {
  id: string
  name: string
  description: string
  roles: RoleId[]
  /** 触发词（小写包含匹配：goal 含任一触发词即命中） */
  triggers: string[]
  steps: ScriptStep[]
  origin: SkillOrigin
  version: number
  enabled: boolean
  stats: SkillStats
  evolution: SkillEvolutionEntry[]
  createdAt: number
  updatedAt: number
}

/** 学习技能上限：防技能库无限膨胀（超出时淘汰最久未用） */
export const MAX_LEARNED_SKILLS = 50

/** 单技能触发词上限（去重合并时截断） */
export const MAX_TRIGGERS = 8
