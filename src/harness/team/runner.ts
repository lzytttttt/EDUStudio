/**
 * v1.2 M3a · MissionRunner 真执行内核（Director lazy chunk；roadmap §4.2 / §4.6）
 *
 * 职责（只做执行，不碰 store / UI / 网络）：
 * - 计划校验：空计划 / 未知执行成员 / 依赖 id 不存在 / 环 → 直接拒绝执行（非法计划永不上屏）；
 * - 调度：Kahn 拓扑 + ready-set（依赖全部成功才就绪），并发上限走 `ConcurrencyGovernor`
 *   （缺省 2，任务按 plan 顺序 FIFO 入闸；只在真正执行时占用许可，等门不占槽）；
 * - 单任务：注入 `AgentTaskInput.agent`（id/spec/工具白名单/handoffs/facts），`history` 恒 []，
 *   不读全局会话；trace 中 text/reflect → feed 摘要，artifact_chunk/done → RunnerArtifact；
 * - 容错：单任务超时（缺省 90s）→ 重试 ≤1（缺省）→ 仍失败只标 failed 并继续其它分支；
 *   依赖失败的后继任务标记「上游失败未执行」，不发起请求；
 * - 门：任务成功且 `task.gate` → 投影为 ApprovalGate → `deps.gate?.wait`（缺省 continue）；
 *   continue = 成功，cancel = 该任务失败（reason='门被退回'），不影响其它分支；
 * - 门串行化（M3 集成修复）：directorStore 只有单个 `mission.gate`，runner 保证同一时刻最多
 *   一个带门任务在飞（发起时预约槽、settle 后释放，含 cancel/失败/abort）；无门任务仍并发 2；
 * - 结束：status = aborted ? 'cancelled' : failedTasks.length ? 'partial' : 'done'；
 *   事件 seq 从 1 单调递增，sink 单 handler 异常隔离（try/catch），不影响调度；
 * - 刷新续跑（M3 optional）：`deps.completedTasks` 里的 task 视为已完成 seed——不 emit 事件、
 *   不计 attempts、不占并发槽，调度时跳过，依赖它们的任务视为依赖满足。
 */
import type {
  AgentFactRef,
  AgentHandoff,
  AgentProvider,
  AgentTaskInput,
  AgentTraceEvent,
  ArtifactKind,
  RoleId,
} from '../types'
import type {
  AgentSpec,
  ApprovalGate,
  ExecutionPlan,
  MissionPlanTask,
  MissionRunEvent,
} from '../../studio/contracts'
import { DIRECTOR_AGENT_IDS } from '../../studio/contracts'
import type { ArtifactKindCn, DirectorAgentId, Fact } from '../director/types'
import type { LoomEdge } from '../loom/types'
import { findCycle } from '../../lib/loomGraph'
import { createConcurrencyGovernor } from '../../studio/concurrency'
import { toKindCn } from '../../studio/mapping'
import { agentSpecFor, resolveToolWhitelist } from './agents'
import { createMissionGate, type MissionGateTask } from './gate'
import type { MissionGateWaiter, MissionRunnerDeps, MissionRunnerResult, MissionRunSink, RunnerArtifact } from './types'

/* ------------------------------------------------------------------ */
/* 对外常量（缺省值；M3a 控制器 / 演示可注入更短超时）                    */
/* ------------------------------------------------------------------ */

/** 单任务超时（真执行 90s；roadmap §4.2） */
export const DEFAULT_TASK_TIMEOUT_MS = 90_000
/** 单任务失败重试次数（≤1 次；roadmap §4.2） */
export const DEFAULT_MAX_TASK_RETRIES = 1
/** 并发上限（roadmap §4.2：2 许可） */
export const DEFAULT_CONCURRENCY = 2

/** 失败依赖后继的失败原因（口径固定，UI 按原文展示） */
const UPSTREAM_FAILED_REASON = '上游失败未执行'
/** 单行 feed 摘要上限（「少字」：动态流不铺长文本） */
const FEED_TEXT_MAX = 46
/** 交给下游 handoff 的摘要上限 */
const HANDOFF_SUMMARY_MAX = 160

