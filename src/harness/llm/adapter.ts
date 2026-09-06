import { LLMError, type ChatMessage, type LLMDelta, type LLMProvider, type StreamChatRawOptions } from '../types'
import { parseSSEChunk } from './sse'

export interface DeepSeekConfig {
  /** OpenAI 兼容 baseUrl（以 /v1 结尾） */
  baseUrl: string
  apiKey: string
  model: string
  /** 轻后端代理地址：非空时请求走代理（key 由代理保管，本地不携带 Authorization） */
  proxyUrl?: string
}

/** OpenAI 兼容 chunk → LLMDelta 归一化（容忍 reasoning_content / reasoning 等差异字段） */
export function normalizeDelta(json: unknown): LLMDelta | null {
  const choice = (json as { choices?: { delta?: Record<string, unknown>; finish_reason?: string | null }[] })
    ?.choices?.[0]
  if (!choice) return null
  const d = choice.delta ?? {}
  const rawToolCalls = Array.isArray(d.tool_calls) ? d.tool_calls : []
  const toolCalls = rawToolCalls.length
    ? rawToolCalls.map((tc, i) => {
        const t = tc as { index?: number; id?: string; function?: { name?: string; arguments?: string } }
        return {
          index: typeof t.index === 'number' ? t.index : i,
          id: t.id ?? undefined,
          name: t.function?.name ?? undefined,
          argumentsFragment: t.function?.arguments ?? '',
        }
      })
    : undefined
  const delta: LLMDelta = {
    content: typeof d.content === 'string' && d.content ? d.content : undefined,
    reasoning:
      typeof d.reasoning_content === 'string' && d.reasoning_content
        ? d.reasoning_content
        : typeof d.reasoning === 'string' && d.reasoning
          ? d.reasoning
          : undefined,
    toolCalls,
    finishReason: choice.finish_reason ?? undefined,
  }
  const empty = !delta.content && !delta.reasoning && !delta.toolCalls?.length && !delta.finishReason
  return empty ? null : delta
}

/**
 * DeepSeekAdapter —— OpenAI 兼容 /chat/completions SSE 流式适配。
 * 支持直连（需 key）与轻后端代理（proxyUrl 非空时优先，见 v0.2 专项 02）。
 */
export class DeepSeekAdapter implements LLMProvider {
  constructor(private config: DeepSeekConfig) {}

  private get endpoint(): string {
    const base = (this.config.proxyUrl?.trim() || this.config.baseUrl).replace(/\/+$/, '')
    return `${base}/chat/completions`
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.config.proxyUrl?.trim()) {
      // 代理模式：key 由代理统一保管，仅带客户端标识供审计
      h['X-EDU-Client'] = 'edustudio-web'
    } else if (this.config.apiKey) {
      h['Authorization'] = `Bearer ${this.config.apiKey}`
    }
    return h
  }

  private async open(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    let res: Response
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal,
      })
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err
      // v0.9 M7①：网络层 TypeError（请求未发出：断网/跨域/DNS）原样透传，由 classifyConnectionError 归类提示
      if (err instanceof TypeError) throw err
      throw new LLMError(`网络请求失败：${(err as Error)?.message ?? 'unknown'}`)
    }
    if (!res.ok || !res.body) {
      let detail = ''
      try {
        detail = (await res.text()).slice(0, 200)
      } catch {
        /* ignore */
      }
      throw new LLMError(`LLM API ${res.status}${detail ? `：${detail}` : ''}`, res.status)
    }
    return res
  }

  /**
   * 原始增量流：yield 归一化 delta（含 tool_calls 分片），Orchestrator 消费。
   * v0.9 M1①：options.tools 非空时合入请求体——模型自此知道可用工具，才会返回 tool_calls
   * （v0.9 前该字段从未下发，function-calling 主路径恒走 Plan-JSON 降级）；不传时行为不变。
   */
  async *streamChatRaw(
    messages: ChatMessage[],
    signal?: AbortSignal,
    options?: StreamChatRawOptions,
  ): AsyncGenerator<LLMDelta> {
    const body: Record<string, unknown> = { model: this.config.model, messages, stream: true }
    if (options?.tools?.length) body.tools = options.tools
    const res = await this.open(body, signal)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { events, rest } = parseSSEChunk(buffer)
        buffer = rest
        for (const payload of events) {
          if (payload === '[DONE]') return
          let json: unknown
          try {
            json = JSON.parse(payload)
          } catch {
            continue // 非 JSON 心跳/噪声行
          }
          const delta = normalizeDelta(json)
          if (delta) yield delta
        }
      }
    } finally {
      try {
        reader.releaseLock()
      } catch {
        /* ignore */
      }
    }
  }

  /** 纯文本流：仅透传 content 增量，语义与 MockLLMProvider 一致 */
  async *streamChat(messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<string> {
    for await (const delta of this.streamChatRaw(messages, signal)) {
      if (delta.content) yield delta.content
    }
  }
}

/**
 * 连接错误分类（v0.9 M7①）：断网/跨域、Key 无效、地址错误分别给出可区分的中文提示，
 * 其余状态码原样透出（导出供单测）。
 */
export function classifyConnectionError(err: unknown): string {
  if (err instanceof LLMError) {
    if (err.status === 401 || err.status === 403) return 'API Key 无效或无权限，请检查 Key 是否正确、账户是否有额度'
    if (err.status === 404) return '接口地址不存在，请检查 baseUrl 是否以 /v1 结尾'
    return err.message
  }
  // fetch 网络层错误（TypeError）：请求未发出——网络不通 / 浏览器跨域限制 / DNS 失败
  if (err instanceof TypeError) {
    return '无法连接目标地址，可能为网络不通或浏览器跨域限制，建议改用轻后端代理'
  }
  return err instanceof Error ? err.message : String(err)
}

/** 测试连接：发送一条短请求，返回成功/失败与摘要（供设置页「测试连接」按钮） */
export async function testLLMConnection(
  config: DeepSeekConfig,
): Promise<{ ok: boolean; message: string }> {
  if (!config.proxyUrl?.trim() && !config.apiKey.trim()) {
    return { ok: false, message: '请先填写 API Key 或代理地址' }
  }
  const adapter = new DeepSeekAdapter(config)
  try {
    let got = ''
    for await (const delta of adapter.streamChat([{ role: 'user', content: '请只回复两个字：正常' }])) {
      got += delta
      if (got.length >= 12) break
    }
    return { ok: true, message: `连接成功${got.trim() ? `：${got.trim().slice(0, 24)}` : ''}` }
  } catch (err) {
    return { ok: false, message: classifyConnectionError(err).slice(0, 120) }
  }
}
