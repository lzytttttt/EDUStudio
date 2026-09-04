import {
  LLMError,
  type AgentProvider,
  type AgentTaskInput,
  type AgentTraceEvent,
  type ChatMessage,
  type RoleId,
} from '../types'
import { DeepSeekAdapter, type DeepSeekConfig } from '../llm/adapter'
import { toolRegistry } from './ToolRegistry'
import { runScript, runScriptStep, nextId, type StepContext } from './stepRunner'
import { ArtifactApiAdapter } from '../artifacts/adapter'
import { getRolePreset, buildSystemPrompt } from '../roles'
import { FALLBACK_SCRIPTS, type ScriptStep } from '../scripts/agent'
import { useSettingsStore } from '../../stores/settingsStore'

/** 循环护栏：最多 5 轮工具调用（v0.4 M1①：plan → tool → 观察 → 再 plan） */
const MAX_TOOL_ROUNDS = 5
/** 连续工具失败达到该次数 → 切 Plan-JSON 降级 */
const TOOL_FAIL_LIMIT = 2
/** 上下文裁剪：仅保留最近 N 轮工具结果全文，更早轮次截断（v0.4 风险对策：token 成本控制） */
const KEEP_FULL_TOOL_ROUNDS = 2
/** 截断后的单条工具结果上限（字符） */
const TRIMMED_TOOL_CHARS = 240

interface PendingToolCall {
  id: string
  name: string
  args: string
}

/**
 * Orchestrator —— API 模式编排（Plan→Act→Reflect，function-calling 优先）。
 *
 * 主循环：组装 system+history+goal 与角色工具 JSON Schema → streamChatRaw 流式消费
 * （content 增量即时 emit text；tool_calls 分片按 index 累积）→ 执行工具并以 tool 消息回填 →
 * 循环直至无 tool_calls → emit done。
 *
 * 降级：模型不支持 tools（4xx）或连续 2 次工具失败 → 要求模型输出 Plan-JSON 并按步骤执行；
 * Plan 解析失败 → 走角色降级剧本（FALLBACK_SCRIPTS），保证任何输入都有响应。
 */
export class Orchestrator implements AgentProvider {
  private llm: DeepSeekAdapter
  private artifacts: ArtifactApiAdapter

  constructor(config?: DeepSeekConfig) {
    const conf = config ?? { baseUrl: 'https://api.deepseek.com/v1', apiKey: '', model: 'deepseek-chat' }
    this.llm = new DeepSeekAdapter(conf)
    this.artifacts = new ArtifactApiAdapter(conf)
  }

