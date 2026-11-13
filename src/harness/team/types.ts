/**
 * v1.2 M3 · 真执行内核契约（Director lazy chunk；语义冻结，实施时只允许 optional 扩展）
 *
 * 依据 doc/v1.2-roadmap.md §4.2（MissionRunner）/ §4.5（交付物发布链路）/ §4.6（降级矩阵）：
 * - 调度只认 `MissionPlanTask.deps[]` 的 DAG（复用 lib/loomGraph 纯函数：拓扑/环/就绪）；
 * - 并发上限由注入的 ConcurrencyGovernor 控制（默认 2，前台优先）；
 * - 单任务超时 + 重试 ≤1；部分失败只标 `execution.outcome='partial'`，**不改 MissionStatus 六值**；
 * - 门（task.gate）由 `deps.gate.wait` 暂停等待，返回 continue/cancel；
 * - 执行产出（artifact trace）收集为 RunnerArtifact，由发布链做证据校验后写入 artifactStore。
 */
import type {
  AgentProvider,
  AgentTraceEvent,
} from '../types'
import type {
  AgentSpec,
  ApprovalGate,
  ExecutionPlan,
  ExecutionResult,
  FactSnapshot,
  MissionRunEvent,
} from '../../studio/contracts'
/** M3a 修复：这两个类型由 director 契约定义，studio/contracts 仅内部 import type，未再导出 */
import type { ArtifactKindCn, DirectorAgentId } from '../director/types'

/** 单任务执行产出（Markdown + 中文类型），交给发布链做 verifyCitations 后写入 artifactStore */
export interface RunnerArtifact {
  taskId: string
  agentId: DirectorAgentId
  title: string
  /** 支持 `{{值~来源}}` 溯源标记（复用旧渲染器） */
  markdown: string
  kindCn?: ArtifactKindCn
}

/** 审批门等待器（mission gate 由执行控制器实现：注册 resolver → 等 store 决策 → 返回） */
export interface MissionGateWaiter {
  wait(gate: ApprovalGate, signal: AbortSignal): Promise<'continue' | 'cancel'>
}

export interface MissionRunnerDeps {
  /** 执行内核：API 模式 Orchestrator / Mock 模式 MockOrchestrator（缺省能力见 §4.6） */
  agent: AgentProvider
  /** 门等待器；缺省 = 自动 continue（仅单测/演示可用） */
  gate?: MissionGateWaiter
  /** 本 mission 冻结的事实快照（注入 agent.facts，并供发布链校验） */
  snapshot?: FactSnapshot
  /** AgentSpec 子集（缺省用 harness/team/agents 的全量注册表） */
  agentSpecs?: Partial<Record<DirectorAgentId, AgentSpec>>
  /** 时间源（测试注入） */
  now?: () => number
  /** 并发上限（缺省 2；与 chat 共享同一 governor 时由控制器注入） */
  concurrency?: number
  /** 单任务超时（缺省 90s；Mock 演示建议注入更短值） */
  taskTimeoutMs?: number
  /** 单任务失败重试次数（缺省 1） */
  maxTaskRetries?: number
  /**
   * v1.2 M3（optional 扩展）：刷新续跑时已完成的 task id（seed）。
   * runner 把它们视为 done（不 emit 事件、不计 attempts、不占并发槽），调度时跳过；
   * 依赖它们的任务视为依赖满足；返回的 completedTasks 包含这些 id（去重，不重复执行）。
   */
  completedTasks?: string[]
}

/** 执行结果：在 contracts.ExecutionResult 之上补交付物收集与失败原因口径 */
export interface MissionRunnerResult extends ExecutionResult {
  artifacts: RunnerArtifact[]
  /** 失败任务明细（含 reason；已包含在 ExecutionResult.failedTasks） */
  failedTasks: { taskId: string; reason: string }[]
  /** 本次执行累计 attempt 数（含重试） */
  attempts: number
}

/** 单个 Agent 执行事件的回调（runner 内部把 trace 映射成 MissionRunEvent 与交付物） */
export type AgentTraceSink = (agent: DirectorAgentId, taskId: string, event: AgentTraceEvent) => void

export type MissionRunSink = (event: MissionRunEvent) => void
