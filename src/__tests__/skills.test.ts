import { describe, it, expect, beforeEach } from 'vitest'
import { extractTriggers, stepsFromTrace, distillSkill } from '../harness/skills/distill'
import { matchSkill, buildBuiltinSkills, summarizeSkill, getBuiltinUsage } from '../harness/skills/library'
import { useSkillStore, allSkills, statsOf } from '../stores/skillStore'
import { buildGenericScript, looksLikeTask, guessArtifactKind, AGENT_SCRIPTS } from '../harness/scripts/agent'
import type { AgentTraceEvent, RoleId } from '../harness/types'
import type { Skill } from '../harness/skills/types'

const ROLE: RoleId = 'teacher'

/** 构造一段「通用探索」式执行轨迹（plan → 并行工具 → 顺序工具 → artifact） */
function traceFixture(): AgentTraceEvent[] {
  return [
    { kind: 'plan', steps: ['拆解目标', '收集信息', '产出文档'] },
    { kind: 'tool_call', id: 't1', tool: 'searchResources', args: { keyword: '研学' }, group: 'g1' },
    { kind: 'tool_call', id: 't2', tool: 'queryClassLearning', args: { className: '高一（3）班' }, group: 'g1' },
    { kind: 'tool_result', id: 't1', tool: 'searchResources', summary: '3 条资源', group: 'g1' },
    { kind: 'tool_result', id: 't2', tool: 'queryClassLearning', summary: '学情摘要', group: 'g1' },
    { kind: 'tool_call', id: 't3', tool: 'searchPolicy', args: { keyword: '安全' } },
    { kind: 'tool_result', id: 't3', tool: 'searchPolicy', summary: '2 条政策' },
    { kind: 'reflect', text: '信息齐备' },
    { kind: 'artifact_meta', artifactId: 'a1', title: '研学活动方案', docKind: 'generic' },
    { kind: 'artifact_chunk', artifactId: 'a1', chunk: '# 研学活动方案' },
    { kind: 'artifact_done', artifactId: 'a1', title: '研学活动方案', docKind: 'generic' },
    { kind: 'done', text: '完成' },
  ]
}

const GOAL_ACT1 = '帮我整理一份研学活动方案，包含行程、安全预案和预算表'
const GOAL_ACT2 = '再做一份研学活动方案，下个月出发'
const GOAL_ACT3 = '帮我把春秋两季的游学计划整理成模板，附安全须知和预算'

beforeEach(() => {
  localStorage.removeItem('edustudio:skills')
  useSkillStore.setState({ learned: [] })
})

describe('extractTriggers（触发词提取）', () => {
  it('幕1 目标：剥离客套/动词/量词前缀，连接词切分，提取 4 个触发词', () => {
    expect(extractTriggers(GOAL_ACT1)).toEqual(['研学活动方案', '行程', '安全预案', '预算表'])
  })

  it('幕3 目标：不含 v1 触发词原文，但提炼出「预算」可与「预算表」重叠', () => {
    const triggers = extractTriggers(GOAL_ACT3)
    expect(triggers).toContain('预算')
    // 幕3 目标不包含幕1 的任何触发词原文 → matchSkill 不命中（走通用探索）
    const v1Triggers = extractTriggers(GOAL_ACT1)
    expect(v1Triggers.some((t) => GOAL_ACT3.includes(t))).toBe(false)
  })

  it('空目标/纯客套 → 无触发词', () => {
    expect(extractTriggers('')).toEqual([])
    expect(extractTriggers('你好')).toEqual([])
  })

  it('上限 4 个，去重', () => {
    const t = extractTriggers('整理教案，生成教案，写教案，做教案，出教案，教案')
    expect(t.length).toBeLessThanOrEqual(4)
    expect(new Set(t).size).toBe(t.length)
  })
})

describe('stepsFromTrace（步骤提取）', () => {
  it('plan 原样保留；同组并行合并为 parallel；artifact_meta 映射为 artifact；排除 reflect/done', () => {
    const steps = stepsFromTrace(traceFixture())
    expect(steps[0]).toEqual({ type: 'plan', steps: ['拆解目标', '收集信息', '产出文档'] })
    const parallel = steps.find((s) => s.type === 'parallel')
    expect(parallel).toBeDefined()
    if (parallel?.type === 'parallel') {
      expect(parallel.steps.map((x) => x.tool)).toEqual(['searchResources', 'queryClassLearning'])
    }
    expect(steps.some((s) => s.type === 'tool' && s.tool === 'searchPolicy')).toBe(true)
    expect(steps.some((s) => s.type === 'artifact' && s.kind === 'generic')).toBe(true)
    expect(steps.some((s) => s.type === 'reflect')).toBe(false)
  })
})

