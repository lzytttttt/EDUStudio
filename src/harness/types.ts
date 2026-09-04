/** Harness 核心契约：mock / api 双实现共同依赖，业务代码只 import 本文件 */

export type ProviderMode = 'mock' | 'api'
export type RoleId = 'bureau' | 'schoolAdmin' | 'teacher'
export type Stage = 'login' | 'briefing' | 'workbench'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
}

/* ---------- LLM ---------- */

export interface LLMProvider {
  /** 流式对话，逐块产出文本 */
  streamChat(messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<string>
}

/* ---------- 今日简报卡片 ---------- */

export type CardType = 'insight' | 'decision' | 'creation' | 'todo' | 'data' | 'question'

export type CardPayload =
  | { kind: 'chart'; title: string; bars: { label: string; value: number; display?: string; peak?: boolean }[] }
  | { kind: 'options'; options: { text: string; sub?: string }[] }
  | { kind: 'editable'; text: string }
  | { kind: 'todos'; todos: { text: string; meta?: string; done?: boolean }[] }
  | { kind: 'expandable'; title: string; content: string }

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
}

export interface BriefingProvider {
  getDeck(role: RoleId): BriefingCard[]
}

/* ---------- Agent 编排 ---------- */

export type AgentTraceEvent =
  | { kind: 'plan'; steps: string[] }
  | { kind: 'tool_call'; id: string; tool: string; args: Record<string, unknown> }
  | { kind: 'tool_result'; id: string; tool: string; summary: string; payload?: unknown }
  | { kind: 'reflect'; text: string }
  | { kind: 'artifact_meta'; artifactId: string; title: string; docKind: string }
  | { kind: 'artifact_chunk'; artifactId: string; chunk: string }
  | { kind: 'text'; text: string }
  | { kind: 'done'; text: string }

export interface AgentTaskInput {
  role: RoleId
  goal: string
  history: ChatMessage[]
  signal?: AbortSignal
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
  /** 流式生成文档，onChunk 逐块回调，返回标题与文档类型 */
  generate(
    input: { role: RoleId; goal: string; kindHint?: ArtifactKind; signal?: AbortSignal },
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
  run(args: Record<string, unknown>): Promise<ToolResult>
}
