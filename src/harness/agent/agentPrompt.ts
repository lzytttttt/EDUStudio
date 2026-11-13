/**
 * v1.2 M3a · agent-scoped 执行提示词（纯函数，主 chunk 无副作用）
 *
 * 依据 doc/v1.2-roadmap.md §4.3：
 * - mission 内每个任务以「战队成员身份」执行：借用 baseRole 的语气与工具域，
 *   再叠加岗位职责 / notDo 边界 / 记忆命名空间 / 上游交接 / 事实快照；
 * - 缺省字段不产生空段落（agent 不存在时 Orchestrator 原样走旧路径，不调用本模块）；
 * - 段落顺序固定：【岗位】→【边界】→【记忆命名空间】→【上游交接】→【事实快照】，
 *   便于快照对比与回归（顺序变化视为契约变更）。
 *
 * 边界：只依赖 harness 类型与 ToolRegistry（读注册表），不 import 任何 store。
 */

import type { AgentTaskContext, RoleId, ToolDef } from '../types'
import { toolRegistry } from './ToolRegistry'

/** 上游交接最多注入的条数（防上下文膨胀） */
export const MAX_HANDOFFS = 5
/** 单条交接摘要最多保留的字符数（超出截断 + 省略号） */
export const MAX_HANDOFF_SUMMARY_CHARS = 120
/** 事实快照最多注入的条数（数字只能引用这些值） */
export const MAX_FACTS = 12

/** 岗位展示名：name 优先，缺省回退 id（与 Mock reflect / artifact 前缀同口径） */
export function agentDisplayName(agent: AgentTaskContext): string {
  const name = agent.name?.trim()
  return name ? name : agent.id
}

function nonEmpty(text?: string): string | null {
  const value = text?.trim()
  return value ? value : null
}

/** 截断文本并保留省略号（char 口径，与「≤N 字」验收一致） */
function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
}

/** 岗位段落中的角色域说明（baseRole=inherit 时不写具体角色） */
function roleDomainNote(agent: AgentTaskContext): string {
  return agent.baseRole === 'inherit' ? '沿用输入角色语气与工具域' : `借用「${agent.baseRole}」角色语气与工具域`
}

/**
 * 在角色 system prompt 之后追加 agent 段落（v1.2 M3a）。
 * 只追加 agent 实际提供的字段；无任何可注入字段时返回 basePrompt 原文。
 */
export function buildAgentSystemPrompt(basePrompt: string, agent: AgentTaskContext): string {
  const sections: string[] = []

  // ① 岗位：恒存在（id 必填），带本轮 mission/task 归属，声明职责边界
  const displayName = agentDisplayName(agent)
  const identity = displayName === agent.id ? agent.id : `${displayName}（${agent.id}）`
  sections.push(
    `【岗位】${identity} · ${roleDomainNote(agent)}；` +
      `本轮只执行 mission ${agent.missionId} 的 ${agent.taskId}，不承接岗位外职责。`,
  )

  // ② 边界（notDo 一行）
  const notDo = nonEmpty(agent.notDo)
  if (notDo) sections.push(`【边界】${notDo}`)

  // ③ 记忆命名空间（agent 级经验隔离）
  const memoryNs = nonEmpty(agent.memoryNs)
  if (memoryNs) sections.push(`【记忆命名空间】${memoryNs}`)

  // ④ 上游交接：只承接已声明产物摘要（≤5 条，单条 summary ≤120 字）
  const handoffs = agent.handoffs?.slice(0, MAX_HANDOFFS) ?? []
  if (handoffs.length > 0) {
    const lines = handoffs.map(
      (handoff) =>
        `- ${handoff.from}→${handoff.to} · ${handoff.taskId} · ${truncate(handoff.summary, MAX_HANDOFF_SUMMARY_CHARS)}`,
    )
    sections.push(`【上游交接】只承接以下已声明产物摘要，不读取全局会话：\n${lines.join('\n')}`)
  }

  // ⑤ 事实快照：逐条一行（key / 值+单位 / label / source），数字只能引用这些值（≤12 条）
  const facts = agent.facts?.slice(0, MAX_FACTS) ?? []
  if (facts.length > 0) {
    const lines = facts.map((fact) => {
      const label = nonEmpty(fact.label)
      const source = nonEmpty(fact.source)
      return (
        `- ${fact.key}：${fact.value}${fact.unit}` +
        (label ? `（${label}）` : '') +
        (source ? ` · 来源：${source}` : '')
      )
    })
    sections.push(`【事实快照】数字只能引用以下值，不得编造或改写：\n${lines.join('\n')}`)
  }

  if (sections.length === 0) return basePrompt
  const base = basePrompt.trim() ? basePrompt : ''
  return base ? `${base}\n\n${sections.join('\n\n')}` : sections.join('\n\n')
}

/**
 * 工具白名单收敛（v1.2 M3a）：
 * `toolRegistry.listForRole(baseRole)` ∩ `agent.tools`，保持注册表顺序；
 * 「域外工具」即使出现在 agent.tools 里也不会放行（先按角色域过滤）。
 */
export function filterToolsForAgent(baseRole: RoleId, agent: AgentTaskContext): ToolDef[] {
  const allowed = new Set(agent.tools)
  return toolRegistry.listForRole(baseRole).filter((tool) => allowed.has(tool.name))
}

/** 解析执行角色：agent 缺省 / baseRole='inherit' 时跟随 fallbackRole（旧路径逐字节不变） */
export function agentRoleOf(agent: AgentTaskContext | undefined, fallbackRole: RoleId): RoleId {
  if (!agent || agent.baseRole === 'inherit') return fallbackRole
  return agent.baseRole
}
