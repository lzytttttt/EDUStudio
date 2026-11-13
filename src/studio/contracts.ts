/**
 * v1.2 M0 · Studio 前端接口契约（主 chunk；只放类型与常量，不含运行时逻辑）
 *
 * 依据 doc/v1.2-roadmap.md §3.1–§3.10 与附录 A（语义冻结）：
 * - 跨工作区 / 跨 chunk 只共享本文契约，不共享实现；
 * - 既有领域类型一律 `import type`（类型擦除，编译后 0 字节，不把 Director / 旧 store 拉进主包）；
 * - 新增字段必须 optional 且缺省行为不变（roadmap §3.7 过渡期纪律）。
 */

import type { AgentTraceEvent, BriefingCard, MemoryEntry, RoleId } from '../harness/types'
import type {
  AgentProfile,
  ArtifactKindCn,
  AutonomyLevel,
  DirectorAgentId,
  Fact,
  MissionKind,
  MissionPlanTask,
  MissionStatus,
  PlanSource,
} from '../harness/director/types'
import type { ExportFormat } from '../lib/exporters'

/* ------------------------------------------------------------------ */
/* 1. 路由与导航（附录 A · §3.2）                                        */
/* ------------------------------------------------------------------ */

export type WorkspaceId = 'director' | 'classic'
export type DirectorView = 'inbox' | 'mission' | 'team'
export type ClassicView = 'chat' | 'loom'
export type RightTab = 'doc' | 'board' | 'flow' | 'team'

export type WorkTarget =
  | { kind: 'inbox' }
  | { kind: 'mission'; id?: string; taskId?: string }
  | { kind: 'team'; agentId?: DirectorAgentId }
  | { kind: 'chat'; id?: string }
  | { kind: 'loom'; id?: string }
  | { kind: 'doc'; id: string }
  | { kind: 'decision'; id: string }
  | { kind: 'briefing'; cardId?: string }
  | { kind: 'board'; role: RoleId }

export interface RouteState {
  workspace: WorkspaceId
  directorView: DirectorView
  classicView: ClassicView
  rightTab: RightTab
  target: WorkTarget | null
}

export interface Navigator {
  open(target: WorkTarget, opts?: { replace?: boolean; source?: 'user' | 'system' | 'deep-link' }): void
  go(route: Partial<RouteState>, opts?: { replace?: boolean }): void
  back(): void
  canBack(): boolean
}

/**
 * 默认路由：影子期（未开 `?v2=1`）的安全落点 = 经典工作区 + 对话 + 文档栏。
 * 深链非法时 parseRoute 也回落到这里（`?v2=1` 时工作区仍按参数保留）。
 */
export const DEFAULT_ROUTE: RouteState = {
  workspace: 'classic',
  directorView: 'inbox',
  classicView: 'chat',
  rightTab: 'doc',
  target: null,
}

/** 战队 6 个执行成员（v1.1 冻结值）：URL `?agent=` 校验与端口测试替身共用 */
export const DIRECTOR_AGENT_IDS: readonly DirectorAgentId[] = [
  'chief',
  'analyst',
  'assessor',
  'curriculum',
  'communicator',
  'steward',
]

/* ------------------------------------------------------------------ */
/* 2. 事件总线（附录 A · §3.4）                                          */
/* ------------------------------------------------------------------ */

export type SurfaceId = 'inbox' | 'mission' | 'team' | 'chat' | 'loom' | 'briefing'