describe('distillSkill（确定性提炼与去重进化）', () => {
  it('全新任务 → 新建 v1 学习技能（created）', () => {
    const result = distillSkill(GOAL_ACT1, traceFixture(), [], ROLE)
    expect(result).not.toBeNull()
    const { skill, evolved } = result!
    expect(evolved).toBe(false)
    expect(skill.origin).toBe('learned')
    expect(skill.version).toBe(1)
    expect(skill.roles).toEqual([ROLE])
    expect(skill.triggers).toEqual(['研学活动方案', '行程', '安全预案', '预算表'])
    expect(skill.steps.length).toBeGreaterThan(0)
    expect(skill.evolution[0].kind).toBe('created')
  })

  it('触发词重叠 → 合并进已有技能，版本+1（refined 进化）', () => {
    const first = distillSkill(GOAL_ACT1, traceFixture(), [], ROLE)!.skill
    const second = distillSkill(GOAL_ACT3, traceFixture(), [first], ROLE)!
    expect(second.evolved).toBe(true)
    expect(second.skill.version).toBe(2)
    expect(second.skill.id).toBe(first.id)
    // 触发词并集：原 4 个 + 新增「预算」等
    expect(second.skill.triggers).toContain('预算表')
    expect(second.skill.triggers).toContain('预算')
    expect(second.skill.evolution[second.skill.evolution.length - 1]?.kind).toBe('refined')
  })

  it('无可复用步骤（无工具/文档产出）→ 不沉淀', () => {
    const events: AgentTraceEvent[] = [
      { kind: 'plan', steps: ['只聊天'] },
      { kind: 'text', text: '你好' },
      { kind: 'done', text: '完成' },
    ]
    expect(distillSkill(GOAL_ACT1, events, [], ROLE)).toBeNull()
  })

  it('无触发词 → 不沉淀', () => {
    expect(distillSkill('你好', traceFixture(), [], ROLE)).toBeNull()
  })
})

describe('matchSkill（检索：学习优先 / 启停 / 角色）', () => {
  const learned: Skill = {
    id: 'learned-x',
    name: '研学活动方案',
    description: '测试',
    roles: [ROLE],
    triggers: ['研学活动方案'],
    steps: [{ type: 'plan', steps: ['x'] }],
    origin: 'learned',
    version: 1,
    enabled: true,
    stats: { usageCount: 0, successCount: 0, lastUsedAt: 0 },
    evolution: [],
    createdAt: 0,
    updatedAt: 0,
  }

  it('学习技能优先于内置剧本技能', () => {
    const hit = matchSkill(ROLE, GOAL_ACT2, [learned])
    expect(hit?.id).toBe('learned-x')
    expect(hit?.origin).toBe('learned')
  })

  it('无学习技能时命中内置剧本技能（id 对齐剧本）', () => {
    const hit = matchSkill(ROLE, '针对高一（3）班函数单调性薄弱点出分层练习', [])
    expect(hit).not.toBeNull()
    expect(hit?.origin).toBe('builtin')
    expect(AGENT_SCRIPTS.some((s) => s.id === hit!.id)).toBe(true)
  })

  it('停用的技能不参与匹配', () => {
    const disabled = { ...learned, enabled: false }
    const hit = matchSkill(ROLE, GOAL_ACT2, [disabled])
    expect(hit?.origin).not.toBe('learned')
  })

  it('角色不匹配不命中', () => {
    expect(matchSkill('bureau', GOAL_ACT2, [learned])).toBeNull()
  })
})

