/**
 * validatePlan —— LLM 计划的本地校验矩阵（roadmap §4.4 / 研究 01 §3.4，8 条纯函数）。
 *
 * 原则：**非法计划永不上屏**；结构性问题 reject（errors 非空时 ok=false、不返回 plan），
 * 只在明确允许的范围内本地修正（title 截断 / estimate clamp / id 重编号 / gates 按任务重算 /
 * deliverables 去重 / deps 缺省补空），修正项写入 `fixed`，不静默改结构。
 *
 * 校验矩阵：
 * 1. kind ∈ {parent_meeting, exam_loop}
 * 2. 4 ≤ tasks ≤ 8
 * 3. agentId ∈ 名册且至少 2 个非 chief 成员
 * 4. deps 引用存在、无环、最长链 ≤3；task id 不得重复
 * 5. gates ⊆ GateId、1–2 个且落在任务上（与 task.gate 冲突时以 tasks 重算）
 * 6. deliverables ⊆ 允许集合、≥1、去重
 * 7. title 超长截断（不 reject）；estimateMinutes 3–60 修正（不 reject）
 * 8. 可选 tool ∈ toolRegistry 且属该 agent 工具域（v1.1 不产 tool，v1.2 防线）
 *
 * 通过后本地补正：id 重编号 t1..tn（deps 同步映射）。seconds / gate 文案 / 产物
 * Markdown 不在此层生成（见 planTypes.adaptPlanToTasks 与模板）。
 */
import { toolRegistry } from '../agent/ToolRegistry'
import type { ArtifactKindCn, DirectorAgentId, GateId, MissionKind } from './types'
import {
  ARTIFACT_KINDS_CN,
  DIRECTOR_AGENT_IDS,
  DIRECTOR_AGENT_TOOLS,
  GATE_IDS,
  MISSION_KINDS,
  WIRE_PLAN_TITLE_MAX,
  WIRE_TASK_TITLE_MAX,
  clampEstimateMinutes,
  type MissionPlan,
  type WirePlanTask,
} from './planTypes'

export interface ValidatePlanResult {
  ok: boolean
  /** ok=true 时为本地补正后的合法计划（id 已重编号 t1..tn） */
  plan?: MissionPlan
  /** reject 原因（可直接拼进重试 prompt，≤ 若干条） */
  errors: string[]
  /** 已本地修正项（title 截断 / estimate 修正 / gates 重算等），供日志与重试提示 */
  fixed: string[]
}

