/**
 * v1.2 M3a · 战队 AgentSpec 注册表单测（roadmap §4.3 / §3.6(1)）
 * 覆盖：6 名成员齐全 / baseRole=inherit / 命名空间 / 工具白名单 ⊆ 教师工具域 /
 * resolveToolWhitelist 交集与过滤 / Mock 剧本 id / 注册表审计。
 */
import { describe, expect, it } from 'vitest'
import { toolRegistry } from '../harness/agent/ToolRegistry'
import {
  MISSION_AGENT_SPECS,
  agentSpecFor,
  auditAgentSpecs,
  resolveToolWhitelist,
  type MissionAgentSpec,
} from '../harness/team/agents'
import { DIRECTOR_AGENT_IDS, DIRECTOR_AGENT_LABELS } from '../studio/contracts'
import type { AgentSpec } from '../studio/contracts'
import type { DirectorAgentId } from '../harness/director/types'

const teacherTools = (): Set<string> =>
  new Set(toolRegistry.listForRole('teacher').map((tool) => tool.name))

describe('MISSION_AGENT_SPECS · 注册表完整性', () => {
  it('6 名执行成员齐全，顺序与 DIRECTOR_AGENT_IDS 一致', () => {
    expect(Object.keys(MISSION_AGENT_SPECS)).toHaveLength(6)
    expect(Object.keys(MISSION_AGENT_SPECS)).toEqual([...DIRECTOR_AGENT_IDS])
    for (const id of DIRECTOR_AGENT_IDS) expect(MISSION_AGENT_SPECS[id].id).toBe(id)
  })

  it('baseRole 全部 inherit（mission 只对教师开放），name 取自主 chunk 常量', () => {
    for (const id of DIRECTOR_AGENT_IDS) {
      expect(MISSION_AGENT_SPECS[id].baseRole).toBe('inherit')
      expect(MISSION_AGENT_SPECS[id].name).toBe(DIRECTOR_AGENT_LABELS[id])
    }
  })

  it('记忆 / 技能命名空间稳定为 agent.<id> / agent.<id>.skill（不污染旧 teacher.* 前缀）', () => {
    for (const id of DIRECTOR_AGENT_IDS) {
      expect(MISSION_AGENT_SPECS[id].memoryNs).toBe(`agent.${id}`)
      expect(MISSION_AGENT_SPECS[id].skillNs).toBe(`agent.${id}.skill`)
    }
  })

  it('notDo 一行边界与 mockScriptId 非空且互不相同', () => {
    const scriptIds = new Set<string>()
    for (const id of DIRECTOR_AGENT_IDS) {
      const spec = MISSION_AGENT_SPECS[id]
      expect(spec.notDo.trim().length).toBeGreaterThan(0)
      expect(spec.mockScriptId.trim().length).toBeGreaterThan(0)
      scriptIds.add(spec.mockScriptId)
    }
    expect(scriptIds.size).toBe(DIRECTOR_AGENT_IDS.length)
  })

  it('autonomy 为 per-agent 单档（默认档存在，不启用 6×6 矩阵）', () => {
    for (const id of DIRECTOR_AGENT_IDS) {
      const autonomy = MISSION_AGENT_SPECS[id].autonomy
      expect(Object.keys(autonomy).length).toBeLessThanOrEqual(2)
      expect(['L0', 'L1', 'L2', 'L3']).toContain(autonomy.default)
    }
  })
})

describe('工具白名单 ⊆ 教师工具域', () => {
  it('每个成员的 tools 都是教师可用的已注册工具（禁止引入未注册/越权工具）', () => {
    const allowed = teacherTools()
    for (const id of DIRECTOR_AGENT_IDS) {
      for (const tool of MISSION_AGENT_SPECS[id].tools) {
        expect(allowed.has(tool), `${id} 的工具「${tool}」不在教师工具域`).toBe(true)
        expect(toolRegistry.has(tool), `工具「${tool}」未注册`).toBe(true)
      }
    }
  })

  it('auditAgentSpecs 返回空（注册表自检通过）', () => {
    expect(auditAgentSpecs()).toEqual({ missing: [], invalidTools: [] })
  })

  it('每名成员至少有一个工具（避免空白名单导致无法执行）', () => {
    for (const id of DIRECTOR_AGENT_IDS) {
      expect(MISSION_AGENT_SPECS[id].tools.length).toBeGreaterThan(0)
    }
  })
})

describe('agentSpecFor', () => {
  it('按 id 取回冻结 Spec（同一对象引用，不复制）', () => {
    for (const id of DIRECTOR_AGENT_IDS) {
      expect(agentSpecFor(id)).toBe(MISSION_AGENT_SPECS[id])
    }
  })
})

describe('resolveToolWhitelist · 与角色工具域取交集', () => {
  const spec = (patch: Partial<AgentSpec> = {}): AgentSpec => ({
    id: 'analyst',
    name: '测试成员',
    baseRole: 'inherit',
    tools: ['queryClassLearning', 'searchCurriculum', 'listDocuments'],
    memoryNs: 'agent.analyst',
    skillNs: 'agent.analyst.skill',
    autonomy: { default: 'L2' },
    notDo: '测试',
    ...patch,
  })

  it('inherit + teacher → 保留教师域内工具，顺序按 spec.tools', () => {
    expect(resolveToolWhitelist(spec(), 'teacher')).toEqual(['queryClassLearning', 'searchCurriculum', 'listDocuments'])
  })

  it('过滤未注册 / 域外工具名（如管理侧 draftNotice、杜撰工具）', () => {
    expect(resolveToolWhitelist(spec({ tools: ['bogusTool', 'draftNotice', 'queryClassLearning'] }), 'teacher')).toEqual([
      'queryClassLearning',
    ])
  })

  it('重复工具名去重', () => {
    expect(resolveToolWhitelist(spec({ tools: ['genQuiz', 'genQuiz', 'searchCurriculum'] }), 'teacher')).toEqual([
      'genQuiz',
      'searchCurriculum',
    ])
  })

  it('spec.baseRole 非 inherit 时覆盖调用方 baseRole（按成员自带角色取域）', () => {
    const asAdmin = spec({ baseRole: 'schoolAdmin', tools: ['draftNotice', 'queryClassLearning'] })
    expect(resolveToolWhitelist(asAdmin, 'teacher')).toEqual(['draftNotice', 'queryClassLearning'])
  })

  it('成员自带工具全部越权时返回空数组（执行前即失败，不把越权工具交给 Agent）', () => {
    expect(resolveToolWhitelist(spec({ tools: ['draftNotice', 'querySchoolStats'] }), 'teacher')).toEqual([])
  })

  it('MissionAgentSpec 类型在 AgentSpec 之上补 mockScriptId（M3b 剧本接入点）', () => {
    const missionSpec: MissionAgentSpec = agentSpecFor('chief' satisfies DirectorAgentId)
    expect(missionSpec.mockScriptId).toBe('chief.summarize')
    const asBase: AgentSpec = missionSpec
    expect(asBase.id).toBe('chief')
  })
})
