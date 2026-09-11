/** Harness 核心契约：mock / api 双实现共同依赖，业务代码只 import 本文件 */

export type ProviderMode = 'mock' | 'api'
export type RoleId = 'bureau' | 'schoolAdmin' | 'teacher'
export type Stage = 'login' | 'briefing' | 'workbench'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
  /** assistant 消息携带的 tool_calls（OpenAI 兼容透传，Orchestrator 多轮回填用） */
  toolCalls?: { id: string; name: string; arguments: string }[]
}

/* ---------- LLM ---------- */

/** 流式原始增量（OpenAI 兼容 delta 归一化结果），供 Orchestrator 消费 tool_calls 分片 */
export interface LLMDelta {
  content?: string
  /** 思考过程（reasoning_content / reasoning），仅展示用 */
  reasoning?: string
  /** tool_calls 流式分片：index 对齐累积，arguments 为分片拼接 */
  toolCalls?: { index: number; id?: string; name?: string; argumentsFragment: string }[]
  finishReason?: string
}

/** streamChatRaw 可选参数（v0.9 M1）：tools 非空时随请求体下发（OpenAI 兼容 function-calling） */
export interface StreamChatRawOptions {
  /** 角色工具 JSON Schema 列表；非空数组合入请求体，缺省/空数组 = 不携带（向后兼容） */
  tools?: unknown[]
}

export interface LLMProvider {
  /** 流式对话，逐块产出文本 */
  streamChat(messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<string>
  /**
   * 流式原始增量（含 tool_calls 分片）；未实现时视为该 provider 不支持 function-calling。
   * v0.9 M1③：增加可选 options 参数携带 tools 契约——Mock 实现缺省即不支持，语义不变。
   */
  streamChatRaw?(messages: ChatMessage[], signal?: AbortSignal, options?: StreamChatRawOptions): AsyncGenerator<LLMDelta>
}

/** LLM 调用错误：携带 HTTP 状态码，供回退策略判断 */
export class LLMError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'LLMError'
    this.status = status
  }
}

/* ---------- 今日简报卡片 ---------- */

export type CardType = 'insight' | 'decision' | 'creation' | 'todo' | 'data' | 'question'

export type CardPayload =
  | { kind: 'chart'; title: string; bars: { label: string; value: number; display?: string; peak?: boolean }[] }
  | { kind: 'options'; options: { text: string; sub?: string }[]; /** 用户选中的选项下标（v0.7 交互态） */ selected?: number }
  | { kind: 'editable'; text: string }
  | { kind: 'todos'; todos: { text: string; meta?: string; done?: boolean }[] }
  | { kind: 'expandable'; title: string; content: string }

/** 卡片跳转链接（v0.7）：与 action 的「采纳」语义分离，点击直达关联位置 */
export type CardLinkKind = 'source' | 'task' | 'favorite'
export interface CardLink {
  kind: CardLinkKind
  /** 链接展示文案 */
  label: string
  /** kind=task 时可选：跳转后新建任务的目标（缺省仅进入工作台） */
  goal?: string
}

export interface BriefingCard {
  id: string
  role: RoleId
  type: CardType
  tag: string
  title: string
  body: string
  extra?: CardPayload['kind']
  payload?: CardPayload
  confidence: 1 | 2 | 3
  source: string
  /** 采纳后注入工作台的任务目标 */
  action?: { kind: 'openTask'; goal: string }
  /** 卡片跳转链接（v0.7）：source=数据源 / task=工作台任务 / favorite=收藏夹 */
  link?: CardLink
}

/* ---------- 简报生成上下文（v0.7 个性化） ---------- */

/** 历史决策（跨会话持久化），供个性化排序与 LLM 提示 */
export type BriefingDecision = 'skip' | 'fav' | 'accept'

export interface BriefingGenContext {
  /** 卡片 id → 历史决策 */
  decisions: Record<string, BriefingDecision>
  /** 收藏过的卡片（个性化前置依据） */
  favorites: BriefingCard[]
  /** 该角色 L3 语义偏好（v0.9.1 记忆分层）：Mock 排序叠加 / API 生成上下文；缺省 = 既有行为 */
  prefs?: MemoryEntry[]
  /** 生成时间（测试注入用，缺省 Date.now()） */
  now?: number
}

/** 用户交互产生的 payload 覆盖（v0.7），按卡片 id 持久化到 localStorage */
export type PayloadPatch =
  | { kind: 'options'; selected: number }
  | { kind: 'todos'; done: boolean[] }
  | { kind: 'editable'; text: string }

/** 内容风格档位（v0.8.4 重新生成弹窗）：缺省 = 跟随角色 system prompt */
export type BriefingStyle = 'concise' | 'detailed' | 'data'