/** 单条 task 的中间形态：允许字段缺失，最后统一由 errors 决定 ok */
interface CandidateTask {
  /** 原始数组下标（报错用） */
  index: number
  id: string
  agentId?: DirectorAgentId
  title: string
  deps: string[]
  gate?: GateId
  tool?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 错误里描述非法值：保留类型信息，避免 undefined/对象打不出内容 */
function describe(value: unknown): string {
  if (typeof value === 'string') return value ? `「${value.slice(0, 24)}」` : '空字符串'
  if (value === undefined) return '缺失'
  if (value === null) return 'null'
  if (Array.isArray(value)) return '数组'
  if (typeof value === 'object') return '对象'
  return String(value)
}

/** 按 Unicode 码点截断（中文标题按「字」计，避免 surrogate 截半） */
function truncateChars(value: string, max: number): string {
  const chars = [...value]
  return chars.length > max ? chars.slice(0, max).join('') : value
}

function charLength(value: string): number {
  return [...value].length
}

/* ------------------------------------------------------------------ */
/* 主校验入口                                                          */
/* ------------------------------------------------------------------ */

export function validatePlan(raw: unknown): ValidatePlanResult {
  const errors: string[] = []
  const fixed: string[] = []

  if (!isRecord(raw)) {
    return { ok: false, errors: ['[#0] 计划必须是 JSON 对象'], fixed }
  }

  /* ---- #1 kind ---- */
  const kind = MISSION_KINDS.includes(raw.kind as MissionKind) ? (raw.kind as MissionKind) : undefined
  if (!kind) errors.push(`[#1] kind 非法：${describe(raw.kind)}（允许 ${MISSION_KINDS.join(' / ')}）`)

  /* ---- #2 tasks 数量与逐项结构 ---- */
  if (!Array.isArray(raw.tasks)) {
    return { ok: false, errors: [...errors, '[#2] tasks 必须是数组（4–8 个）'], fixed }
  }
  if (raw.tasks.length < 4 || raw.tasks.length > 8) {
    errors.push(`[#2] tasks 数量为 ${raw.tasks.length}，要求 4–8 个`)
  }

  const tasks: CandidateTask[] = []
  raw.tasks.forEach((rawTask, index) => {
    const label = `第 ${index + 1} 个 task`
    if (!isRecord(rawTask)) {
      errors.push(`[#2] ${label} 不是对象`)
      return
    }
    const id = asTrimmedString(rawTask.id)
    if (!id) errors.push(`[#2] ${label} 缺少 id`)

    const rawAgentId = rawTask.agentId
    const agentId = DIRECTOR_AGENT_IDS.includes(rawAgentId as DirectorAgentId)
      ? (rawAgentId as DirectorAgentId)
      : undefined
    if (!agentId) errors.push(`[#3] ${label} agentId 不在名册：${describe(rawAgentId)}`)

    let title = asTrimmedString(rawTask.title)
    if (!title) {
      errors.push(`[#7] ${label} 缺少 title`)
    } else if (charLength(title) > WIRE_TASK_TITLE_MAX) {
      const original = charLength(title)
      title = truncateChars(title, WIRE_TASK_TITLE_MAX)
      fixed.push(`${label} title 超长（${original} 字）已截断为 ${WIRE_TASK_TITLE_MAX} 字`)
    }

    /* ---- #4 deps 形态（引用/环/链长在下面统一算） ---- */
    let deps: string[] = []
    if (rawTask.deps === undefined || rawTask.deps === null) {
      fixed.push(`${label} deps 缺省，已按空数组处理`)
    } else if (!Array.isArray(rawTask.deps)) {
      errors.push(`[#4] ${label} deps 必须是数组`)
    } else {
      for (const dep of rawTask.deps) {
        const depId = asTrimmedString(dep)
        if (!depId) {
          errors.push(`[#4] ${label} deps 含非法项：${describe(dep)}`)
          continue
        }
        deps.push(depId)
      }
      const deduped = [...new Set(deps)]
      if (deduped.length !== deps.length) {
        fixed.push(`${label} deps 已去重`)
        deps = deduped
      }
    }

    /* ---- #5 task.gate 白名单 ---- */
    let gate: GateId | undefined
    if (rawTask.gate !== undefined && rawTask.gate !== null) {
      if (GATE_IDS.includes(rawTask.gate as GateId)) gate = rawTask.gate as GateId
      else errors.push(`[#5] ${label} gate 非法：${describe(rawTask.gate)}`)
    }

    /* ---- #8 可选 tool：注册表 + agent 工具域 ---- */
    let tool: string | undefined
    if (rawTask.tool !== undefined && rawTask.tool !== null) {
      const toolName = asTrimmedString(rawTask.tool)
      if (!toolName) {
        errors.push(`[#8] ${label} tool 必须是非空字符串`)
      } else if (!toolRegistry.has(toolName)) {
        errors.push(`[#8] ${label} tool 未注册：${describe(toolName)}`)
      } else if (!agentId || !(DIRECTOR_AGENT_TOOLS[agentId] ?? []).includes(toolName)) {
        errors.push(`[#8] ${label} tool「${toolName}」不属于 ${agentId ?? '未知成员'} 的工具域`)
      } else {
        tool = toolName
      }
    }

    tasks.push({ index, id: id || `__missing_id_${index}`, agentId, title, deps, gate, tool })
  })

  /* ---- #3 至少 2 个非 chief 成员（按去重后的 agentId 计） ---- */
  const nonChiefAgents = new Set<DirectorAgentId>()
  for (const task of tasks) {
    if (task.agentId && task.agentId !== 'chief') nonChiefAgents.add(task.agentId)
  }
  if (nonChiefAgents.size < 2) {
    errors.push(`[#3] 至少需要 2 个非 chief 成员参与，当前为 ${nonChiefAgents.size} 个`)
  }

  /* ---- #4 id 重复 / 悬空依赖 / 自依赖 / 环 / 最长链 ---- */
  const idCount = new Map<string, number>()
  for (const task of tasks) idCount.set(task.id, (idCount.get(task.id) ?? 0) + 1)
  const duplicateIds = [...idCount.entries()].filter(([, count]) => count > 1).map(([id]) => id)
  if (duplicateIds.length) {
    errors.push(`[#4] task id 重复：${duplicateIds.join('、')}`)
  }

  const knownIds = new Set(tasks.map((task) => task.id))
  for (const task of tasks) {
    for (const dep of task.deps) {
      if (!knownIds.has(dep)) errors.push(`[#4] task ${task.id} 的依赖「${dep}」不存在`)
      else if (dep === task.id) errors.push(`[#4] task ${task.id} 不能依赖自身`)
    }
  }

  const graph = buildDependencyGraph(tasks)
  if (graph.hasCycle) {
    errors.push('[#4] deps 存在环')
  } else if (graph.longestChain > 3) {
    errors.push(`[#4] deps 最长链为 ${graph.longestChain} 个任务，要求 ≤3`)
  }

  /* ---- #5 gates：声明白名单 + 数量，落位冲突以 tasks 重算 ---- */
  let declaredGates: GateId[] = []
  if (!Array.isArray(raw.gates)) {
    errors.push('[#5] gates 必须是数组（1–2 个 GateId）')
  } else {
    const rawGates = raw.gates
    if (rawGates.length < 1 || rawGates.length > 2) {
      errors.push(`[#5] gates 数量为 ${rawGates.length}，要求 1–2 个`)
    }
    for (const rawGate of rawGates) {
      if (GATE_IDS.includes(rawGate as GateId)) declaredGates.push(rawGate as GateId)
      else errors.push(`[#5] gates 含非法门：${describe(rawGate)}`)
    }
    const deduped = [...new Set(declaredGates)]
    if (deduped.length !== declaredGates.length) {
      fixed.push('gates 已去重')
    }
    declaredGates = deduped
  }

  const derivedGates: GateId[] = []
  for (const task of tasks) {
    if (task.gate && !derivedGates.includes(task.gate)) derivedGates.push(task.gate)
  }
  if (derivedGates.length < 1 || derivedGates.length > 2) {
    errors.push(`[#5] 挂在任务上的审批门须为 1–2 个，当前为 ${derivedGates.length} 个`)
  } else if (!sameGateList(declaredGates, derivedGates)) {
    fixed.push(`gates 与 task.gate 不一致，已按任务重算为 ${derivedGates.join('、')}`)
  }

  /* ---- #6 deliverables 白名单 / 非空 / 去重 ---- */
  let deliverables: ArtifactKindCn[] = []
  if (!Array.isArray(raw.deliverables)) {
    errors.push('[#6] deliverables 必须是数组（≥1 个允许 kind）')
  } else {
    const kept: ArtifactKindCn[] = []
    for (const rawDeliverable of raw.deliverables) {
      if (ARTIFACT_KINDS_CN.includes(rawDeliverable as ArtifactKindCn)) {
        kept.push(rawDeliverable as ArtifactKindCn)
      } else {
        errors.push(`[#6] deliverables 含非法 kind：${describe(rawDeliverable)}`)
      }
    }
    const deduped = [...new Set(kept)]
    if (deduped.length !== kept.length) {
      fixed.push('deliverables 已去重')
    }
    if (deduped.length < 1) errors.push('[#6] deliverables 至少需要 1 个')
    deliverables = deduped
  }

  /* ---- #7 计划级 title（截断不 reject）与 estimateMinutes（修正不 reject） ---- */
  let title = asTrimmedString(raw.title)
  if (!title) {
    errors.push('[#7] title 缺失')
  } else if (charLength(title) > WIRE_PLAN_TITLE_MAX) {
    const original = charLength(title)
    title = truncateChars(title, WIRE_PLAN_TITLE_MAX)
    fixed.push(`title 超长（${original} 字）已截断为 ${WIRE_PLAN_TITLE_MAX} 字`)
  }

  let estimateMinutes: number
  if (typeof raw.estimateMinutes === 'number' && Number.isFinite(raw.estimateMinutes)) {
    estimateMinutes = clampEstimateMinutes(raw.estimateMinutes)
    if (estimateMinutes !== raw.estimateMinutes) {
      fixed.push(`estimateMinutes ${raw.estimateMinutes} 已修正为 ${estimateMinutes}`)
    }
  } else {
    estimateMinutes = clampEstimateMinutes(tasks.length * 2)
    fixed.push(`estimateMinutes 缺失/非数字，已按任务数修正为 ${estimateMinutes}`)
  }

  if (errors.length > 0) {
    return { ok: false, errors, fixed }
  }

  /* ---- 通过：本地补正 id 重编号（deps 同步映射） ---- */
  const idMap = new Map<string, string>()
  tasks.forEach((task, index) => {
    if (!idMap.has(task.id)) idMap.set(task.id, `t${index + 1}`)
  })
  let renumbered = false
  const normalizedTasks: WirePlanTask[] = tasks.map((task, index) => {
    const id = `t${index + 1}`
    if (id !== task.id) renumbered = true
    const deps: string[] = []
    for (const dep of task.deps) {
      const mapped = idMap.get(dep)
      if (!mapped || mapped === id || deps.includes(mapped)) continue
      deps.push(mapped)
    }
    const normalized: WirePlanTask = {
      id,
      agentId: task.agentId as DirectorAgentId,
      title: task.title,
      deps,
      ...(task.gate ? { gate: task.gate } : {}),
      ...(task.tool ? { tool: task.tool } : {}),
    }
    return normalized
  })
  if (renumbered) fixed.push('task id 已重编号为 t1..tn')

  const plan: MissionPlan = {
    kind: kind as MissionKind,
    title,
    tasks: normalizedTasks,
    gates: derivedGates,
    deliverables,
    estimateMinutes,
  }
  return { ok: true, plan, errors, fixed }
}

/* ------------------------------------------------------------------ */
/* 依赖图：环检测 + 最长链（Kahn 拓扑序，O(V+E)）                        */
/* ------------------------------------------------------------------ */

interface DependencyGraph {
  hasCycle: boolean
  /** 最长链上的任务数（DAG；有环时为 0） */
  longestChain: number
}

function buildDependencyGraph(tasks: CandidateTask[]): DependencyGraph {
  /* 重复 id 在 #4 已报错；这里按首个出现的 task 建图，保证不崩 */
  const idSet = new Set<string>()
  const uniqueTasks: CandidateTask[] = []
  for (const task of tasks) {
    if (idSet.has(task.id)) continue
    idSet.add(task.id)
    uniqueTasks.push(task)
  }

  const indegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()
  for (const task of uniqueTasks) {
    const deps = task.deps.filter((dep) => dep !== task.id && idSet.has(dep))
    indegree.set(task.id, deps.length)
    for (const dep of deps) {
      const list = dependents.get(dep) ?? []
      list.push(task.id)
      dependents.set(dep, list)
    }
  }

  const chainLength = new Map<string, number>()
  const queue = uniqueTasks.filter((task) => (indegree.get(task.id) ?? 0) === 0).map((task) => task.id)
  const processed: string[] = []
  while (queue.length > 0) {
    const id = queue.shift() as string
    processed.push(id)
    const current = chainLength.get(id) ?? 1
    for (const dependent of dependents.get(id) ?? []) {
      chainLength.set(dependent, Math.max(chainLength.get(dependent) ?? 1, current + 1))
      const remaining = (indegree.get(dependent) ?? 1) - 1
      indegree.set(dependent, remaining)
      if (remaining === 0) queue.push(dependent)
    }
  }

  const longestChain = processed.reduce((max, id) => Math.max(max, chainLength.get(id) ?? 1), 0)
  return { hasCycle: processed.length < uniqueTasks.length, longestChain }
}

function sameGateList(a: GateId[], b: GateId[]): boolean {
  if (a.length !== b.length) return false
  return a.every((gate) => b.includes(gate))
}