const ENGLISH_ARTIFACT_KINDS: readonly ArtifactKind[] = ['lessonPlan', 'report', 'notice', 'analysis', 'generic']
const CHINESE_ARTIFACT_KINDS: readonly ArtifactKindCn[] = ['简报', '讲稿', '大纲', '信件', '练习单', '教案', '摘要']

/* ------------------------------------------------------------------ */
/* 内部类型与工具                                                       */
/* ------------------------------------------------------------------ */

interface TaskOutcome {
  status: 'done' | 'failed' | 'cancelled'
  reason?: string
  summary: string
  citations: { value: string; source: string; factId?: string }[]
  artifacts: RunnerArtifact[]
}

interface PlanIssue {
  taskId: string
  reason: string
}

/** 单次 attempt 的 trace 收集器（失败 attempt 的产物随之丢弃，不进发布链） */
interface AttemptCollector {
  lastText: string
  lastReflect: string
  artifacts: RunnerArtifact[]
  artifactIds: string[]
  open: Map<string, { title: string; docKind?: string; chunks: string[] }>
}

/** 超时错误（与 AbortError 区分：超时走重试，abort 直接取消） */
class TaskTimeoutError extends Error {
  readonly timeoutMs: number
  constructor(timeoutMs: number) {
    super(`执行超时（${timeoutMs}ms）`)
    this.name = 'TaskTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

function createCollector(): AttemptCollector {
  return { lastText: '', lastReflect: '', artifacts: [], artifactIds: [], open: new Map() }
}

function cancelledOutcome(): TaskOutcome {
  return { status: 'cancelled', summary: '', citations: [], artifacts: [] }
}

/** 单行摘要：压缩空白 + 截断（中文按码点截，不切半 surrogate） */
function summarizeText(text: string, max = FEED_TEXT_MAX): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return `${[...clean].slice(0, max).join('')}…`
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name || '执行失败'
  const text = String(error ?? '')
  return text || '执行失败'
}

function abortError(): Error {
  if (typeof DOMException === 'function') return new DOMException('Aborted', 'AbortError')
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

function normalizeRetries(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_TASK_RETRIES
  return Math.max(0, Math.floor(value))
}

function normalizeConcurrency(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_CONCURRENCY
  return Math.max(1, Math.floor(value))
}

function normalizeTimeout(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return DEFAULT_TASK_TIMEOUT_MS
  return Math.floor(value)
}

/** docKind（trace 里是字符串）→ 中文交付物类型：英文 ArtifactKind 走 toKindCn，中文原样保留 */
function kindCnOfDocKind(docKind: string | undefined): ArtifactKindCn | undefined {
  if (!docKind) return undefined
  if ((ENGLISH_ARTIFACT_KINDS as readonly string[]).includes(docKind)) {
    return toKindCn(docKind as ArtifactKind)
  }
  if ((CHINESE_ARTIFACT_KINDS as readonly string[]).includes(docKind)) return docKind as ArtifactKindCn
  return undefined
}

/** 从交付物 Markdown 的 `{{值~来源}}` 标记提取 handoff citations（去重） */
function extractCitations(markdowns: string[]): { value: string; source: string; factId?: string }[] {
  const seen = new Set<string>()
  const citations: { value: string; source: string; factId?: string }[] = []
  for (const markdown of markdowns) {
    if (!markdown) continue
    for (const match of markdown.matchAll(/\{\{([^{}~]+)~([^{}]+)\}\}/g)) {
      const value = match[1].trim()
      const source = match[2].trim()
      if (!value || !source) continue
      const key = `${value}\u0000${source}`
      if (seen.has(key)) continue
      seen.add(key)
      citations.push({ value, source })
    }
  }
  return citations
}

/** 上游事实快照 → AgentTaskInput.agent.facts（数字只能引用这些值） */
function buildFactRefs(facts: Fact[]): AgentFactRef[] {
  return facts.map((fact) => ({
    factId: fact.factId,
    key: fact.key,
    value: fact.value,
    unit: fact.unit,
    label: fact.label,
    source: fact.source,
  }))
}

/** MissionPlanTask[] → loomGraph 的 dependency 边（复用 findCycle 做环检测） */
function buildDependencyEdges(tasks: MissionPlanTask[]): LoomEdge[] {
  const edges: LoomEdge[] = []
  tasks.forEach((task, index) => {
    if (!task.id) return
    for (const dep of task.deps ?? []) {
      edges.push({ id: `dep-${index}-${dep}-${task.id}`, from: dep, to: task.id, type: 'dependency', createdAt: 0 })
    }
  })
  return edges
}

/** 计划校验（只拒绝执行，不修计划；非法计划由上层保证永不上屏） */
function validateMissionPlan(tasks: MissionPlanTask[], specs: Record<DirectorAgentId, AgentSpec>): PlanIssue[] {
  if (tasks.length === 0) return [{ taskId: '', reason: '计划为空，未执行' }]

  const issues: PlanIssue[] = []
  const ids = new Set<string>()
  for (const task of tasks) {
    if (!task.id) {
      issues.push({ taskId: '', reason: '存在缺少 id 的任务，未执行' })
      continue
    }
    if (ids.has(task.id)) issues.push({ taskId: task.id, reason: `任务 id 重复：${task.id}，未执行` })
    ids.add(task.id)
  }

  for (const task of tasks) {
    if (!task.id) continue
    if (!DIRECTOR_AGENT_IDS.includes(task.agentId) || !specs[task.agentId]) {
      issues.push({ taskId: task.id, reason: `未知执行成员：${String(task.agentId)}，未执行` })
    }
  }

  for (const task of tasks) {
    if (!task.id) continue
    for (const dep of task.deps ?? []) {
      if (!ids.has(dep)) issues.push({ taskId: task.id, reason: `依赖任务不存在：${dep}，未执行` })
      else if (dep === task.id) issues.push({ taskId: task.id, reason: '任务不能依赖自己，未执行' })
    }
  }

  const cycle = findCycle(buildDependencyEdges(tasks))
  if (cycle) issues.push({ taskId: cycle[0] ?? '', reason: `计划存在循环依赖：${cycle.join(' → ')}，未执行` })
  return issues
}

/** AgentSpec 合并：注册表缺省 ← ExecutionPlan 冻结 ← deps 注入（控制器优先） */
function resolveSpecs(plan: ExecutionPlan, deps: MissionRunnerDeps): Record<DirectorAgentId, AgentSpec> {
  const specs = {} as Record<DirectorAgentId, AgentSpec>
  for (const id of DIRECTOR_AGENT_IDS) {
    specs[id] = { ...agentSpecFor(id), ...(plan.agentSpecs?.[id] ?? {}), ...(deps.agentSpecs?.[id] ?? {}) }
  }
  return specs
}

/** 上游 handoff：只传已完成依赖的 typed 产物摘要 + citations（不传会话 / 不传正文） */
function buildHandoffs(
  task: MissionPlanTask,
  taskById: Map<string, MissionPlanTask>,
  outcomes: Map<string, TaskOutcome>,
): AgentHandoff[] {
  const handoffs: AgentHandoff[] = []
  for (const depId of task.deps ?? []) {
    const dep = taskById.get(depId)
    const outcome = outcomes.get(depId)
    if (!dep || !outcome || outcome.status !== 'done') continue
    const artifactTitles = outcome.artifacts.map((artifact) => artifact.title).filter(Boolean).join('、')
    const summary = artifactTitles
      ? `${artifactTitles}${outcome.summary ? `｜${outcome.summary}` : ''}`
      : outcome.summary || `${dep.title}已完成`
    handoffs.push({
      from: dep.agentId,
      to: task.agentId,
      taskId: dep.id,
      summary: summarizeText(summary, HANDOFF_SUMMARY_MAX),
      citations: outcome.citations,
    })
  }
  return handoffs
}

/** 任务输出摘要（handoff / task.done 用）：优先最终产物名 + 最后一段文本 */
function taskSummary(collector: AttemptCollector, task: MissionPlanTask): string {
  const artifactTitles = collector.artifacts.map((artifact) => artifact.title).filter(Boolean).join('、')
  const text = collector.lastText || collector.lastReflect
  if (artifactTitles && text) return summarizeText(`${artifactTitles}：${text}`, HANDOFF_SUMMARY_MAX)
  if (artifactTitles) return summarizeText(artifactTitles, HANDOFF_SUMMARY_MAX)
  return summarizeText(text || `${task.title}已完成`, HANDOFF_SUMMARY_MAX)
}

/** trace → feed 摘要 / 产物收集（text·reflect·done → feed；artifact_* → RunnerArtifact） */
function handleTrace(
  event: AgentTraceEvent,
  collector: AttemptCollector,
  task: MissionPlanTask,
  agentId: DirectorAgentId,
  emit: (event: Omit<MissionRunEvent, 'seq'>) => void,
): void {
  switch (event.kind) {
    case 'artifact_meta':
      collector.open.set(event.artifactId, { title: event.title, docKind: event.docKind, chunks: [] })
      return
    case 'artifact_chunk': {
      const entry = collector.open.get(event.artifactId) ?? { title: task.title, docKind: undefined, chunks: [] }
      entry.chunks.push(event.chunk)
      collector.open.set(event.artifactId, entry)
      return
    }
    case 'artifact_done': {
      const entry = collector.open.get(event.artifactId) ?? { title: task.title, docKind: event.docKind, chunks: [] }
      collector.open.delete(event.artifactId)
      const kindCn = kindCnOfDocKind(event.docKind || entry.docKind)
      collector.artifacts.push({
        taskId: task.id,
        agentId,
        title: event.title || entry.title || task.title,
        markdown: entry.chunks.join(''),
        ...(kindCn ? { kindCn } : {}),
      })
      collector.artifactIds.push(event.artifactId)
      return
    }
    case 'text':
    case 'done':
      collector.lastText = event.text
      emit({ kind: 'feed', taskId: task.id, agentId, text: summarizeText(event.text) })
      return
    case 'reflect':
      collector.lastReflect = event.text
      emit({ kind: 'feed', taskId: task.id, agentId, text: summarizeText(event.text) })
      return
    case 'plan':
      emit({ kind: 'feed', taskId: task.id, agentId, text: `已拆解 ${event.steps.length} 个步骤` })
      return
    default:
      /* tool_call / tool_result / skill_*：不铺进 feed（少字原则） */
      return
  }
}

/** 续跑 seed 归一：去重、只认 plan 里存在的 task id（不存在的 seed 静默忽略，不影响调度与校验） */
function normalizeSeededTasks(seed: string[] | undefined, taskById: Map<string, MissionPlanTask>): string[] {
  if (!Array.isArray(seed)) return []
  const seen = new Set<string>()
  const ids: string[] = []
  for (const id of seed) {
    if (typeof id !== 'string' || !id || seen.has(id) || !taskById.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

/**
 * 单次 Agent 执行，带超时 / abort 竞速：
 * - 超时 → abort 子 signal → reject TaskTimeoutError（走重试）；
 * - 父 signal abort → abort 子 signal → reject AbortError（走取消）；
 * - provider 忽略 abort 也不会挂住 runner（settle 幂等）。
 */
function runAgentAttempt(
  agent: AgentProvider,
  input: AgentTaskInput,
  controller: AbortController,
  timeoutMs: number,
  signal: AbortSignal,
  onTrace: (event: AgentTraceEvent) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    function cleanup(): void {
      if (timer !== undefined) clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }

    function settle(error?: unknown): void {
      if (settled) return
      settled = true
      cleanup()
      if (error === undefined) resolve()
      else reject(error)
    }

    function onAbort(): void {
      controller.abort()
      settle(abortError())
    }

    signal.addEventListener('abort', onAbort)
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        controller.abort()
        settle(new TaskTimeoutError(timeoutMs))
      }, timeoutMs)
    }
    agent.runTask(input, onTrace).then(
      () => settle(),
      (error: unknown) => settle(error ?? new Error('执行失败')),
    )
  })
}

