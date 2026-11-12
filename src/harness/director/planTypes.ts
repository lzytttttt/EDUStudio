/**
 * Director v1.1 计划契约（wire 层）——「拆解真、执行假」的纯类型与本地适配。
 *
 * 分工（roadmap §4.2）：
 * - LLM 只产出 `MissionPlan`（kind / title / tasks / gates / deliverables / estimateMinutes）；
 * - task id 重编号、seconds、feed 台词、gate 文案、产物 Markdown 全部本地补；
 * - 不改既有 `MissionPlanTask`（types.ts:176-185）与 `MissionState.plan`：适配成
 *   `MissionPlanTask[]` 后仍交现有脚本引擎，旧单测/E2E 断言零改动。
 *
 * 边界：只依赖冻结契约 `./types`；不 import `data.ts`（模板注册表由 M3 改造，
 * 本模块只接收调用方传入的 `MissionTemplate`），不依赖 store / UI / 网络。
 */
import type {
  ArtifactKindCn,
  DirectorAgentId,
  GateId,
  MissionKind,
  MissionPlanTask,
  MissionTemplate,
} from './types'

/* ------------------------------------------------------------------ */
/* wire 契约（LLM 输出的最小字段集）                                    */
/* ------------------------------------------------------------------ */

/** LLM 可产出的最小任务；id 由模型给、落库前本地重编号为 t1..tn */
export interface WirePlanTask {
  id: string
  agentId: DirectorAgentId
  title: string
  /** 依赖的上游 task id（wire id，可为空数组） */
  deps: string[]
  /** 该环节产出需人工拍板（1–2 个，与 plan.gates 对应） */
  gate?: GateId
  /** v1.2 防线：可选工具名；v1.1 模型不产出，validatePlan #8 校验白名单 */
  tool?: string
}

/** LLM 产出的最小计划（roadmap §4.2 / 附录 A）；本地不接受其它字段 */
export interface MissionPlan {
  kind: MissionKind
  /** ≤12 字（validatePlan 超长截断，不 reject） */
  title: string
  /** 4–8 个 */
  tasks: WirePlanTask[]
  /** 1–2 个；与 task.gate 冲突时以 task.gate 重算 */
  gates: GateId[]
  /** 允许集合见 `ARTIFACT_KINDS_CN`，≥1 且去重 */
  deliverables: ArtifactKindCn[]
  /** 3–60 分钟（越界修正，不 reject） */
  estimateMinutes: number
}

/* ------------------------------------------------------------------ */
/* 契约常量（validatePlan / planner / UI 共用，避免各处硬编码）          */
/* ------------------------------------------------------------------ */

/** 两条演示剧本（与 types.MissionKind 同步；运行期白名单） */
export const MISSION_KINDS: readonly MissionKind[] = ['parent_meeting', 'exam_loop']

/** 审批门白名单（与 types.GateId 同步） */
export const GATE_IDS: readonly GateId[] = ['speech', 'letters', 'worksheet', 'lesson']

/** 名册（与 data.AGENTS 的 6 个 id 同步；director 模块不 import data.ts，故在此冻结） */
export const DIRECTOR_AGENT_IDS: readonly DirectorAgentId[] = [
  'chief',
  'analyst',
  'assessor',
  'curriculum',
  'communicator',
  'steward',
]

/** director 侧中文 tile kind 白名单（roadmap D1） */
export const ARTIFACT_KINDS_CN: readonly ArtifactKindCn[] = [
  '简报',
  '讲稿',
  '大纲',
  '信件',
  '练习单',
  '教案',
  '摘要',
]

/**
 * v1.2 工具域防线（roadmap §4.4 #8）：director agent → 允许工具名。
 * v1.1 模型不产出 tool，本映射只用于拒绝越界工具；真实注册表见
 * `src/harness/agent/ToolRegistry.ts`（validatePlan 会做 `toolRegistry.has()` 双检）。
 */
export const DIRECTOR_AGENT_TOOLS: Record<DirectorAgentId, readonly string[]> = {
  chief: [],
  analyst: ['queryClassLearning', 'searchCurriculum', 'searchResources', 'listDocuments', 'quoteDocument', 'mergeDocuments'],
  assessor: ['genQuiz', 'searchCurriculum', 'searchResources', 'quoteDocument'],
  curriculum: ['genLessonPlan', 'searchCurriculum', 'searchResources', 'mergeDocuments'],
  communicator: ['searchResources', 'quoteDocument'],
  steward: [],
}

/** LLM 输出长度约束（roadmap §4.2/§4.3） */
export const WIRE_PLAN_TITLE_MAX = 12
export const WIRE_TASK_TITLE_MAX = 20
export const PLAN_ESTIMATE_MIN = 3
export const PLAN_ESTIMATE_MAX = 60

/** 任务耗时（秒）由成员岗位本地补，模型不产出这些字段 */
const SECONDS_BY_AGENT: Record<DirectorAgentId, number> = {
  chief: 30,
  analyst: 40,
  assessor: 90,
  curriculum: 90,
  communicator: 90,
  steward: 40,
}

/**
 * 审批门归属（与 data.GATE_OWNER 同值，roadmap §6.1；director 纯模块不 import data.ts）。
 * 模板的 `gates` 与 `plan` 分开定义（v1.0 剧本 gate 在 script 事件上），
 * planFromTemplate 用它把门落到对应 owner 的环节，保证 MissionPlan 内部自洽。
 */
