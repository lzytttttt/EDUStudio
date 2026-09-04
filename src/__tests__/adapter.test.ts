import { describe, expect, it } from 'vitest'
import { normalizeDelta } from '../harness/llm/adapter'

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