/** 等门：缺省 continue；期间父 signal abort 时立刻以 AbortError 结束（避免挂住 runner） */
function waitForGate(
  waiter: MissionGateWaiter | undefined,
  gate: ApprovalGate,
  signal: AbortSignal,
): Promise<'continue' | 'cancel'> {
  if (!waiter) return Promise.resolve('continue')
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<'continue' | 'cancel'>((resolve, reject) => {
    let settled = false
    function cleanup(): void {
      signal.removeEventListener('abort', onAbort)
    }
    function onAbort(): void {
      if (settled) return
      settled = true
      cleanup()
      reject(abortError())
    }
    signal.addEventListener('abort', onAbort)
    waiter.wait(gate, signal).then(
      (resolution) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(resolution)
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error ?? new Error('门等待失败'))
      },
    )
  })
}

/* ------------------------------------------------------------------ */
/* 主入口                                                              */
/* ------------------------------------------------------------------ */

/**
 * 执行一个 mission 计划（真执行内核；不写 store，事件经 sink 交给控制器映射）。
 * @param plan 冻结计划（tasks.deps[] 构成 DAG；facts 为本轮事实快照）
 * @param deps 注入依赖（AgentProvider / 门等待器 / 并发 / 超时 / 重试 / 时间源）
 * @param sink 运行事件回调（同步调用；单 handler 异常已隔离）
 * @param signal 父级取消信号（abort → status='cancelled'，已产出保留）
 */
