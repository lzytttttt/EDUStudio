import { LLMError, type ChatMessage, type LLMDelta, type LLMProvider } from '../types'
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

  /** 原始增量流：yield 归一化 delta（含 tool_calls 分片），Orchestrator 消费 */
  async *streamChatRaw(messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<LLMDelta> {
    const res = await this.open({ model: this.config.model, messages, stream: true }, signal)
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
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, message: msg.slice(0, 120) }
  }
}