/**
 * 重新生成选项（v0.8.4）：弹窗 → store 持久化 → Provider 消费；未传字段 = 既有默认行为。
 * 提示词/数量/风格/payload/生成参数仅 API 模式生效；types 过滤 Mock 与 API 共用。
 */
export interface BriefingGenOptions {
  /** 自定义提示词（仅 API 模式生效），≤200 字 */
  prompt?: string
  /** 勾选的卡片种类；空/全选 = 不限（Mock 过滤与 API 约束共用） */
  types?: CardType[]
  /** 参考资料开关（API 模式注入 prompt 的段落开关，默认全开） */
  references?: { dataContext: boolean; decisions: boolean; favorites: boolean }
  /** 卡片数量 3-10；缺省 = 默认 5-7（仅 API 生效） */
  count?: number
  /** 内容风格档位；缺省 = 默认（仅 API 生效） */
  style?: BriefingStyle
  /** 交互型 payload 要求（API 模式约束允许的 payload 类型，默认全开） */
  payloads?: { chart: boolean; options: boolean; todos: boolean }
  /** 单次尝试超时 ms（clamp 6000-30000，默认 12000，仅 API 生效） */
  timeoutMs?: number
  /** 最大尝试次数（clamp 1-3，默认 2，仅 API 生效） */
  maxAttempts?: number
}

export interface BriefingProvider {
  /** ctx 可选：Mock 个性化排序 / API 生成上下文；options 可选：重新生成选项（v0.8.4），现有调用点零破坏 */
  getDeck(role: RoleId, ctx?: BriefingGenContext, options?: BriefingGenOptions): BriefingCard[]
  /**
   * 可选异步生成（v0.7 API 骨架）：LLM 结构化生成 + 逐卡校验，失败回退 getDeck。
   * Mock 实现无需提供；调用方（briefingStore）存在即优先使用。
   */
  getDeckAsync?(role: RoleId, ctx?: BriefingGenContext, options?: BriefingGenOptions): Promise<BriefingCard[]>
}

/* ---------- Agent 编排 ---------- */

export type AgentTraceEvent =
  | { kind: 'plan'; steps: string[] }
  | { kind: 'tool_call'; id: string; tool: string; args: Record<string, unknown>; /** 并行组标注（v0.4 M1②）：同组步骤并行执行 */ group?: string }
  | { kind: 'tool_result'; id: string; tool: string; summary: string; payload?: unknown; group?: string }
  | { kind: 'reflect'; text: string }
  | { kind: 'artifact_meta'; artifactId: string; title: string; docKind: string }
  | { kind: 'artifact_chunk'; artifactId: string; chunk: string }
  | { kind: 'artifact_done'; artifactId: string; title: string; docKind: string }
  | { kind: 'text'; text: string }
  | { kind: 'done'; text: string }
  /* ---------- 自进化技能（v0.6 M1⑤） ---------- */
  | {
      kind: 'skill_hit'
      skillId: string
      name: string
      version: number
      origin: 'builtin' | 'learned'
    }
  | {
      kind: 'skill_learned'
      skillId: string
      name: string
      version: number
      /** true = 合并进已有技能版本+1（进化）；false = 全新技能 v1 */
      evolved: boolean
    }

/** v0.9.4 Loom：上游节点结果引用（注入 Agent 执行上下文，见 v0.9.4-01 决策 2） */
export interface LoomUpstreamRef {
  /** 上游节点 id */
  nodeId: string
  /** 上游节点标题（注入文案「标题：输出」） */
  title: string
  /** 上游节点采集到的输出（可能为空串） */
  output: string
}

/**
 * v0.9.4 Loom：执行上下文（缺省时行为与 v0.9.3 完全一致，纯增量）。
 * - loomNodeId：触发本次执行的 Loom 节点 id；存在时不抢占用户当前视图（activeId）；
 * - upstream：依赖（dependency / context 边）上游节点的结果，供 Mock reflect 展示 / API 拼入 messages。
 */
export interface ToolContext {
  loomNodeId?: string
  upstream?: LoomUpstreamRef[]
}

export interface AgentTaskInput {
  role: RoleId
  goal: string
  history: ChatMessage[]
  signal?: AbortSignal
  /** v0.9.4 Loom 上游结果注入（缺省 = 既有行为） */
  context?: ToolContext
}

export interface AgentProvider {
  runTask(input: AgentTaskInput, emit: (e: AgentTraceEvent) => void): Promise<void>
}

/* ---------- Artifact 文档 ---------- */

export type ArtifactKind = 'lessonPlan' | 'report' | 'notice' | 'analysis' | 'generic'