export type StudioEvent =
  | { type: 'card.accepted'; cardId: string; role: RoleId; goal: string }
  | { type: 'card.favorited'; cardId: string; role: RoleId; tag: string }
  | { type: 'intent.submitted'; intent: string; source: 'briefing' | 'inbox' | 'chat'; cardId?: string; sessionId?: string }
  | { type: 'mission.planned'; missionId: string; kind: MissionKind; planSource: PlanSource; tasks: number }
  | { type: 'mission.started'; missionId: string; execution: 'real' | 'mock' }
  | { type: 'mission.task.done'; missionId: string; taskId: string; agentId: DirectorAgentId; artifactIds?: string[] }
  | { type: 'mission.partial'; missionId: string; failedTasks: string[]; reason: string }
  | { type: 'mission.delivered'; missionId: string; artifactIds: string[] }
  | { type: 'artifact.published'; docId: string; title: string; provenance?: ArtifactProvenance }
  | { type: 'artifact.exported'; docId: string; format: 'md' | 'docx' | 'xlsx' | 'pdf' }
  /** 唯一审批门事件：mission gate 与 Loom checkpoint 都投影为 ApprovalGate（含 missionId/source），收件箱按 gateId 去重 */
  | { type: 'gate.waiting'; gate: ApprovalGate }
  | { type: 'gate.resolved'; gateId: string; resolution: 'continue' | 'cancel' }
  | { type: 'agent.feedback'; agentId: DirectorAgentId; outcome: 'accepted' | 'rejected'; ref?: string }
  | { type: 'autonomy.changed'; agentId: DirectorAgentId; level: AutonomyLevel }
  | { type: 'notice.push'; notice: DecisionNotice }
  | { type: 'navigation.request'; target: WorkTarget }

export interface StudioBus {
  emit(event: StudioEvent): void
  on<T extends StudioEvent['type']>(type: T, handler: (e: Extract<StudioEvent, { type: T }>) => void): () => void
  once<T extends StudioEvent['type']>(type: T, handler: (e: Extract<StudioEvent, { type: T }>) => void): () => void
  onAny(handler: (e: StudioEvent) => void): () => void
}

/* ------------------------------------------------------------------ */
/* 3. 只读投影与事实（附录 A 2.5 · §3.4 / §3.6）                         */
/* ------------------------------------------------------------------ */

/** 主 chunk 只读投影（≤1KB）：侧栏 / 角标 / 右栏摘要消费；只存计数与一行摘要，不存实体 */
export interface StudioDigest {
  pendingDecisions: number
  runningMissions: number
  runningTasks: number
  unreadDocs: number
  activeMission?: { id: string; title: string; progress: number; status: MissionStatus }
  updatedAt: number
}

/** 统一事实快照：全 mission 只读，交付物发布前必须逐条可回溯 */
export interface FactSnapshot {
  missionId: string
  role: RoleId
  takenAt: number
  dataVersion?: string
  /** 数据源降级时如实标注 */
  degraded?: boolean
  facts: Fact[]
}

export interface MissionRuntime {
  execution: 'real' | 'mock'
  outcome?: 'done' | 'partial' | 'failed' | 'cancelled'
  cursor?: number
  completedTasks: string[]
  failedTasks: { taskId: string; reason: string }[]
  attempts: number
  startedAt?: number
  finishedAt?: number
}

/** inbox 覆盖态：只存状态与来源引用，任务本体在各自事实源 */
export interface DecisionRecord {
  id: string
  source: 'mission' | 'briefing' | 'taskFlow' | 'notice'
  refId: string
  status: 'new' | 'done' | 'snoozed'
  resolvedAt?: number
  snoozeUntil?: number
}

export type ArtifactRef = { docId: string; title: string }
export interface Citation {
  value: string
  source: string
  factId?: string
}
export interface VerifySummary {
  total: number
  verified: number
  derived: number
  conflict: number
  unverified: number
  structural: number
}

/* ------------------------------------------------------------------ */
/* 4. 委托 / 计划 / 执行（附录 A 2.5 · §4.2）                            */
/* ------------------------------------------------------------------ */

export interface MissionDraft {
  id: string
  kind: MissionKind
  title: string
  tasks: MissionPlanTask[]
  planSource: PlanSource
  facts: FactSnapshot
  utterance: string
}

export interface IntakeInput {
  utterance: string
  source: 'inbox' | 'briefing' | 'chat'
  cardId?: string
  sessionId?: string
  constraints?: BriefingCardConstraint
}

