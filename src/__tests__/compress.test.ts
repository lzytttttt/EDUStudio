import { describe, expect, it } from 'vitest'
import { compressToolRounds, estimateContextChars } from '../harness/agent/Orchestrator'
import type { ChatMessage } from '../harness/types'

/** 构造 N 轮工具会话：user → assistant(toolCalls) → tool(大结果) → assistant(结论) */
function buildRounds(n: number, resultChars: number): ChatMessage[] {
  const msgs: ChatMessage[] = [{ role: 'user', content: '请分析三年级学情并检索课标' }]
  for (let i = 0; i < n; i++) {
    msgs.push({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: `c${i}`, name: 'searchCurriculum', arguments: '{"keyword":"分数"}' }],
    })
    msgs.push({
      role: 'tool',
      toolCallId: `c${i}`,
      content: JSON.stringify({ summary: `第${i}轮检索结果`, data: 'x'.repeat(resultChars) }),
    })
    msgs.push({ role: 'assistant', content: `第${i}轮结论：分数应用题薄弱。` })
  }
  return msgs
}

describe('上下文压缩（v0.5 M3③ 验收④）', () => {
  it('超预算时早期工具轮折叠为摘要，最近 2 轮保留原文', () => {
    const msgs = buildRounds(8, 2000)
    const before = estimateContextChars(msgs)
    compressToolRounds(msgs, 12000)
    const after = estimateContextChars(msgs)
    expect(after).toBeLessThan(before)
    expect(after).toBeLessThanOrEqual(12000 + 4000) // 预算 + 最近2轮原文余量
    // 最近 2 轮原文保留
    const toolMsgs = msgs.filter((m) => m.role === 'tool')
    const lastTool = toolMsgs[toolMsgs.length - 1]
    expect(lastTool?.content).toContain('第7轮检索结果')
    // 早期轮次已折叠为摘要
    const digest = msgs.find((m) => m.content.includes('【早期工具轮次摘要】'))
    expect(digest).toBeTruthy()
    expect(digest!.content).toContain('调用 searchCurriculum')
  })

  it('20 轮长会话压缩后上下文有界（不随轮次线性增长）', () => {
    const msgs = buildRounds(20, 2000)
    compressToolRounds(msgs, 12000)
    const after = estimateContextChars(msgs)
    // 20 轮 × ~2000 字符 ≈ 40K+，压缩后必须收敛到预算量级
    expect(after).toBeLessThan(20000)
    // 协议合法：每条 tool 消息前面必是 assistant(toolCalls)
    for (let i = 0; i < msgs.length; i++) {
      if (msgs[i].role === 'tool') {
        expect(msgs[i - 1]?.role).toBe('assistant')
        expect(msgs[i - 1]?.toolCalls?.length).toBeGreaterThan(0)
      }
    }
  })

  it('低于预算时不做任何折叠', () => {
    const msgs = buildRounds(2, 200)
    const snapshot = JSON.stringify(msgs)
    compressToolRounds(msgs, 12000)
    expect(JSON.stringify(msgs)).toBe(snapshot)
  })
})
