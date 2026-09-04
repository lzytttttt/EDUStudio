import { describe, expect, it } from 'vitest'
import { normalizeDelta } from '../harness/llm/adapter'
import { trimOldToolResults, parsePlanJson } from '../harness/agent/Orchestrator'
import type { ChatMessage, LLMDelta } from '../harness/types'

/**
 * v0.4 M1③：流式工具参数分片聚合边界测试。
 * Orchestrator.collectRound 按 index 累积 argumentsFragment，本组用例覆盖
 * 归一化层（normalizeDelta）与聚合消费层的典型边界。
 */

/** 模拟 Orchestrator 的分片聚合逻辑（与 collectRound 一致） */
function aggregate(deltas: LLMDelta[]): { id: string; name: string; args: string }[] {
  const pending = new Map<number, { id: string; name: string; args: string; index: number }>()
  for (const delta of deltas) {
    for (const tc of delta.toolCalls ?? []) {
      const cur = pending.get(tc.index) ?? { index: tc.index, id: '', name: '', args: '' }
      if (tc.id) cur.id = tc.id
      if (tc.name) cur.name = tc.name
      cur.args += tc.argumentsFragment
      pending.set(tc.index, cur)
    }
  }
  return [...pending.values()].sort((a, b) => a.index - b.index).map(({ id, name, args }) => ({ id, name, args }))
}

describe('流式工具参数分片聚合（v0.4 M1③）', () => {
  it('跨 chunk 分片拼接：arguments 分多次到达后可 JSON.parse', () => {
    const deltas = [
      normalizeDelta({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'genQuiz', arguments: '{"knowledgePoi' } }] } }] })!,
      normalizeDelta({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'nt":"函数单调' } }] } }] })!,
      normalizeDelta({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '性判定"}' } }] } }] })!,
    ]
    const calls = aggregate(deltas)
    expect(calls).toHaveLength(1)
    expect(calls[0].id).toBe('call_a')
    expect(calls[0].name).toBe('genQuiz')
    expect(() => JSON.parse(calls[0].args)).not.toThrow()
    expect(JSON.parse(calls[0].args)).toEqual({ knowledgePoint: '函数单调性判定' })
  })

  it('多工具并行分片：不同 index 互不串扰，按 index 排序输出', () => {
    const deltas = [
      normalizeDelta({ choices: [{ delta: { tool_calls: [
        { index: 1, id: 'call_b', function: { name: 'querySchoolStats', arguments: '{}' } },
        { index: 0, id: 'call_a', function: { name: 'queryClassLearning', arguments: '{"class' } },
      ] } } ] })!,
      normalizeDelta({ choices: [{ delta: { tool_calls: [
        { index: 0, function: { arguments: 'Name":"高一（3）班"}' } },
      ] } } ] })!,
    ]
    const calls = aggregate(deltas)
    expect(calls.map((c) => c.name)).toEqual(['queryClassLearning', 'querySchoolStats'])
    expect(JSON.parse(calls[0].args)).toEqual({ className: '高一（3）班' })
  })

  it('index 缺省回退：按数组下标对齐（部分兼容端点不带 index）', () => {
    const d = normalizeDelta({
      choices: [{ delta: { tool_calls: [{ id: 'call_x', function: { name: 't1', arguments: 'a' } }, { function: { arguments: 'b' } }] } }],
    })
    expect(d?.toolCalls?.map((t) => t.index)).toEqual([0, 1])
    expect(d?.toolCalls?.[1].argumentsFragment).toBe('b')
  })

  it('空 arguments 与缺省 function 字段容忍', () => {
    const d = normalizeDelta({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_e' }] } }] })
    expect(d?.toolCalls).toEqual([{ index: 0, id: 'call_e', name: undefined, argumentsFragment: '' }])
  })

  it('content 与 tool_calls 同 chunk 混合输出', () => {
    const d = normalizeDelta({
      choices: [{ delta: { content: '先查学情', tool_calls: [{ index: 0, function: { name: 't', arguments: '{}' } }] } }],
    })
    expect(d?.content).toBe('先查学情')
    expect(d?.toolCalls).toHaveLength(1)
  })
})

describe('多轮循环上下文裁剪（v0.4 M1①）', () => {
  const toolMsg = (id: string, len: number): ChatMessage => ({
    role: 'tool',
    toolCallId: id,
    content: 'x'.repeat(len),
  })

  it('仅保留最近 2 轮工具结果全文，更早轮次截断', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '目标' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 't1', arguments: '{}' }] },
      toolMsg('c1', 500),
      { role: 'assistant', content: '', toolCalls: [{ id: 'c2', name: 't2', arguments: '{}' }] },
      toolMsg('c2', 500),
      { role: 'assistant', content: '', toolCalls: [{ id: 'c3', name: 't3', arguments: '{}' }] },
      toolMsg('c3', 500),
      { role: 'assistant', content: '', toolCalls: [{ id: 'c4', name: 't4', arguments: '{}' }] },
      toolMsg('c4', 500),
    ]
    trimOldToolResults(messages)
    // 第 1、2 轮（c1/c2）被截断
    expect(messages[2].content).toContain('早期轮次结果已截断')
    expect(messages[4].content).toContain('早期轮次结果已截断')
    // 第 3、4 轮（c3/c4）保留全文
    expect(messages[6].content).toBe('x'.repeat(500))
    expect(messages[8].content).toBe('x'.repeat(500))
  })

  it('轮次不足时不做任何截断', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '目标' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 't1', arguments: '{}' }] },
      toolMsg('c1', 500),
    ]
    const before = messages[2].content
    trimOldToolResults(messages)
    expect(messages[2].content).toBe(before)
  })

  it('短结果不截断（低于阈值保持原样）', () => {
    const messages: ChatMessage[] = [
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 't1', arguments: '{}' }] },
      toolMsg('c1', 100),
      { role: 'assistant', content: '', toolCalls: [{ id: 'c2', name: 't2', arguments: '{}' }] },
      toolMsg('c2', 100),
      { role: 'assistant', content: '', toolCalls: [{ id: 'c3', name: 't3', arguments: '{}' }] },
      toolMsg('c3', 100),
    ]
    trimOldToolResults(messages)
    // 3 轮 → cutoff=1，仅第 1 轮（c1）进入截断名单，但 100 ≤ 240 保持原样
    expect(messages[1].content).toBe('x'.repeat(100))
    expect(messages[3].content).toBe('x'.repeat(100))
    expect(messages[5].content).toBe('x'.repeat(100))
  })
})

describe('Plan-JSON 解析（既有回归）', () => {
  it('容忍代码块包裹', () => {
    const steps = parsePlanJson('```json\n{"steps":[{"type":"tool","tool":"t1","args":{}}]}\n```')
    expect(steps).toEqual([{ type: 'tool', tool: 't1', args: {} }])
  })

  it('非法输入返回 null', () => {
    expect(parsePlanJson('')).toBeNull()
    expect(parsePlanJson('不是 JSON')).toBeNull()
    expect(parsePlanJson('{"steps":"not-array"}')).toBeNull()
  })
})