export interface BriefingCardConstraint {
  cardId: string
  type: BriefingCard['type']
  tag: string
  selectedOption?: string
}

export interface DeliverableDraft {
  title: string
  kindCn: ArtifactKindCn
  markdown: string
  provenance: ArtifactProvenance
  citations: Citation[]
}

export interface ExecutionPlan {
  missionId: string
  kind: MissionKind
  execution: 'real' | 'mock'
  tasks: MissionPlanTask[]
  facts: FactSnapshot
  agentSpecs: Record<DirectorAgentId, AgentSpec>
}

export interface ExecutionResult {
  status: 'done' | 'partial' | 'cancelled'
  completedTasks: string[]
  failedTasks: { taskId: string; reason: string }[]
  artifactIds: string[]
  elapsedMs: number
  attempts: number
}

export interface MissionRunEvent {
  seq: number
  taskId?: string
  agentId?: DirectorAgentId
  kind: 'task.start' | 'task.done' | 'feed' | 'gate' | 'artifact' | 'error' | 'partial'
  text?: string
}

export type AgentMemoryEntry = MemoryEntry & { agentId: DirectorAgentId }

export interface DecisionNotice {
  id: string
  source: DecisionRecord['source']
  refId: string
  title: string
  body?: string
  snoozeUntil?: number
}

export interface AgentSpec {
  id: DirectorAgentId
  name: string
  baseRole: RoleId | 'inherit'
  tools: string[]
  memoryNs: string
  skillNs: string
  autonomy: Partial<Record<string, AutonomyLevel>>
  notDo: string
  rubric?: unknown
}

export interface Handoff {
  from: DirectorAgentId
  to: DirectorAgentId
  taskId: string
  summary: string
  citations: Citation[]
  artifactRefs: ArtifactRef[]
}

/** Trace 外层信封（§3.6(5)）：不改既有 AgentTraceEvent 联合类型，只包一层 mission/task 上下文 */
export interface TraceEnvelope {
  v: 1
  missionId: string
  taskId: string
  agentId: DirectorAgentId
  attempt: number
  seq: number
  event: AgentTraceEvent
}

/* ------------------------------------------------------------------ */
/* 5. 领域端口（附录 A · §3.5）：Director 视图只依赖端口，实现由 bridge 提供 */
/* ------------------------------------------------------------------ */

export interface DirectorPorts {
  intake: {
    fromCard(card: BriefingCard): { utterance: string; constraints: BriefingCardConstraint }
    submit(input: IntakeInput): Promise<MissionDraft>
    confirm(draftId: string): void
  }
  execution: {
    mode(): 'real' | 'mock'
    start(plan: ExecutionPlan, sink: (e: MissionRunEvent) => void, signal: AbortSignal): Promise<ExecutionResult>
    resume(missionId: string): Promise<void>
    cancel(missionId: string): void
  }
  deliverables: {
    publish(draft: DeliverableDraft): Promise<ArtifactRef>
    open(ref: ArtifactRef): void
    export(ref: ArtifactRef, format: ExportFormat): Promise<void>
    share(ref: ArtifactRef): Promise<string>
  }
  evidence: {
    snapshot(role: RoleId): Promise<FactSnapshot>
    verify(markdown: string, snapshot: FactSnapshot): VerifySummary
  }
  memory: {
    recordAgent(entry: AgentMemoryEntry): void
    recentForAgent(agentId: DirectorAgentId, limit?: number): Promise<MemoryEntry[]>
    semanticForAgent(agentId: DirectorAgentId): Promise<MemoryEntry[]>
    recordTeacherFeedback(entry: MemoryEntry): void
  }
  team: {
    roster(): AgentProfile[]
    grant(agentId: DirectorAgentId, level: AutonomyLevel): void
    status(agentId: DirectorAgentId): AgentRuntimeStatus
  }
  notify: {
    decision(notice: DecisionNotice): void
    toast(text: string, kind?: ToastKind): void
  }
  navigate: Navigator
}

