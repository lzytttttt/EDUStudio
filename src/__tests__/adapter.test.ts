import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeepSeekAdapter, classifyConnectionError, normalizeDelta } from '../harness/llm/adapter'
import { LLMError } from '../harness/types'

describe('normalizeDelta', () => {
  it('标准 content 增量', () => {
    const d = normalizeDelta({ choices: [{ delta: { content: '你好' }, finish_reason: null }] })
    expect(d?.content).toBe('你好')
    expect(d?.finishReason).toBeUndefined()
  })

  it('finish_reason 透传', () => {
    const d = normalizeDelta({ choices: [{ delta: {}, finish_reason: 'stop' }] })
    expect(d?.finishReason).toBe('stop')
  })

  it('reasoning_content 与 reasoning 字段兼容', () => {
    const a = normalizeDelta({ choices: [{ delta: { reasoning_content: '思考中' } }] })
    const b = normalizeDelta({ choices: [{ delta: { reasoning: '思考中' } }] })
    expect(a?.reasoning).toBe('思考中')
    expect(b?.reasoning).toBe('思考中')
  })

  it('tool_calls 分片归一化（含 index 缺省回退）', () => {
    const d = normalizeDelta({
      choices: [{ delta: { tool_calls: [{ id: 'call_1', function: { name: 'genQuiz', arguments: '{"kn' } }] } }],
    })
    expect(d?.toolCalls).toEqual([
      { index: 0, id: 'call_1', name: 'genQuiz', argumentsFragment: '{"kn' },
    ])
  })

  it('空 delta 返回 null', () => {
    expect(normalizeDelta({ choices: [{ delta: {} }] })).toBeNull()
    expect(normalizeDelta({})).toBeNull()
    expect(normalizeDelta(null)).toBeNull()
  })
})

/** 构造 SSE 流式 Response（Node 18+ 全局 Response / ReadableStream） */
function sseResponse(payloads: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of payloads) controller.enqueue(encoder.encode(`data: ${p}\n\n`))
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

describe('streamChatRaw tools 请求体（v0.9 M1①/M8①）', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('options.tools 非空 → 请求体合入 tools 字段（function-calling 接线）', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      sseResponse(['{"choices":[{"delta":{"content":"好"}}]}']),
    )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new DeepSeekAdapter({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' })
    const tools = [{ type: 'function', function: { name: 'genQuiz', description: '出题' } }]
    for await (const delta of adapter.streamChatRaw([{ role: 'user', content: 'hi' }], undefined, { tools })) {
      void delta
      break // 首个增量即可，请求体已发出
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)
    expect(body.tools).toEqual(tools)
    expect(body.stream).toBe(true)
    expect(body.model).toBe('m')
  })

  it('不传 options → 请求体不含 tools（向后兼容）', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      sseResponse(['{"choices":[{"delta":{"content":"好"}}]}']),
    )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new DeepSeekAdapter({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' })
    for await (const delta of adapter.streamChatRaw([{ role: 'user', content: 'hi' }])) {
      void delta
      break
    }
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)
    expect(body.tools).toBeUndefined()
  })

  it('tools 空数组 → 请求体不含 tools', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      sseResponse(['{"choices":[{"delta":{"content":"好"}}]}']),
    )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new DeepSeekAdapter({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' })
    for await (const delta of adapter.streamChatRaw([{ role: 'user', content: 'hi' }], undefined, { tools: [] })) {
      void delta
      break
    }
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)
    expect(body.tools).toBeUndefined()
  })
})

describe('classifyConnectionError 连接错误分类（v0.9 M7①/M8①）', () => {
  it('401/403 → Key 无效提示', () => {
    expect(classifyConnectionError(new LLMError('LLM API 401', 401))).toContain('API Key 无效')
    expect(classifyConnectionError(new LLMError('LLM API 403', 403))).toContain('API Key 无效')
  })

  it('404 → baseUrl 提示', () => {
    expect(classifyConnectionError(new LLMError('LLM API 404', 404))).toContain('/v1')
  })

  it('其余状态码原样透出', () => {
    expect(classifyConnectionError(new LLMError('LLM API 500：server busy', 500))).toBe(
      'LLM API 500：server busy',
    )
  })

  it('TypeError（请求未发出）→ 无法连接提示', () => {
    expect(classifyConnectionError(new TypeError('Failed to fetch'))).toContain('无法连接目标地址')
  })

  it('普通 Error / 字符串 → 原样', () => {
    expect(classifyConnectionError(new Error('boom'))).toBe('boom')
    expect(classifyConnectionError('str')).toBe('str')
  })
})
