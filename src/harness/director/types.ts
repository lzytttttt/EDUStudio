/**
 * Director（总指挥模式）原型契约（v1.0 预览 → v1.1 加固）
 *
 * 边界：只服务教师「事找人 + 异步托管」演示链路，Mock 驱动、纯前端状态；
 * 不接入现有 AgentProvider / chatStore / loom（旧流程保持原样，互不影响）。
 *
 * v1.1 冻结项（Lead，2026-11-12）：
 * - `MissionKind` / `GateId` / `PlanSource` / `MissionTemplate` / `Fact` / `PersistedDirectorV1`
 *   为跨模块共享契约，其他模块负责人不得改动本文件语义（只允许在集成阶段收口别名）。
 * - `MissionGate` 暂时保留 v1.0 的两个门，集成阶段（M3）合并为 `GateId` 别名；
 *   planner / 模板 / 持久化一律使用 `GateId`。
 */

export type DirectorAgentId = 'chief' | 'analyst' | 'assessor' | 'curriculum' | 'communicator' | 'steward'

export type DirectorScreen = 'inbox' | 'mission' | 'team'

export type AutonomyLevel = 'L0' | 'L1' | 'L2' | 'L3'

/** 视觉色调：全部映射到现有 design token，不新增品牌色 */
export type Tone = 'primary' | 'mint' | 'coral' | 'amber' | 'graphite'

/* ------------------------------------------------------------------ */
/* v1.1 剧本 / 计划来源 / 审批门                                        */
/* ------------------------------------------------------------------ */

/** 两条演示剧本（roadmap §6）：LLM 只能在这两个 kind 里选 */
export type MissionKind = 'parent_meeting' | 'exam_loop'

/** 计划来源：模板兜底 / 真 LLM（roadmap §4.5 角标） */
export type PlanSource = 'template' | 'llm'

/** 审批门 id（v1.1：v1.0 的 speech/letters + exam_loop 的 worksheet/lesson 统一） */
export type GateId = 'speech' | 'letters' | 'worksheet' | 'lesson'

/** @deprecated v1.0 局部名；v1.1 起等价于 `GateId`（保留别名以兼容旧调用点） */
export type MissionGate = GateId

/** 演示剧本的剧本事件（从 data.ts 上移到契约层，供模板与 store 共用） */
export interface ScriptFeed {
  kind: 'feed'
  agentId: DirectorAgentId
  text: string
  after: number
  task?: string
  progress: number
}

export interface ScriptGate {
  kind: 'gate'
  agentId: DirectorAgentId
  text: string
  after: number
  gate: GateId
  progress: number
}

export interface ScriptDone {
  kind: 'done'
  text: string
  after: number
  progress: 100
}

export type MissionScriptEvent = ScriptFeed | ScriptGate | ScriptDone

/** 模板化剧本（roadmap §6.1）：一套 store/UI 跑多条剧本 */
export interface MissionTemplateMeta {
  /** 环节数（= plan.length） */
  steps: number
  /** 执行成员数（除总指挥去重） */
  members: number
  /** 拍板次数（= plan 中带 gate 的环节数） */
  gates: number
  /** 演示压缩后耗时（秒） */
  demoSeconds: number
  /** 真实世界预计省时（小时） */
  savedHours: number
  /** 交付物件数（= artifacts.length） */
  delivered: number
  /** 教师做出的决定数 */
  decisions: number
}

export interface MissionTemplate {
  kind: MissionKind
  title: string
  plan: MissionPlanTask[]
  script: MissionScriptEvent[]
  artifacts: ArtifactTile[]
  gates: GateId[]
  meta: MissionTemplateMeta
}

/* ------------------------------------------------------------------ */
/* 事实快照（P0-3）：LLM 只能引用快照里的数字                            */
/* ------------------------------------------------------------------ */

export type FactUnit = '分' | '%' | '百分点' | '人' | '题' | '分钟'

