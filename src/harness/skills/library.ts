import type { RoleId } from '../types'
import { AGENT_SCRIPTS } from '../scripts/agent'
import type { Skill, SkillStats } from './types'
import { EMPTY_STATS } from './types'

/** 内置技能展示元数据（id 对齐剧本 id；名称/描述用于技能库面板与轨迹徽标） */
const SCRIPT_META: Record<string, { name: string; description: string }> = {
  'teacher-combo-pipeline': { name: '学情定位组合任务', description: '查学情 → 分层试题 → 习题课教案一条龙' },
  'admin-parallel-compare': { name: '两班对比分析', description: '并行调取两班学情与校情，交叉对比出报告' },
  'teacher-weakpoint-drill': { name: '薄弱点分层练习', description: '定位薄弱知识点，命制 A/B/C 分层试题并配教案' },
  'teacher-lesson-plan': { name: '教案生成', description: '按课标生成五环节教案骨架与可编辑文档' },
  'teacher-parent-talk': { name: '家长会讲稿', description: '基于班级数据生成四段结构家长会讲稿' },
  'admin-support-plan': { name: '教学质量帮扶方案', description: '核查预警数据，起草含证据链的帮扶方案' },
  'admin-briefing': { name: '治理简报', description: '汇总校情统计与预警，生成治理简报' },
  'admin-notice': { name: '通知与方案文稿', description: '检索政策依据后起草通知/方案文稿' },
  'admin-lesson-review': { name: '评课分析', description: '五维评课数据汇总与改进建议报告' },
  'bureau-quarter-report': { name: '季度质量报告', description: '区域指标 + 政策口径核对后起草季度报告' },
  'bureau-supervision': { name: '督导通知', description: '检索政策依据，起草专项督导通知' },
  'bureau-training-plan': { name: '培训实施方案', description: '核对政策要求，起草培训实施方案/评审意见' },
}

/** 内置技能（builtin）：由 AGENT_SCRIPTS 派生，单一事实源，不持久化（stats 会话内有效） */
export function buildBuiltinSkills(): Skill[] {
  const now = Date.now()
  return AGENT_SCRIPTS.map((s) => {
    const meta = SCRIPT_META[s.id] ?? { name: s.id, description: '内置剧本技能' }
    return {
      id: s.id,
      name: meta.name,
      description: meta.description,
      roles: [...s.roles],
      triggers: [...s.match],
      steps: s.steps,
      origin: 'builtin' as const,
      version: 1,
      enabled: true,
      stats: { ...EMPTY_STATS },
      evolution: [{ at: now, version: 1, kind: 'created' as const, note: '内置剧本派生' }],
      createdAt: now,
      updatedAt: now,
    }
  })
}

/** 内置技能单例（模块级缓存；stats 更新走 recordBuiltinUsage） */
let builtins: Skill[] | null = null

export function getBuiltinSkills(): Skill[] {
  if (!builtins) builtins = buildBuiltinSkills()
  return builtins
}

/** 内置技能使用统计（会话内有效，不持久化） */
const builtinUsage = new Map<string, SkillStats>()

export function recordBuiltinUsage(id: string, success = true): void {
  const cur = builtinUsage.get(id) ?? { ...EMPTY_STATS }
  cur.usageCount += 1
  if (success) cur.successCount += 1
  cur.lastUsedAt = Date.now()
  builtinUsage.set(id, cur)
}

export function getBuiltinUsage(id: string): SkillStats {
  return builtinUsage.get(id) ?? { ...EMPTY_STATS }
}

/**
 * 技能检索（v0.6 M1②）：goal 包含任一触发词即命中（仅 enabled 且角色匹配）。
 * 排序：学习技能优先于内置 → 使用次数多优先 → 版本高优先。
 */
export function matchSkill(role: RoleId, goal: string, learned: Skill[]): Skill | null {
  const g = goal.toLowerCase()
  const all = [...learned, ...getBuiltinSkills()]
  const hits = all.filter(
    (s) => s.enabled && s.roles.includes(role) && s.triggers.some((t) => t && g.includes(t.toLowerCase())),
  )
  if (hits.length === 0) return null
  hits.sort((a, b) => {
    if (a.origin !== b.origin) return a.origin === 'learned' ? -1 : 1
    if (b.stats.usageCount !== a.stats.usageCount) return b.stats.usageCount - a.stats.usageCount
    return b.version - a.version
  })
  return hits[0]
}

/** 技能步骤摘要（API 模式注入 system prompt 用；一行一步，最多 6 行） */
export function summarizeSkill(skill: Skill): string {
  const lines = skill.steps
    .map((s) => {
      switch (s.type) {
        case 'plan':
          return `规划：${s.steps.join('；')}`
        case 'tool':
          return `调用工具 ${s.tool}`
        case 'parallel':
          return `并行调用 ${s.steps.map((x) => x.tool).join('、')}`
        case 'artifact':
          return `产出文档（${s.kind}）`
        case 'reflect':
          return null
        default:
          return null
      }
    })
    .filter((x): x is string => !!x)
  return lines.slice(0, 6).join('\n')
}