  async runTask(input: AgentTaskInput, emit: (e: AgentTraceEvent) => void): Promise<void> {
    const { role, goal, history, signal } = input
    const preset = getRolePreset(role)
    const ctx: StepContext = { role, goal, artifacts: this.artifacts, emit, signal }

    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: buildSystemPrompt(preset, useSettingsStore.getState().preferences) },
        ...history,
        { role: 'user', content: goal },
      ]
      await this.runFunctionCallingLoop(messages, input, ctx)
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        emit({ kind: 'done', text: '任务已取消。' })
        return
      }
      // 非中止错误：若尚未产出任何内容，尝试 Plan-JSON 降级；仍失败则抛给上层（回退 Mock）
      if (err instanceof LLMError) throw err
      console.error('[Orchestrator] runTask failed:', err)
      throw err
    }
  }

  /* ---------- function-calling 主循环 ---------- */

  private async runFunctionCallingLoop(
    messages: ChatMessage[],
    input: AgentTaskInput,
    ctx: StepContext,
  ): Promise<void> {
    const { role, signal } = input
    const tools = this.toolsForRole(role)
    let consecutiveToolFails = 0

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const { text, toolCalls, finishReason } = await this.collectRound(messages, tools, ctx.emit, signal)

      if (toolCalls.length > 0) {
        // assistant 消息（含 tool_calls）入栈
        messages.push({
          role: 'assistant',
          content: text,
          toolCalls: toolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.args })),
        })
        // v0.4 M1②：同轮多个独立 tool_calls 并行执行（Promise.all），trace 标注并行组
        const group = toolCalls.length > 1 ? nextId('grp') : undefined
        if (group) {
          ctx.emit({ kind: 'reflect', text: `检测到 ${toolCalls.length} 个独立工具调用，并行执行以缩短等待。` })
        }
        const results = await Promise.all(
          toolCalls.map(async (tc) => {
            let args: Record<string, unknown> = {}
            try {
              args = tc.args ? (JSON.parse(tc.args) as Record<string, unknown>) : {}
            } catch {
              args = {}
            }
            const { ok, resultText } = await this.execTool(tc.id, tc.name, args, ctx.emit, group)
            return { tc, ok, resultText }
          }),
        )
        const fails = results.filter((r) => !r.ok).length
        for (const r of results) {
          messages.push({ role: 'tool', toolCallId: r.tc.id, content: r.resultText })
        }
        consecutiveToolFails = fails > 0 ? consecutiveToolFails + fails : 0
        if (consecutiveToolFails >= TOOL_FAIL_LIMIT) {
          await this.runPlanJsonFallback(input, ctx, '工具调用连续失败')
          return
        }
        // v0.4 风险对策：多轮循环的上下文裁剪（只保留最近 2 轮工具结果全文）
        trimOldToolResults(messages)
        continue // 工具结果回填后继续推理
      }

      // 无 tool_calls：
      // - 首轮且目标为任务型（查/生成/分析…）但模型只给文字回答 → Plan-JSON 降级补全
      // - 首轮且无任何输出（模型可能不支持 tools 参数）→ Plan-JSON 降级
      // - 其余（工具轮之后的收尾回答）→ 直接结束
      if (round === 0 && (this.looksLikeTask(input.goal) || !text.trim())) {
        const reason = text.trim() ? '模型未调用工具，直接给出文字回答' : '模型未返回工具调用'
        await this.runPlanJsonFallback(input, ctx, reason)
        return
      }
      ctx.emit({ kind: 'done', text: text.trim() ? '' : '已完成。' })
      return
    }

    // 达到轮次上限：收尾说明
    ctx.emit({ kind: 'reflect', text: `已达工具调用轮次上限（${MAX_TOOL_ROUNDS} 轮），基于已有信息收尾。` })
    ctx.emit({ kind: 'done', text: '任务步骤较多，已基于当前进度收尾。可继续对话补充要求。' })
  }

  /** 单轮流式收集：content 增量即时 emit text；tool_calls 分片按 index 累积 */
  private async collectRound(
    messages: ChatMessage[],
    tools: unknown[],
    emit: (e: AgentTraceEvent) => void,
    signal?: AbortSignal,
  ): Promise<{ text: string; toolCalls: PendingToolCall[]; finishReason?: string }> {
    const pending = new Map<number, PendingToolCall & { index: number }>()
    let text = ''
    let finishReason: string | undefined

    const gen = this.llm.streamChatRaw(messages, signal)
    try {
      while (true) {
        const { value, done } = await gen.next()
        if (done) break
        const delta = value
        if (delta.content) {
          text += delta.content
          // 打字机节奏沿用 chatStore 现有队列：逐增量 emit
          emit({ kind: 'text', text: delta.content })
        }
        for (const tc of delta.toolCalls ?? []) {
          const cur = pending.get(tc.index) ?? { index: tc.index, id: '', name: '', args: '' }
          if (tc.id) cur.id = tc.id
          if (tc.name) cur.name = tc.name
          cur.args += tc.argumentsFragment
          pending.set(tc.index, cur)
        }
        if (delta.finishReason) finishReason = delta.finishReason
      }
    } finally {
      // 提前退出（break/return）时关闭底层连接
      try {
        await gen.return(undefined)
      } catch {
        /* ignore */
      }
    }
    void tools
    return {
      text,
      toolCalls: [...pending.values()].sort((a, b) => a.index - b.index),
      finishReason,
    }
  }

  /* ---------- 工具执行 ---------- */

  private async execTool(
    callId: string,
    name: string,
    args: Record<string, unknown>,
    emit: (e: AgentTraceEvent) => void,
    group?: string,
  ): Promise<{ ok: boolean; resultText: string }> {
    emit({ kind: 'tool_call', id: callId, tool: name, args, group })
    const tool = toolRegistry.get(name)
    if (!toolRegistry.has(name) || !tool) {
      const msg = `工具 ${name} 未注册，请从可用工具列表中选择`
      emit({ kind: 'tool_result', id: callId, tool: name, summary: msg, group })
      return { ok: false, resultText: JSON.stringify({ error: msg }) }
    }
    try {
      const result = await tool.run(args)
      emit({
        kind: 'tool_result',
        id: callId,
        tool: name,
        summary: result.summary,
        payload: result.payload,
        group,
      })
      return { ok: true, resultText: JSON.stringify({ summary: result.summary, payload: result.payload }) }
    } catch (err) {
      const msg = `工具执行失败：${(err as Error)?.message ?? String(err)}`
      emit({ kind: 'tool_result', id: callId, tool: name, summary: msg, group })
      return { ok: false, resultText: JSON.stringify({ error: msg }) }
    }
  }

  /* ---------- Plan-JSON 降级 ---------- */

  private async runPlanJsonFallback(
    input: AgentTaskInput,
    ctx: StepContext,
    reason: string,
  ): Promise<void> {
    const { role, goal, history, signal } = input
    ctx.emit({ kind: 'reflect', text: `${reason}，已切换 Plan-JSON 降级模式继续执行。` })

    const preset = getRolePreset(role)
    const toolMenu = toolRegistry
      .listForRole(role)
      .map((t) => `- ${t.name}：${t.description}`)
      .join('\n')
    const instruction =
      `请仅输出一个 JSON 对象（禁止 markdown 代码块与任何解释文字），格式：\n` +
      `{"steps":[\n` +
      `  {"type":"tool","tool":"工具名","args":{...}},\n` +
      `  {"type":"text","text":"给用户的说明"},\n` +
      `  {"type":"artifact","kind":"lessonPlan|report|notice|generic"}\n` +
      `]}\n` +
      `可用工具：\n${toolMenu}\n` +
      `要求：步骤 2~5 步；如目标需要产出文档，最后一步用 artifact 并选择合适 kind。`

    let full = ''
    for await (const delta of this.llm.streamChat(
      [
        { role: 'system', content: buildSystemPrompt(preset, useSettingsStore.getState().preferences) },
        ...history,
        { role: 'user', content: `任务目标：${goal}\n\n${instruction}` },
      ],
      signal,
    )) {
      full += delta
    }

    const steps = parsePlanJson(full)
    if (!steps || steps.length === 0) {
      // Plan 解析失败 → 角色降级剧本，保证任何输入都有响应
      ctx.emit({ kind: 'reflect', text: 'Plan 解析失败，已切换内置降级剧本。' })
      await runScript(FALLBACK_SCRIPTS[role].steps, ctx)
      return
    }

    ctx.emit({
      kind: 'plan',
      steps: steps.map((s) =>
        s.type === 'tool' ? `调用 ${s.tool}` : s.type === 'artifact' ? '生成文档' : '输出说明',
      ),
    })
    for (const step of steps) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      await runScriptStep(step, ctx)
    }
    ctx.emit({ kind: 'done', text: '任务已完成（Plan-JSON 模式）。可在右侧查看与编辑生成的文档。' })
  }

  /* ---------- 工具 Schema ---------- */

  /** 任务型目标启发式：命中任务动词/名词时，纯文字回答视为未完成任务 → Plan-JSON 降级 */
  private looksLikeTask(goal: string): boolean {
    return /(查|询|统计|分析|生成|撰写|写|出题|命题|制作|制定|起草|报告|教案|试题|通知|简报|总结|计划)/.test(goal)
  }

  private toolsForRole(role: RoleId) {
    return toolRegistry.listForRole(role).map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters ?? { type: 'object', properties: {} },
      },
    }))
  }
}

