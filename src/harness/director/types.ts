/**
 * Director（总指挥模式）原型契约（v1.0 预览）
 *
 * 边界：只服务教师「事找人 + 异步托管」演示链路，Mock 驱动、纯前端状态；
 * 不接入现有 AgentProvider / chatStore / loom（旧流程保持原样，互不影响）。
 */

export type DirectorAgentId = 'chief' | 'analyst' | 'assessor' | 'curriculum' | 'communicator' | 'steward'

export type DirectorScreen = 'inbox' | 'mission' | 'team'

export type AutonomyLevel = 'L0' | 'L1' | 'L2' | 'L3'

/** 视觉色调：全部映射到现有 design token，不新增品牌色 */
export type Tone = 'primary' | 'mint' | 'coral' | 'amber' | 'graphite'

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

export type MissionStatus = 'idle' | 'planning' | 'running' | 'waiting' | 'done'

export interface MissionPlanTask {
  id: string
  agentId: DirectorAgentId
  title: string
  seconds: number
}

export type MissionGate = 'speech' | 'letters'

export interface MissionState {
  status: MissionStatus
  title: string
  progress: number
  feed: FeedItem[]
  plan: MissionPlanTask[]
  doneTasks: string[]
  gate: MissionGate | null
  startedAt?: number
  finishedAt?: number
}

export interface ArtifactTile {
  id: string
  title: string
  kind: '简报' | '讲稿' | '大纲' | '信件'
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
  setAutonomy: (agentId: DirectorAgentId, level: AutonomyLevel) => void
  openArtifact: (id: string) => void
  closeArtifact: () => void
  startGuide: (force?: boolean) => void
  nextGuide: (total: number) => void
  closeGuide: () => void
  toast: (text: string, tone?: Tone) => void
  resetDemo: () => void
}