describe('skillStore（持久化与统计）', () => {
  it('addLearned 持久化到 edustudio:skills，重载可恢复', () => {
    const result = distillSkill(GOAL_ACT1, traceFixture(), [], ROLE)!
    useSkillStore.getState().addLearned(result.skill)
    expect(useSkillStore.getState().learned).toHaveLength(1)
    const raw = JSON.parse(localStorage.getItem('edustudio:skills') ?? '[]')
    expect(raw).toHaveLength(1)
    expect(raw[0].name).toBe(result.skill.name)
  })

  it('recordUsage：learned 走持久化统计，builtin 走内存统计', () => {
    const result = distillSkill(GOAL_ACT1, traceFixture(), [], ROLE)!
    useSkillStore.getState().addLearned(result.skill)
    useSkillStore.getState().recordUsage(result.skill.id, 'learned')
    expect(useSkillStore.getState().learned[0].stats.usageCount).toBe(1)
    expect(useSkillStore.getState().learned[0].stats.successCount).toBe(1)

    useSkillStore.getState().recordUsage('teacher-lesson-plan', 'builtin')
    expect(getBuiltinUsage('teacher-lesson-plan').usageCount).toBe(1)
    const builtin = allSkills([]).find((s) => s.id === 'teacher-lesson-plan')!
    expect(statsOf(builtin).usageCount).toBe(1)
  })

  it('replaceLearned：进化替换（版本+1）', () => {
    const v1 = distillSkill(GOAL_ACT1, traceFixture(), [], ROLE)!.skill
    useSkillStore.getState().addLearned(v1)
    const v2 = { ...v1, version: 2, triggers: [...v1.triggers, '预算'] }
    useSkillStore.getState().replaceLearned(v2)
    expect(useSkillStore.getState().learned[0].version).toBe(2)
    expect(useSkillStore.getState().learned[0].triggers).toContain('预算')
  })

  it('clearLearned 清空并持久化', () => {
    const result = distillSkill(GOAL_ACT1, traceFixture(), [], ROLE)!
    useSkillStore.getState().addLearned(result.skill)
    useSkillStore.getState().clearLearned()
    expect(useSkillStore.getState().learned).toHaveLength(0)
    expect(JSON.parse(localStorage.getItem('edustudio:skills') ?? '[]')).toHaveLength(0)
  })

  it('allSkills：学习技能在前，内置技能随后（12 个剧本派生）', () => {
    const result = distillSkill(GOAL_ACT1, traceFixture(), [], ROLE)!
    useSkillStore.getState().addLearned(result.skill)
    const all = allSkills(useSkillStore.getState().learned)
    expect(all[0].origin).toBe('learned')
    expect(all.filter((s) => s.origin === 'builtin')).toHaveLength(AGENT_SCRIPTS.length)
  })
})

describe('通用探索剧本（第三层执行路径）', () => {
  it('教师角色：资源检索 + 学情查询，按目标猜测文档类型', () => {
    const script = buildGenericScript(ROLE, GOAL_ACT1)
    const tools = script.steps.filter((s) => s.type === 'tool').map((s) => (s.type === 'tool' ? s.tool : ''))
    expect(tools).toEqual(['searchResources', 'queryClassLearning'])
    expect(guessArtifactKind(GOAL_ACT1)).toBe('generic')
    expect(guessArtifactKind('生成家长会通知')).toBe('notice')
    expect(guessArtifactKind('写一份季度质量报告')).toBe('report')
    expect(guessArtifactKind('生成教案')).toBe('lessonPlan')
  })

  it('任务型启发式：任务词命中 / 寒暄不命中', () => {
    expect(looksLikeTask(GOAL_ACT1)).toBe(true)
    expect(looksLikeTask('你好，今天天气怎么样')).toBe(false)
  })
})

describe('内置技能与摘要', () => {
  it('buildBuiltinSkills：12 个剧本全部派生，id/触发词对齐', () => {
    const builtins = buildBuiltinSkills()
    expect(builtins).toHaveLength(AGENT_SCRIPTS.length)
    for (const s of builtins) {
      const script = AGENT_SCRIPTS.find((x) => x.id === s.id)!
      expect(s.triggers).toEqual(script.match)
      expect(s.origin).toBe('builtin')
      expect(s.version).toBe(1)
    }
  })

  it('summarizeSkill：步骤摘要供 API 模式注入', () => {
    const builtins = buildBuiltinSkills()
    const summary = summarizeSkill(builtins[0])
    expect(summary.length).toBeGreaterThan(0)
    expect(summary).not.toContain('undefined')
  })
})
