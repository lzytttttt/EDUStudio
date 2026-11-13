/**
 * v1.2 M3a · 战队 AgentSpec 注册表（Director lazy chunk；roadmap §4.3 / §3.6(1)）
 *
 * 6 个执行成员（chief/analyst/assessor/curriculum/communicator/steward）的 Spec 子集：
 * - `baseRole` 全部 `'inherit'`：mission 只对教师开放（D14），语气与工具域跟随输入 role=teacher；
 * - `tools` 必须 ⊆ `toolRegistry.listForRole('teacher')`（禁止引入未注册 / 域外工具名，
 *   `resolveToolWhitelist` 会在执行前再取一次交集，双保险）；
 * - 记忆/技能命名空间 `agent.<id>`（旧 `teacher.*` 前缀不变，新增命名空间不污染旧 key）；
 * - `mockScriptId` 供 MockOrchestrator 出差异化剧本（M3b 接入；此处只冻结 id，不改旧剧本路径）。
 *
 * 边界：本文件随 Director chunk 加载，只依赖 harness（工具注册表 / 类型）与 studio 契约类型。
 */
import type { AgentSpec } from '../../studio/contracts'
import { DIRECTOR_AGENT_IDS, DIRECTOR_AGENT_LABELS } from '../../studio/contracts'
import type { DirectorAgentId } from '../director/types'
import type { RoleId } from '../types'
import { toolRegistry } from '../agent/ToolRegistry'

/** AgentSpec + Mock 剧本 id（contracts.AgentSpec 未含 mockScriptId，M3b 接入前用局部扩展承载） */
export interface MissionAgentSpec extends AgentSpec {
  /** Mock 模式下按成员差异化的剧本 id（缺省 = 旧通用剧本，行为不变） */
  mockScriptId: string
}

/* ------------------------------------------------------------------ */
/* 6 个成员的岗位 Spec（工具白名单取自教师工具域）                        */
/* ------------------------------------------------------------------ */

export const MISSION_AGENT_SPECS: Record<DirectorAgentId, MissionAgentSpec> = {
  chief: {
    id: 'chief',
    name: DIRECTOR_AGENT_LABELS.chief,
    baseRole: 'inherit',
    tools: ['queryClassLearning', 'listDocuments', 'quoteDocument'],
    memoryNs: 'agent.chief',
    skillNs: 'agent.chief.skill',
    autonomy: { default: 'L2' },
    notDo: '不直接对外发送材料，也不替教师拍板',
    mockScriptId: 'chief.summarize',
  },
  analyst: {
    id: 'analyst',
    name: DIRECTOR_AGENT_LABELS.analyst,
    baseRole: 'inherit',
    tools: ['queryClassLearning', 'searchCurriculum', 'listDocuments'],
    memoryNs: 'agent.analyst',
    skillNs: 'agent.analyst.skill',
    autonomy: { default: 'L2' },
    notDo: '不下结论性评价，只呈现可溯源的数据事实',
    mockScriptId: 'analyst.analyze',
  },
  assessor: {
    id: 'assessor',
    name: DIRECTOR_AGENT_LABELS.assessor,
    baseRole: 'inherit',
    tools: ['genQuiz', 'searchCurriculum', 'searchResources'],
    memoryNs: 'agent.assessor',
    skillNs: 'agent.assessor.skill',
    autonomy: { default: 'L2' },
    notDo: '不直接公布成绩或排名',
    mockScriptId: 'assessor.quiz',
  },
  curriculum: {
    id: 'curriculum',
    name: DIRECTOR_AGENT_LABELS.curriculum,
    baseRole: 'inherit',
    tools: ['genLessonPlan', 'searchCurriculum', 'searchResources', 'listDocuments'],
    memoryNs: 'agent.curriculum',
    skillNs: 'agent.curriculum.skill',
    autonomy: { default: 'L2' },
    notDo: '不覆盖教师已定稿的教案',
    mockScriptId: 'curriculum.lesson',
  },
  communicator: {
    id: 'communicator',
    name: DIRECTOR_AGENT_LABELS.communicator,
    baseRole: 'inherit',
    tools: ['listDocuments', 'quoteDocument', 'mergeDocuments', 'searchResources'],
    memoryNs: 'agent.communicator',
    skillNs: 'agent.communicator.skill',
    // 对外沟通类：授权更保守（L1），发送前必经硬门
    autonomy: { default: 'L1' },
    notDo: '不自动发送任何家长信 / 通知',
    mockScriptId: 'communicator.letters',
  },
  steward: {
    id: 'steward',
    name: DIRECTOR_AGENT_LABELS.steward,
    baseRole: 'inherit',
    tools: ['listDocuments', 'queryClassLearning', 'searchCurriculum'],
    memoryNs: 'agent.steward',
    skillNs: 'agent.steward.skill',
    autonomy: { default: 'L2' },
    notDo: '不接触学生隐私与处分类决定',
    mockScriptId: 'steward.chores',
  },
}

/** 取成员的冻结 Spec（6 个 id 全覆盖；返回注册表对象本体，调用方不应修改） */
export function agentSpecFor(id: DirectorAgentId): MissionAgentSpec {
  return MISSION_AGENT_SPECS[id]
}

/**
 * 解析工具白名单：`spec.tools ∩ toolRegistry.listForRole(effectiveBaseRole)`。
 * - effectiveBaseRole：`spec.baseRole === 'inherit'` 时用调用方传入的 baseRole，否则用 spec 自带；
 * - 保持 spec.tools 顺序、去重；未注册 / 域外工具名一律剔除（永不把越权工具交给 Agent）。
 */
export function resolveToolWhitelist(spec: AgentSpec, baseRole: RoleId): string[] {
  const effectiveRole: RoleId = spec.baseRole === 'inherit' ? baseRole : spec.baseRole
  const allowed = new Set(toolRegistry.listForRole(effectiveRole).map((tool) => tool.name))
  const seen = new Set<string>()
  const whitelist: string[] = []
  for (const name of spec.tools) {
    if (!allowed.has(name) || seen.has(name)) continue
    seen.add(name)
    whitelist.push(name)
  }
  return whitelist
}

/** 注册表覆盖校验（单测 / 排障用）：返回缺失或越权的成员 id 列表（生产路径不调用） */
export function auditAgentSpecs(): { missing: DirectorAgentId[]; invalidTools: { agentId: DirectorAgentId; tool: string }[] } {
  const teacherTools = new Set(toolRegistry.listForRole('teacher').map((tool) => tool.name))
  const missing = DIRECTOR_AGENT_IDS.filter((id) => !MISSION_AGENT_SPECS[id])
  const invalidTools: { agentId: DirectorAgentId; tool: string }[] = []
  for (const id of DIRECTOR_AGENT_IDS) {
    const spec = MISSION_AGENT_SPECS[id]
    if (!spec) continue
    for (const tool of spec.tools) {
      if (!teacherTools.has(tool)) invalidTools.push({ agentId: id, tool })
    }
  }
  return { missing: [...missing], invalidTools }
}