export interface Fact {
  factId: string
  /** 指标键，如 physics.avg / homework.completion；用于同指标异值冲突判定 */
  key: string
  value: number
  unit: FactUnit
  label: string
  /** 数据来源（如「学情库 · 高一（3）班 · 单元考」） */
  source: string
  /** 数据时点（如 2026-11-06） */
  asOf: string
  /** 派生值（如三科均分 80.4）必须为 true；引用时必须显式标「派生」 */
  derived?: boolean
}

/* ------------------------------------------------------------------ */
/* 原有实体                                                             */
/* ------------------------------------------------------------------ */

export interface AgentProfile {
  id: DirectorAgentId
  name: string
  /** 2 字岗位词（战队卡与动态流用） */
  role: string
  tone: Tone
  /** 2 个专长词，成员卡用；不在主界面铺文字 */
  expertise: string[]
  autonomy: AutonomyLevel
  /** 近期战绩（演示数据） */
  stats: { done: number; rate: number }
  /** 一行「不做什么」，只在成员详情出现 */
  boundary: string
}

export type DecisionKind = 'prepared' | 'approve' | 'conflict'

export interface DecisionPreviewRow {
  label: string
  value: string
}

export interface DecisionOption {
  id: string
  label: string
  detail: string
}

export interface DecisionItem {
  id: string
  agentId: DirectorAgentId
  kind: DecisionKind
  title: string
  subtitle: string
  readiness: number
  minutes: number
  tag: string
  primaryLabel: string
  preview: { rows: DecisionPreviewRow[]; note?: string }
  /** 仅 kind=conflict：需要教师拍板的口径冲突 */
  conflict?: { question: string; options: DecisionOption[] }
  status: 'new' | 'done' | 'snoozed'
}

export type FeedKind = 'step' | 'gate' | 'system'

export interface FeedItem {
  id: string
  agentId: DirectorAgentId
  text: string
  at: number
  kind: FeedKind
}

export type MissionStatus = 'idle' | 'planning' | 'running' | 'paused' | 'waiting' | 'done'

export interface MissionPlanTask {
  id: string
  agentId: DirectorAgentId
  title: string
  seconds: number
  /** 依赖的上游任务 id（LLM 计划 / 模板均可用；v1.0 旧数据可缺省） */
  deps?: string[]
  /** 该环节产出需人工拍板（1–2 个） */
  gate?: GateId
}

export interface MissionState {
  status: MissionStatus
  /** 剧本 kind（v1.1：随计划冻结，执行/交付统计按模板取） */
  kind: MissionKind
  title: string
  progress: number
  feed: FeedItem[]
  plan: MissionPlanTask[]
  doneTasks: string[]
  gate: MissionGate | null
  /** 计划来源：模板兜底 / 真 LLM；失败原因见 planReason */
  planSource: PlanSource
  /** 模板兜底/失败原因（mock_mode|no_key|timeout|invalid|http|...），仅展示一行 */
  planReason?: string
  startedAt?: number
  finishedAt?: number
}

/** director 侧中文交付物 kind（不改 harness 英文 ArtifactKind，roadmap §4.2/D1） */
export type ArtifactKindCn = '简报' | '讲稿' | '大纲' | '信件' | '练习单' | '教案' | '摘要'

export interface ArtifactTile {
  id: string
  title: string
  kind: ArtifactKindCn
  owner: DirectorAgentId
  /** Markdown；支持 `{{值~来源}}` 溯源标记（复用现有渲染器） */
  markdown: string
}

export interface ToastItem {
  id: string
  text: string
  tone: Tone
}

export interface GuideStep {
  screen: DirectorScreen
  /** data-guide 属性选择器 */
  target: string
  hint: string
}

export interface DirectorStats {
  pending: number
  running: number
  hosted: number
  /** 今日预计省时（小时，演示值） */
  savedHours: number
}

export interface DirectorState {
  screen: DirectorScreen
  decisions: DecisionItem[]
  stats: DirectorStats
  mission: MissionState
  missionCursor: number
  autonomy: Record<DirectorAgentId, AutonomyLevel>
  toasts: ToastItem[]
  artifactId: string | null
  guideActive: boolean
  guideStep: number
  /** 计划来源（冗余自 mission.planSource，持久化契约字段） */
  planSource: PlanSource
  /** 真 LLM 拆解进行中（瞬态，不持久化） */
  planLoading: boolean
  /** 本次计划冻结的事实快照（随 mission 持久化，约 0.8KB） */
  facts: Fact[]
  /** v1.2 M3：执行元数据（真执行/Mock、outcome、任务账本；随 v1 payload optional 字段持久化） */
  execution?: PersistedDirectorExecution
}