/* ------------------------------------------------------------------ */
/* 6. 实体与引用（附录 A · §3.6）                                        */
/* ------------------------------------------------------------------ */

export type TaskRef =
  | { kind: 'chat'; sessionId: string; entryId?: string }
  | { kind: 'loom'; boardId: string; nodeId: string }
  | { kind: 'flow'; flowId: string; receiptId?: string }
  | { kind: 'mission'; missionId: string; taskId?: string }

export interface ArtifactProvenance {
  missionId?: string
  taskId?: string
  agentId?: DirectorAgentId
  refs?: TaskRef[]
  citations?: { value: string; source: string; factId?: string }[]
  createdAt: number
}

export interface ApprovalGate {
  gateId: string
  missionId?: string
  taskId?: string
  source: 'mission' | 'loom'
  title: string
  ownerAgentId?: DirectorAgentId
  requiredAction: 'approve' | 'edit' | 'continue'
  /** 门后动作是否对外/不可逆（硬门：永不自动放行） */
  sensitive: boolean
  editableTarget?: ArtifactRef
  evidence?: { citations: Citation[]; verification: VerifySummary }
}

/* ------------------------------------------------------------------ */
/* 7. 功能开关与设置（附录 A · §3.9）                                    */
/* ------------------------------------------------------------------ */

export type FlagName =
  /** 统一工作区（路由 + 外壳） */
  | 'studioV2'
  /** 派生收件箱 */
  | 'derivedInbox'
  /** 交付物入 artifactStore */
  | 'unifiedDeliverables'
  /** 真执行内核 */
  | 'realExecution'
  /** Agent 记忆/技能命名空间 */
  | 'agentMemory'

export type FlagValue = 'auto' | 'on' | 'off'
export type FlagSource = 'url' | 'settings' | 'roleDefault' | 'build'

export interface ResolvedFlag {
  value: boolean
  source: FlagSource
}

/**
 * 开关解析上下文（v1.2 M0 注入式，便于单测；不 import settingsStore）：
 * - search：`window.location.search` 形状的查询串（可带或不带前导 `?`）；
 * - settings：`settings.studio` 的持久化值（缺省 = 未读到设置）；
 * - buildDefault：构建期默认值（缺省 false）；
 * - defaultMode：影子期 'shadow'（缺省）/ M4 默认期 'default'。
 */
export interface FlagContext {
  search: string
  settings?: Partial<StudioSettings>
  buildDefault?: Partial<Record<FlagName, boolean>>
  defaultMode?: 'shadow' | 'default'
}

export interface StudioSettings {
  /** 「启动页」 */
  landing: 'auto' | 'inbox' | 'briefing' | 'workbench'
  /** 「默认执行模式」 */
  execution: 'auto' | 'real' | 'mock'
  /** 唯一引导已读位（吸收旧 guideSeen 与 director 旧位） */
  onboarded: boolean
  /** 主 chunk 只读投影（≤1KB，见 §3.4） */
  digest: StudioDigest
  /**
   * v1.2 M0 契约扩展（optional，缺省行为不变）：
   * 子能力的内部灰度/排障覆盖（§3.9「不单独暴露用户开关，内部可独立关闭」）；
   * 缺省 = 跟随 landing/execution 派生语义与角色默认。
   */
  flags?: Partial<Record<FlagName, FlagValue>>
}

/* ------------------------------------------------------------------ */
/* 8. M0 补齐的辅助类型（附录 A 未展开；最小定义）                        */
/* ------------------------------------------------------------------ */

/** 战队成员运行时状态（§3.5 team.status；只读展示，不持久化） */
export interface AgentRuntimeStatus {
  agentId: DirectorAgentId
  autonomy: AutonomyLevel
  status: 'idle' | 'running' | 'waiting'
  lastActiveAt?: number
  done: number
  failed: number
}

/** 统一 toast 类别（§3.4 / §3.5 notify.toast；吸收 Director / Loom / uiStore 三套提示） */
export type ToastKind = 'info' | 'success' | 'error'