export interface ArtifactDoc {
  id: string
  title: string
  kind: ArtifactKind
  role: RoleId
  content: string
  createdAt: number
  source: 'agent' | 'briefing' | 'manual'
}

export interface ArtifactProvider {
  /**
   * 流式生成文档，onChunk 逐块回调，返回标题与文档类型。
   * v0.9.4-03：upstream 为 Loom 上游节点结果（生成时应承接引用；缺省时行为与旧版一致）。
   */
  generate(
    input: { role: RoleId; goal: string; kindHint?: ArtifactKind; signal?: AbortSignal; upstream?: LoomUpstreamRef[] },
    onChunk: (chunk: string) => void,
  ): Promise<{ title: string; kind: ArtifactKind }>
}

/* ---------- 角色与工具 ---------- */

export interface RolePreset {
  id: RoleId
  name: string
  subtitle: string
  description: string
  tools: string[]
  systemPrompt: string
  accent: 'coral' | 'mint' | 'primary'
}

export interface ToolResult {
  summary: string
  payload?: unknown
}

export interface ToolDef {
  name: string
  label: string
  description: string
  roles: RoleId[]
  /** 参数 JSON Schema（function-calling 映射用；缺省视为无参对象） */
  parameters?: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
  /** 业务化文案（v0.9.2 P0-A）：用 args 拼给教育者看的执行描述（如「正在检索课程标准「函数」」）；缺省回退 label */
  display?: (args: Record<string, unknown>) => string
  run(args: Record<string, unknown>): Promise<ToolResult>
}

/* ---------- 记忆分层（v0.9.1） ---------- */

/** 任务/交互结果（反馈回路的产出方向） */
export type MemoryOutcome = 'accepted' | 'rejected' | 'edited' | 'executed'

/**
 * 记忆条目（v0.9.1 记忆分层，设计文档 2.4 草案落地）：
 * - episodic：情景记忆（L2）——"上次做过什么"，goal/outcome/ref 有效；
 * - semantic：语义偏好（L3）——"这个用户偏好什么"，key/value/confidence 有效。
 */
export interface MemoryEntry {
  /** 时间戳（ms） */
  t: number
  role: RoleId
  kind: 'episodic' | 'semantic'
  /** 语义偏好键（semantic 用），按角色前缀隔离：如 'teacher.pref.quiz.count' */
  key?: string
  /** 语义偏好值（semantic 用） */
  value?: unknown
  /** 任务目标摘要（episodic 用） */
  goal?: string
  /** 任务/交互结果（episodic 用） */
  outcome?: MemoryOutcome
  /** 关联 artifact/skill/card id（如 'artifact:doc-abc' / 'card:tag'） */
  ref?: string
  /** 置信度 0-1（semantic 用） */
  confidence?: number
}

/**
 * 记忆分层契约（v0.9.1）：mock / api 共用同一本地实现（纯前端轻定位，不做服务端同步）。
 * 所有方法按 role 隔离——教师记忆不进入教育局会话（跨角色共享是特性级禁用）。
 */
export interface MemoryProvider {
  /** 记录一次任务/交互结果（episodic 直接入环形队列；semantic 合并进偏好 map） */
  record(input: MemoryEntry): Promise<void>
  /** 取某角色的近期情景记忆（供注入 A），按时间倒序取 limit 条（缺省 3） */
  recentEpisodic(role: RoleId, limit?: number): Promise<MemoryEntry[]>
  /** 取某角色的语义偏好（供注入 A/B），按置信度降序 */
  semanticFor(role: RoleId): Promise<MemoryEntry[]>
  /** 偏好提炼：从采纳/拒绝等结果推导 L3（规则版，导出规则供单测） */
  extractPrefs(entry: MemoryEntry): Promise<MemoryEntry[]>
}

export interface MemoryProviderConfig {
  /** 情景记忆上限（环形裁剪），缺省 200 */
  episodicLimit?: number
}

/* ---------- 产出自评（v0.9.1） ---------- */

/** 单项检查结果（weight 为该检查占满分 10 的权重） */
export interface EvalCheck {
  name: string
  pass: boolean
  weight: number
}

/** 自评结果：加权合成分 + 逐项检查 + 可执行建议（诚实标注"AI 自评"） */
export interface EvalResult {
  score: number
  checks: EvalCheck[]
  suggestions: string[]
}

/**
 * 产出自评契约（v0.9.1）：v1.0 为规则版（零 LLM 成本），LLM 版二期再引入。
 * 评分结果仅供参考（UI 需标注"AI 自评"），不阻断产出使用。
 */
export interface Evaluator {
  evaluate(doc: { kind: ArtifactKind; content: string; role: RoleId }): Promise<EvalResult>
}