export async function runMission(
  plan: ExecutionPlan,
  deps: MissionRunnerDeps,
  sink: MissionRunSink,
  signal: AbortSignal,
): Promise<MissionRunnerResult> {
  const now = deps.now ?? Date.now
  const startedAt = now()
  let seq = 0
  const emit = (event: Omit<MissionRunEvent, 'seq'>): void => {
    seq += 1
    const payload = { seq, ...event } as MissionRunEvent
    try {
      sink(payload)
    } catch (error) {
      console.error('[teamRunner] sink 异常已隔离:', error)
    }
  }

  const tasks: MissionPlanTask[] = Array.isArray(plan.tasks) ? plan.tasks : []
  const specs = resolveSpecs(plan, deps)

  /* ---- ① 计划校验：非法计划不执行 ---- */
  const issues = validateMissionPlan(tasks, specs)
  if (issues.length > 0) {
    for (const issue of issues) {
      emit({ kind: 'error', ...(issue.taskId ? { taskId: issue.taskId } : {}), error: issue.reason, text: issue.reason })
    }
    emit({ kind: 'partial', error: `${issues.length} 个环节未执行`, text: `计划未执行：${issues[0].reason}` })
    return {
      status: 'partial',
      completedTasks: [],
      failedTasks: issues.map((issue) => ({ taskId: issue.taskId, reason: issue.reason })),
      artifactIds: [],
      artifacts: [],
      elapsedMs: Math.max(0, now() - startedAt),
      attempts: 0,
    }
  }

  /* ---- ② 调度状态 ---- */
  const concurrency = normalizeConcurrency(deps.concurrency)
  const maxRetries = normalizeRetries(deps.maxTaskRetries)
  const timeoutMs = normalizeTimeout(deps.taskTimeoutMs)
  const governor = createConcurrencyGovernor({ limit: concurrency })
  const facts = buildFactRefs((deps.snapshot ?? plan.facts)?.facts ?? [])
  const taskById = new Map(tasks.map((task) => [task.id, task]))

  const outcomes = new Map<string, TaskOutcome>()
  const running = new Map<string, Promise<void>>()
  const completedTasks: string[] = []
  const failedTasks: { taskId: string; reason: string }[] = []
  const artifacts: RunnerArtifact[] = []
  const artifactIds: string[] = []
  let attempts = 0

  /* ---- ②b 刷新续跑 seed：已完成的 task 直接视为 done ----
   * 不 emit 事件、不计 attempts、不占并发槽；调度时跳过；依赖它的任务视为依赖满足。 */
  const seeded = normalizeSeededTasks(deps.completedTasks, taskById)
  for (const id of seeded) {
    outcomes.set(id, { status: 'done', summary: '', citations: [], artifacts: [] })
    completedTasks.push(id)
  }
  const pending = tasks.filter((task) => !outcomes.has(task.id))

  /**
   * v1.2 M3 门串行化：directorStore 只有单个 `mission.gate` 字段，因此**同一时刻最多一个带门任务在飞**。
   * 在「发起时」预约该槽（不是等门时才占），保证不会有两个任务同时走到门互相覆盖；
   * 任务 settle（continue / cancel / 失败 / abort）后释放，其它就绪的带门任务回到调度；
   * 无门任务不受此限制（仍只受并发上限约束）。
   */
  let gateSlotBusy = false

  const markFailed = (task: MissionPlanTask, reason: string): void => {
    outcomes.set(task.id, { status: 'failed', reason, summary: '', citations: [], artifacts: [] })
    failedTasks.push({ taskId: task.id, reason })
    emit({ kind: 'error', taskId: task.id, agentId: task.agentId, error: reason, text: `「${task.title}」未完成：${reason}` })
  }

  /* ---- ③ 单任务执行（含重试 / 门 / 产物提交） ---- */
  const executeTask = async (task: MissionPlanTask): Promise<void> => {
    const agentId = task.agentId
    const spec = specs[agentId]
    const baseRole: RoleId = spec.baseRole === 'inherit' ? 'teacher' : spec.baseRole
    emit({ kind: 'task.start', taskId: task.id, agentId, text: task.title })
    const handoffs = buildHandoffs(task, taskById, outcomes)

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (signal.aborted) {
        outcomes.set(task.id, cancelledOutcome())
        return
      }
      attempts += 1
      const collector = createCollector()
      const controller = new AbortController()
      const input: AgentTaskInput = {
        role: baseRole,
        goal: task.title,
        // 隔离红线：mission 路径只含 declared handoffs，不读全局会话（roadmap §4.3）
        history: [],
        signal: controller.signal,
        agent: {
          id: agentId,
          name: spec.name,
          baseRole: spec.baseRole,
          tools: resolveToolWhitelist(spec, baseRole),
          memoryNs: spec.memoryNs,
          skillNs: spec.skillNs,
          notDo: spec.notDo,
          missionId: plan.missionId,
          taskId: task.id,
          handoffs,
          facts,
        },
      }

      // 并发许可只包住真实执行，等门不占槽（否则两个门会把整条 mission 卡死）
      const release = await governor.acquire('background')
      try {
        if (signal.aborted) {
          outcomes.set(task.id, cancelledOutcome())
          return
        }
        await runAgentAttempt(deps.agent, input, controller, timeoutMs, signal, (event) => {
          handleTrace(event, collector, task, agentId, emit)
        })
      } catch (error) {
        if (signal.aborted) {
          outcomes.set(task.id, cancelledOutcome())
          return
        }
        if (attempt < maxRetries) {
          emit({
            kind: 'feed',
            taskId: task.id,
            agentId,
            text: `第 ${attempt + 1} 次执行未完成，正在重试「${summarizeText(task.title, 18)}」`,
          })
          continue
        }
        markFailed(task, describeError(error))
        return
      } finally {
        release()
      }

      /* ---- 成功：提交本 attempt 产物（失败 attempt 的产物已随 collector 丢弃） ---- */
      for (const artifact of collector.artifacts) {
        artifacts.push(artifact)
        emit({
          kind: 'artifact',
          taskId: task.id,
          agentId,
          artifact: {
            title: artifact.title,
            markdown: artifact.markdown,
            ...(artifact.kindCn ? { kindCn: artifact.kindCn } : {}),
          },
        })
      }
      artifactIds.push(...collector.artifactIds)
      const summary = taskSummary(collector, task)
      const citations = extractCitations(collector.artifacts.map((artifact) => artifact.markdown))

      /* ---- 门：投影为 ApprovalGate → 等待控制器决策（缺省 continue） ---- */
      if (task.gate) {
        const gateTask: MissionGateTask = { ...task, gate: task.gate }
        const gate = createMissionGate(plan, gateTask)
        emit({ kind: 'gate', taskId: task.id, agentId, gate, text: gate.title })
        let resolution: 'continue' | 'cancel'
        try {
          resolution = await waitForGate(deps.gate, gate, signal)
        } catch (error) {
          if (signal.aborted) {
            outcomes.set(task.id, cancelledOutcome())
            return
          }
          resolution = 'cancel'
        }
        if (signal.aborted) {
          outcomes.set(task.id, cancelledOutcome())
          return
        }
        if (resolution === 'cancel') {
          markFailed(task, '门被退回')
          emit({ kind: 'feed', taskId: task.id, agentId, text: `审批门已退回：「${summarizeText(task.title, 18)}」` })
          return
        }
        emit({ kind: 'feed', taskId: task.id, agentId, text: `审批门已通过：「${summarizeText(task.title, 18)}」` })
      }

      outcomes.set(task.id, { status: 'done', summary, citations, artifacts: collector.artifacts })
      completedTasks.push(task.id)
      emit({ kind: 'task.done', taskId: task.id, agentId, text: summary })
      return
    }
  }

  /* ---- ④ ready-set 调度（Kahn 拓扑；失败依赖级联跳过） ---- */
  while (pending.length > 0 || running.size > 0) {
    if (signal.aborted) break

    // 失败依赖级联：不再发起请求，直接标记「上游失败未执行」
    let cascaded = false
    for (const candidate of [...pending]) {
      const failedDep = (candidate.deps ?? []).find((depId) => outcomes.get(depId)?.status === 'failed')
      if (!failedDep) continue
      pending.splice(pending.indexOf(candidate), 1)
      outcomes.set(candidate.id, { status: 'failed', reason: UPSTREAM_FAILED_REASON, summary: '', citations: [], artifacts: [] })
      failedTasks.push({ taskId: candidate.id, reason: UPSTREAM_FAILED_REASON })
      emit({
        kind: 'error',
        taskId: candidate.id,
        agentId: candidate.agentId,
        error: UPSTREAM_FAILED_REASON,
        text: `「${candidate.title}」已跳过：上游环节失败`,
      })
      cascaded = true
    }
    if (cascaded) continue

    const ready = pending.filter((candidate) => {
      if (!(candidate.deps ?? []).every((depId) => outcomes.get(depId)?.status === 'done')) return false
      // 门串行化：已有带门任务在飞时，带门候选保持 pending（不发起 / 不占并发槽 / 不提前标记失败）
      if (candidate.gate && gateSlotBusy) return false
      return true
    })
    if (ready.length === 0) {
      if (running.size === 0) break // 防御：无环 + 未取消时理论不可达
      await Promise.race(running.values())
      continue
    }

    // ready 里可能同时有多个带门候选：只发起第一个，其余留在 pending 等本次门解决
    const launchable: MissionPlanTask[] = []
    for (const candidate of ready) {
      if (candidate.gate) {
        if (gateSlotBusy) continue
        gateSlotBusy = true
      }
      launchable.push(candidate)
    }
    if (launchable.length === 0) {
      if (running.size === 0) break
      await Promise.race(running.values())
      continue
    }

    for (const candidate of launchable) {
      pending.splice(pending.indexOf(candidate), 1)
      const promise = executeTask(candidate)
        .catch((error: unknown) => {
          // 防御：executeTask 内部已兜底；未预期异常也不能挂起整条 mission
          if (!outcomes.has(candidate.id)) markFailed(candidate, describeError(error))
        })
        .finally(() => {
          running.delete(candidate.id)
          // 门槽释放：cancel 路径同样走这里，保证后续带门任务不会被永久悬挂
          if (candidate.gate) gateSlotBusy = false
        })
      running.set(candidate.id, promise)
    }
    await Promise.race(running.values())
  }

  // abort 后在飞任务需要收敛（内部有竞速，不会被忽略 abort 的 provider 挂住）
  if (running.size > 0) await Promise.allSettled([...running.values()])

  /* ---- ⑤ 收尾 ---- */
  const elapsedMs = Math.max(0, now() - startedAt)
  const status: MissionRunnerResult['status'] = signal.aborted
    ? 'cancelled'
    : failedTasks.length > 0
      ? 'partial'
      : 'done'

  if (status === 'partial') {
    emit({
      kind: 'partial',
      error: `${failedTasks.length} 个环节未完成`,
      text: `部分完成：${failedTasks.map((failed) => failed.taskId || '计划').join('、')} 未完成`,
    })
  } else if (status === 'cancelled') {
    emit({ kind: 'feed', text: '任务已取消，已产出的内容保留为草稿' })
  }

  return { status, completedTasks, failedTasks, artifactIds, artifacts, elapsedMs, attempts }
}
