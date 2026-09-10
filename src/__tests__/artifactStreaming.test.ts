import { beforeEach, describe, expect, it } from 'vitest'
import { useArtifactStore } from '../stores/artifactStore'

/**
 * v0.9.3 P0-D② 文档 chunk 批处理：同帧多个 chunk 只产生一次 store 通知，
 * 内容按到达顺序拼接（chatStore 侧用 createStreamBuffer 组批，见 throttle.test.ts）。
 */

const artifact = () => useArtifactStore.getState()

beforeEach(() => {
  useArtifactStore.setState({ docs: [], revisions: {}, activeId: null, generatingIds: [], unreadDocIds: [] })
})

describe('appendChunks 批量追加', () => {
  it('批量写入合并为一次通知，内容按顺序拼接', () => {
    artifact().createPlaceholder('a1', '教案', 'lessonPlan', 'teacher', 'agent')

    const notified: number[] = []
    const unsub = useArtifactStore.subscribe(() => notified.push(1))
    artifact().appendChunks([
      { id: 'a1', chunk: '# 教案\n' },
      { id: 'a1', chunk: '## 目标\n' },
      { id: 'a1', chunk: '理解单调性' },
    ])
    unsub()

    expect(notified.length).toBe(1)
    expect(artifact().docs[0].content).toBe('# 教案\n## 目标\n理解单调性')
  })

  it('逐条 appendChunk 等价于批量结果，但通知次数更多（批处理的价值）', () => {
    artifact().createPlaceholder('a1', '教案', 'lessonPlan', 'teacher', 'agent')
    artifact().createPlaceholder('a2', '报告', 'report', 'teacher', 'agent')

    let batched = 0
    const un1 = useArtifactStore.subscribe(() => batched++)
    artifact().appendChunks([
      { id: 'a1', chunk: 'A' },
      { id: 'a2', chunk: 'B' },
    ])
    un1()

    const contentById = () => Object.fromEntries(artifact().docs.map((d) => [d.id, d.content]))
    expect(contentById()).toEqual({ a1: 'A', a2: 'B' })

    let perChunk = 0
    const un2 = useArtifactStore.subscribe(() => perChunk++)
    artifact().appendChunk('a1', 'A2')
    artifact().appendChunk('a2', 'B2')
    un2()

    expect(batched).toBe(1)
    expect(perChunk).toBe(2)
    expect(contentById()).toEqual({ a1: 'AA2', a2: 'BB2' })
  })

  it('空批次零副作用；未知文档 id 不修改任何文档', () => {
    artifact().createPlaceholder('a1', '教案', 'lessonPlan', 'teacher', 'agent')
    let notified = 0
    const unsub = useArtifactStore.subscribe(() => notified++)
    artifact().appendChunks([])
    artifact().appendChunks([{ id: 'ghost', chunk: 'x' }])
    unsub()
    expect(notified).toBe(0)
    expect(artifact().docs[0].content).toBe('')
    expect(artifact().docs.length).toBe(1)
  })

  it('批处理不改变生成中标识（收敛仍由 finalize 负责）', () => {
    artifact().createPlaceholder('a1', '教案', 'lessonPlan', 'teacher', 'agent')
    artifact().appendChunks([{ id: 'a1', chunk: '内容' }])
    expect(artifact().generatingIds).toEqual(['a1'])
    artifact().finalize('a1', '教案', 'lessonPlan')
    expect(artifact().generatingIds).toEqual([])
    expect(artifact().unreadDocIds).toEqual(['a1'])
  })
})