/* ------------------------------------------------------------------ */
/* 持久化契约（v1，roadmap §5 / 研究 01 §4.1）                          */
/* ------------------------------------------------------------------ */

/**
 * v1.2 M3 过渡期执行元数据（optional；schemaVersion 仍为 1，M4 升 v2 时并入正式字段）。
 * 真执行结果放这里而不是 `MissionState.status`（6 值白名单不动，D11）。
 */
export interface PersistedDirectorExecution {
  mode: 'real' | 'mock'
  /** 本轮 mission 的稳定 id（`m-<startedAt>`；发布桥 provenance 用） */
  missionId?: string
  /** 真执行结果：done / partial / failed / cancelled */
  outcome?: 'done' | 'partial' | 'failed' | 'cancelled'
  startedAt?: number
  finishedAt?: number
  completedTasks?: string[]
  failedTasks?: { taskId: string; reason: string }[]
  /** 累计 attempt 数（含重试） */
  attempts?: number
}

/** v1.2 M3 过渡期：mission 来源引用（optional，缺省 = 旧行为） */
export interface PersistedDirectorIntake {
  source: 'inbox' | 'briefing' | 'chat'
  cardId?: string
  sessionId?: string
}

export interface PersistedDirectorV1 {
  schemaVersion: 1
  updatedAt: number
  /** 上限 12 */
  decisions: DecisionItem[]
  stats: DirectorStats
  mission: MissionState
  /** = mission.kind，兼容存储契约字段 */
  missionKind: MissionKind
  /** 续跑位置（下一条要执行的剧本事件下标） */
  missionCursor: number
  planSource: PlanSource
  autonomy: Record<DirectorAgentId, AutonomyLevel>
  /** 由旧独立键合并迁移（见 directorStore.GUIDE_SEEN_KEY） */
  guideSeen: boolean
  /** 随计划冻结的事实快照 */
  facts: Fact[]
  /* ---------- v1.2 M3 过渡期 optional 增量（只增字段，不改 v1 形状/枚举） ---------- */
  /** 真执行元数据（缺省 = 旧 Mock 时间线） */
  execution?: PersistedDirectorExecution
  /** mission 来源（简报采纳 / 收件箱 / 对话） */
  intake?: PersistedDirectorIntake
  /** 本次 mission 已发布到 artifactStore 的文档 id（引用，不含正文） */
  artifactIds?: string[]
  /** 数据源换源导致事实快照过期 */
  stale?: boolean
}

/** store 行为契约（UI 只依赖本接口，便于单测与后续替换实现） */
export interface DirectorStoreActions {
  setScreen: (screen: DirectorScreen) => void
  acceptDecision: (id: string) => void
  resolveConflict: (id: string, optionId: string) => void
  snoozeDecision: (id: string) => void
  openMission: () => void
  cancelPlan: () => void
  confirmPlan: () => void
  approveGate: () => void
  rejectGate: () => void
  /** v1.1：一句话 → 真 LLM/模板拆解 → 计划待确认（M1） */
  planMission: (utterance: string) => Promise<void>
  /** v1.1：取消进行中的真 LLM 拆解（M1） */
  cancelPlanning: () => void
  /** v1.1：按剧本 kind 种下计划（模板兜底 / ?mission= / d-drill 联动），不跳屏（M3） */
  startMission: (kind: MissionKind) => void
  /** v1.1：刷新后 paused → 从 missionCursor 续跑（M2） */
  resumeMission: () => void
  setAutonomy: (agentId: DirectorAgentId, level: AutonomyLevel) => void
  openArtifact: (id: string) => void
  closeArtifact: () => void
  startGuide: (force?: boolean) => void
  nextGuide: (total: number) => void
  closeGuide: () => void
  toast: (text: string, tone?: Tone) => void
  resetDemo: () => void
}
