import { describe, expect, it } from 'vitest'
import type { DeepSeekAdapter } from '../harness/llm/adapter'
import type { AgentTraceEvent } from '../harness/types'
import type { Skill } from '../harness/skills/types'
import {
  LlmSkillDistiller,
  mergeSkillCandidate,
  stepsFromTrace,
  summarizeTrace,
  validateSkillCandidate,
} from '../harness/skills/distill'

/* LLM 技能提炼 v0.8 M4：trace 摘要、候选校验、去重进化、LLM 复盘全流程（fake adapter） */

function makeSkill(partial: Partial<Skill> = {}): Skill {
  return {
    id: 's1',
    name: '成绩汇总',
    description: '汇总班级成绩',
    roles: ['teacher'],
    triggers: ['成绩汇总'],
    steps: [{ type: 'tool', tool: 'query_class_scores', args: {} }],
    origin: 'learned',
    version: 1,
    enabled: true,
    stats: { usageCount: 0, successCount: 0, lastUsedAt: 0 },
    evolution: [{ at: 1, version: 1, kind: 'created', note: 'n' }],
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

/** fake LLM：按脚本逐段 yield */
function fakeAdapter(script: string[] | Error): DeepSeekAdapter {
  return {
    async *streamChat() {
      if (script instanceof Error) throw script
      for (const chunk of script) yield chunk
    },
  } as unknown as DeepSeekAdapter
}

const traceEvents: AgentTraceEvent[] = [
  { kind: 'plan', steps: ['查询成绩', '生成报告'] },
  { kind: 'text', text: '好的，我来处理' },
  { kind: 'tool_call', id: 'c1', tool: 'query_class_scores', args: { classId: 'c1' } },
  { kind: 'tool_result', id: 'c1', tool: 'query_class_scores', summary: '均分 82.5' },
  { kind: 'reflect', text: '继续生成文档' },
  { kind: 'artifact_meta', artifactId: 'a1', title: '学情报告', docKind: 'report' },
  { kind: 'done', text: '完成' },
]

describe('summarizeTrace', () => {
  it('保留 plan/tool/result/artifact，过滤 text/reflect/done', () => {
    const s = summarizeTrace(traceEvents)
    expect(s).toContain('plan: 查询成绩 → 生成报告')
    expect(s).toContain('tool: query_class_scores')
    expect(s).toContain('result: 均分 82.5')
    expect(s).toContain('artifact: report')
    expect(s).not.toContain('好的，我来处理')
    expect(s).not.toContain('完成')
  })
  it('无可沉淀事件 → 空串', () => {
    expect(summarizeTrace([{ kind: 'text', text: '你好' }])).toBe('')
  })
})

describe('validateSkillCandidate', () => {
  const valid = {
    action: 'create',
    name: '学情周报生成',
    description: '查询并生成周报',
    triggers: ['学情周报', '周报生成', 'a', '这个触发词实在是太长了不合法'],
    steps: [
      { type: 'tool', tool: 'query_class_scores', args: {} },
      { type: 'text', text: '整理中' },
      { type: 'artifact', kind: 'report' },
      { type: 'artifact', kind: 'unknownKind' },
    ],
  }

  it('合法候选通过：触发词过滤长短/去重，artifact 非法 kind 兜底 generic', () => {
    const cand = validateSkillCandidate(valid)
    expect(cand).not.toBeNull()
    expect(cand!.triggers).toEqual(['学情周报', '周报生成'])
    expect(cand!.steps.some((s) => s.type === 'artifact' && s.kind === 'generic')).toBe(true)
  })

  it('缺 name/触发词全非法 → null', () => {
    expect(validateSkillCandidate({ ...valid, name: '' })).toBeNull()
    expect(validateSkillCandidate({ ...valid, triggers: ['a', '这个触发词实在是太长了不合法'] })).toBeNull()
  })

  it('无实质步骤（纯 text）→ null', () => {
    expect(validateSkillCandidate({ ...valid, steps: [{ type: 'text', text: '只说话' }] })).toBeNull()
  })

  it('非对象/步数超限截断', () => {
    expect(validateSkillCandidate(null)).toBeNull()
    const many = Array.from({ length: 12 }, (_, i) => ({ type: 'tool', tool: `t${i}`, args: {} }))
    expect(validateSkillCandidate({ ...valid, steps: many })!.steps.length).toBe(8)
  })
})

describe('mergeSkillCandidate 去重与进化', () => {
  const cand = {
    name: '成绩汇总助手',
    description: 'd',
    triggers: ['成绩汇总', '成绩报告'],
    steps: [{ type: 'tool' as const, tool: 'query_class_scores', args: {} }],
  }

  it('触发词重叠 → 合并进最相关技能：版本+1、触发词并集、保留原步骤', () => {
    const existing = [makeSkill({ triggers: ['成绩汇总'], steps: [{ type: 'tool', tool: 'old_tool', args: {} }] })]
    const result = mergeSkillCandidate(cand, existing, 'teacher', 1234)
    expect(result).not.toBeNull()
    expect(result!.evolved).toBe(true)
    expect(result!.skill.version).toBe(2)
    expect(result!.skill.triggers).toEqual(['成绩汇总', '成绩报告'])
    expect(result!.skill.steps[0]).toEqual({ type: 'tool', tool: 'old_tool', args: {} })
    expect(result!.skill.evolution[result!.skill.evolution.length - 1]!.note).toContain('LLM 复盘')
  })

  it('无重叠 → 新建 v1（created）', () => {
    const result = mergeSkillCandidate(cand, [], 'teacher', 1234)
    expect(result!.evolved).toBe(false)
    expect(result!.skill.version).toBe(1)
    expect(result!.skill.roles).toEqual(['teacher'])
    expect(result!.skill.origin).toBe('learned')
  })

  it('角色不匹配的现有技能不参与合并', () => {
    const existing = [makeSkill({ roles: ['bureau'] })]
    expect(mergeSkillCandidate(cand, existing, 'teacher')!.evolved).toBe(false)
  })
})

describe('LlmSkillDistiller', () => {
  const skillJson =
    '{"action":"create","name":"学情周报生成","description":"d","triggers":["学情周报"],"steps":[{"type":"tool","tool":"query_class_scores","args":{}}]}'

  it('LLM 输出合法技能 JSON（容忍代码块）→ create 结果', async () => {
    const d = new LlmSkillDistiller(fakeAdapter(['好的：\n```json\n', skillJson, '\n```']))
    const result = await d.distill({ goal: '生成学情周报', events: traceEvents, role: 'teacher' })
    expect(result).not.toBeNull()
    expect(result!.evolved).toBe(false)
    expect(result!.skill.name).toBe('学情周报生成')
  })

  it('action=none / 非法 JSON / LLM 报错 → 静默 null', async () => {
    const none = new LlmSkillDistiller(fakeAdapter(['{"action":"none"}']))
    expect(await none.distill({ goal: 'g', events: traceEvents, role: 'teacher' })).toBeNull()

    const broken = new LlmSkillDistiller(fakeAdapter(['这不是 JSON']))
    expect(await broken.distill({ goal: 'g', events: traceEvents, role: 'teacher' })).toBeNull()

    const errored = new LlmSkillDistiller(fakeAdapter(new Error('boom')))
    expect(await errored.distill({ goal: 'g', events: traceEvents, role: 'teacher' })).toBeNull()
  })

  it('无可沉淀轨迹（纯寒暄）→ 不调用 LLM 直接 null', async () => {
    const d = new LlmSkillDistiller(fakeAdapter([skillJson]))
    expect(await d.distill({ goal: '你好', events: [{ kind: 'text', text: '你好呀' }], role: 'teacher' })).toBeNull()
  })
})

/* stepsFromTrace 回归：与 v0.6 确定性提炼共存不回归 */
describe('stepsFromTrace 回归', () => {
  it('plan/tool/artifact 照常提取', () => {
    const steps = stepsFromTrace(traceEvents)
    expect(steps.some((s) => s.type === 'plan')).toBe(true)
    expect(steps.some((s) => s.type === 'tool' && s.tool === 'query_class_scores')).toBe(true)
    expect(steps.some((s) => s.type === 'artifact')).toBe(true)
  })
})