/** 从模型输出中提取 Plan-JSON（容忍代码块包裹与前后噪声） */
export function parsePlanJson(text: string): ScriptStep[] | null {
  if (!text.trim()) return null
  // 去掉 markdown 代码块围栏
  const cleaned = text.replace(/```(?:json)?/g, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as {
      steps?: { type?: string; tool?: string; args?: Record<string, unknown>; text?: string; kind?: string }[]
    }
    if (!Array.isArray(obj.steps)) return null
    const steps: ScriptStep[] = []
    for (const s of obj.steps) {
      if (s?.type === 'tool' && typeof s.tool === 'string') {
        steps.push({ type: 'tool', tool: s.tool, args: (s.args as Record<string, unknown>) ?? {} })
      } else if (s?.type === 'text' && typeof s.text === 'string') {
        steps.push({ type: 'text', text: s.text })
      } else if (s?.type === 'artifact' && typeof s.kind === 'string') {
        const kind = ['lessonPlan', 'report', 'notice', 'analysis', 'generic'].includes(s.kind)
          ? (s.kind as 'lessonPlan' | 'report' | 'notice' | 'analysis' | 'generic')
          : 'generic'
        steps.push({ type: 'artifact', kind })
      }
    }
    return steps
  } catch {
    return null
  }
}

/** 生成 trace 用的调用 id（导出供测试） */
export const newCallId = () => nextId('call')

/**
 * 上下文裁剪（v0.4 M1① 风险对策）：多轮工具循环时，仅保留最近 KEEP_FULL_TOOL_ROUNDS 轮
 * 工具结果全文，更早轮次的 tool 消息截断为摘要，控制 token 成本。
 * 裁剪以「assistant(toolCalls) + 紧随的 tool 消息组」为一轮，成对处理保证协议合法。
 */
export function trimOldToolResults(messages: ChatMessage[]): void {
  // 从后向前找 tool 消息轮次边界
  const roundStarts: number[] = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    const prev = messages[i - 1]
    if (m.role === 'tool' && prev?.role !== 'tool') roundStarts.push(i)
  }
  const cutoff = roundStarts.length - KEEP_FULL_TOOL_ROUNDS
  if (cutoff <= 0) return
  for (const start of roundStarts.slice(0, cutoff)) {
    for (let i = start; i < messages.length && messages[i].role === 'tool'; i++) {
      const m = messages[i]
      if (m.content.length > TRIMMED_TOOL_CHARS) {
        m.content = `${m.content.slice(0, TRIMMED_TOOL_CHARS)}…（早期轮次结果已截断）`
      }
    }
  }
}
