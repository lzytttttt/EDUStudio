import type { ChatMessage, LLMProvider } from '../types'

/**
 * DeepSeekAdapter —— OpenAI 兼容 chat/completions SSE 适配骨架。
 *
 * 接入步骤（业务代码零改动）：
 * 1. 实现 streamChat：POST {baseUrl}/chat/completions，body 含 model/messages/stream:true
 * 2. 解析 SSE：逐行读取 data: {...}，取 choices[0].delta.content 累积 yield
 * 3. 在 providerRegistry 将 ACTIVE_MODE 切为 'api'
 *
 * 安全提示：浏览器直连会暴露 key，生产环境建议经轻后端代理转发。
 */
export class DeepSeekAdapter implements LLMProvider {
  constructor(
    private config: { baseUrl: string; apiKey: string; model: string } = {
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: '',
      model: 'deepseek-chat',
    },
  ) {}

  async *streamChat(_messages: ChatMessage[], _signal?: AbortSignal): AsyncGenerator<string> {
    throw new Error(
      '[DeepSeekAdapter] API 模式尚未接入：请实现 OpenAI 兼容 SSE 流式调用后，在 providerRegistry 切换 ACTIVE_MODE',
    )
    // eslint-disable-next-line no-unreachable
    yield ''
  }
}