export const GATE_OWNER: Record<GateId, DirectorAgentId> = {
  speech: 'curriculum',
  letters: 'communicator',
  worksheet: 'assessor',
  lesson: 'curriculum',
}

/** estimateMinutes 归一：非有限值回退下限，四舍五入后 clamp 到 3–60 */
export function clampEstimateMinutes(value: number): number {
  if (!Number.isFinite(value)) return PLAN_ESTIMATE_MIN
  return Math.min(PLAN_ESTIMATE_MAX, Math.max(PLAN_ESTIMATE_MIN, Math.round(value)))
}

/** 本地补 seconds：按成员岗位取固定演示时长（保证同计划可复现） */
export function estimateSecondsFor(agentId: DirectorAgentId): number {
  return SECONDS_BY_AGENT[agentId] ?? 40
}

/* ------------------------------------------------------------------ */
/* 模板 → wire 计划（模板兜底 / ?mission= / d-drill 联动共用）          */
/* ------------------------------------------------------------------ */

/**
 * 把 M3 的 `MissionTemplate` 适配成 wire `MissionPlan`（模板兜底唯一入口）。
 * - tasks 保留模板 id / deps / gate；
 * - 模板 `gates` 是独立清单（v1.0 剧本 gate 在 script 事件上），这里按 `GATE_OWNER`
 *   把未挂门补齐到对应 owner 的环节，保证「gates ⊆ task.gate」内部自洽（1–2 个门）；
 * - deliverables 取模板产物 kind 并去重；
 * - estimateMinutes 由模板 plan 的 seconds 合计换算（3–60）。
 */
export function planFromTemplate(template: MissionTemplate): MissionPlan {
  const planTasks = Array.isArray(template.plan) ? template.plan : []
  const tasks: WirePlanTask[] = planTasks.map((task) => ({
    id: task.id,
    agentId: task.agentId,
    title: task.title,
    deps: [...(task.deps ?? [])],
    ...(task.gate ? { gate: task.gate } : {}),
  }))

  /* 模板 gates → 环节落位：优先 owner 匹配，其次任一未挂门环节（模板可信，兜底不 reject） */
  const landedGates = new Set<GateId>(tasks.map((task) => task.gate).filter((gate): gate is GateId => Boolean(gate)))
  for (const gate of template.gates ?? []) {
    if (landedGates.has(gate)) continue
    const owner = GATE_OWNER[gate]
    const target =
      tasks.find((task) => !task.gate && (owner ? task.agentId === owner : true)) ??
      tasks.find((task) => !task.gate && task.agentId !== 'chief')
    if (!target) continue
    target.gate = gate
    landedGates.add(gate)
  }

  const deliverables: ArtifactKindCn[] = []
  for (const artifact of template.artifacts ?? []) {
    if (artifact && ARTIFACT_KINDS_CN.includes(artifact.kind) && !deliverables.includes(artifact.kind)) {
      deliverables.push(artifact.kind)
    }
  }

  const totalSeconds = planTasks.reduce(
    (sum, task) => sum + (typeof task.seconds === 'number' && Number.isFinite(task.seconds) ? task.seconds : 0),
    0,
  )

  return {
    kind: template.kind,
    title: [...template.title].slice(0, WIRE_PLAN_TITLE_MAX).join(''),
    tasks,
    /* 以实际落到环节上的门为准（与 task.gate 一致，供 validatePlan/UI 派生 gateCount） */
    gates: [...landedGates],
    deliverables,
    estimateMinutes: clampEstimateMinutes(totalSeconds / 60),
  }
}

/* ------------------------------------------------------------------ */
/* wire 计划 → 执行层 MissionPlanTask[]（本地补 seconds/deps/gate）      */
/* ------------------------------------------------------------------ */

/**
 * 适配成现有脚本引擎可直接消费的 `MissionPlanTask[]`（roadmap §4.2「本地补正」）：
 * - id 一律重编号 t1..tn（按数组顺序），deps 同步映射到新 id、过滤悬空/自依赖/重复；
 * - seconds 按成员岗位补；gate 原样保留（不在白名单的丢弃）；
 * - 不修改入参（返回新数组/新对象）。
 */
export function adaptPlanToTasks(plan: MissionPlan): MissionPlanTask[] {
  const rawTasks = Array.isArray(plan.tasks) ? plan.tasks : []
  const idMap = new Map<string, string>()
  rawTasks.forEach((task, index) => {
    const id = typeof task?.id === 'string' ? task.id.trim() : ''
    if (id && !idMap.has(id)) idMap.set(id, `t${index + 1}`)
  })

  return rawTasks.map((task, index) => {
    const id = `t${index + 1}`
    const deps: string[] = []
    for (const dep of Array.isArray(task?.deps) ? task.deps : []) {
      const mapped = typeof dep === 'string' ? idMap.get(dep.trim()) : undefined
      if (!mapped || mapped === id || deps.includes(mapped)) continue
      deps.push(mapped)
    }
    const gate = task?.gate && GATE_IDS.includes(task.gate) ? task.gate : undefined
    return {
      id,
      agentId: task.agentId,
      title: task.title,
      seconds: estimateSecondsFor(task.agentId),
      deps,
      ...(gate ? { gate } : {}),
    }
  })
}
