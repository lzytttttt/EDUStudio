import { describe, expect, it } from 'vitest'
import { formatUpstreamContext, formatUpstreamResults, upstreamReflectText } from '../harness/loom/context'
import type { LoomUpstreamRef } from '../harness/types'

/* v0.9.4-03：Loom 上游结果组装（文档生成注入 / 节点执行注入共用格式化） */

const upstream: LoomUpstreamRef[] = [
  { nodeId: 'a', title: '分析学情', output: '函数单调性掌握率 61%' },
  { nodeId: 'cp', title: '人工确认', output: '' },
]

describe('loom 上游结果组装', () => {
  it('formatUpstreamResults：空 / 缺省返回空串（旧路径零副作用）', () => {
    expect(formatUpstreamResults()).toBe('')
    expect(formatUpstreamResults([])).toBe('')
  })

  it('formatUpstreamResults：按「- 标题：输出」逐行组装，空输出给占位文案', () => {
    const text = formatUpstreamResults(upstream)
    expect(text.startsWith('上游任务结果：')).toBe(true)
    expect(text).toContain('- 分析学情：函数单调性掌握率 61%')
    expect(text).toContain('- 人工确认：（暂无文本输出）')
  })

  it('formatUpstreamContext：含上游时输出「上游任务结果…当前目标」，无上游退化为「当前目标」', () => {
    const withUpstream = formatUpstreamContext(upstream, '生成三档练习')
    expect(withUpstream).toContain('上游任务结果：')
    expect(withUpstream).toContain('当前目标：生成三档练习')

    expect(formatUpstreamContext([], '生成三档练习')).toBe('当前目标：生成三档练习')
  })

  it('upstreamReflectText：Mock 演示文案含全部上游标题', () => {
    const text = upstreamReflectText(upstream)
    expect(text).toContain('已接收上游 2 项结果')
    expect(text).toContain('分析学情')
    expect(text).toContain('人工确认')
  })
})
