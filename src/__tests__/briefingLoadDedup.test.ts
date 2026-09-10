import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/* briefingStore loadDeck 去重（v0.9.3 P2-A①）：
   开发态 StrictMode 双跑 / 窗口内快速重入复用 in-flight Promise，API 模式不重复生成；
   窗口外显式调用（刷新 / 重新生成 / 导入后重载）仍真实取数 */

const h = vi.hoisted(() => ({
  calls: 0,
  card: { id: 'm1', role: 'teacher' as const, type: 'insight' as const, tag: 'T', title: 't', body: 'b', confidence: 2, source: '' },
  /** 由测试替换：默认成功取数；置为抛错可模拟失败路径 */
  fail: false,
}))

vi.mock('../harness/providerRegistry', () => {
  /* 单例 provider：测试内替换 getDeckAsync 行为时同一个引用生效 */
  const briefing = {
    getDeck: () => [h.card],
    getDeckAsync: async () => {
      h.calls += 1
      await new Promise((r) => setTimeout(r, 20))
      if (h.fail) throw new Error('boom')
      return [h.card]
    },
  }
  return { getProviders: () => ({ briefing }) }
})

import { DECK_DEDUP_WINDOW_MS, deckKey, useBriefingStore } from '../stores/briefingStore'
import type { BriefingGenOptions } from '../harness/types'

let clock = 1_000_000
let restoreNow: () => void = () => {}

beforeEach(() => {
  h.calls = 0
  h.fail = false
  clock = 1_000_000
  const spy = vi.spyOn(Date, 'now').mockImplementation(() => clock)
  restoreNow = () => spy.mockRestore()
})

afterEach(() => {
  restoreNow()
})

describe('deckKey 稳定键', () => {
  it('键序无关；role 与 options 内容不同则不同', () => {
    const a: BriefingGenOptions = { count: 4, style: 'concise' }
    const b: BriefingGenOptions = { style: 'concise', count: 4 }
    expect(deckKey('teacher', a)).toBe(deckKey('teacher', b))
    expect(deckKey('teacher', { count: 4 })).not.toBe(deckKey('teacher', { count: 5 }))
    expect(deckKey('teacher', {})).not.toBe(deckKey('schoolAdmin', {}))
  })
})

describe('loadDeck in-flight 去重', () => {
  it('StrictMode 双跑：同 key 并发复用同一 Promise，仅一次真实取数', async () => {
    const deck = useBriefingStore.getState()
    const p1 = deck.loadDeck('teacher')
    const p2 = useBriefingStore.getState().loadDeck('teacher')

    expect(p2).toBe(p1)
    await Promise.all([p1, p2])
    expect(h.calls).toBe(1)
    expect(useBriefingStore.getState().cards.some((c) => c.id === 'm1')).toBe(true)
    expect(useBriefingStore.getState().loading).toBe(false)
  })

  it('完成后不缓存：下一次调用照常重新取数', async () => {
    await useBriefingStore.getState().loadDeck('teacher')
    expect(h.calls).toBe(1)
    await useBriefingStore.getState().loadDeck('teacher')
    expect(h.calls).toBe(2)
  })

  it('不同 options 并发：键不同各自执行，互不吞并', async () => {
    const deck = useBriefingStore.getState()
    const p1 = deck.loadDeck('teacher', { count: 4 })
    const p2 = useBriefingStore.getState().loadDeck('teacher', { count: 5 })

    expect(p2).not.toBe(p1)
    await Promise.all([p1, p2])
    expect(h.calls).toBe(2)
  })

  it('超出去重窗口的飞行中重入：不复用旧 Promise（导入数据后重载不被吞）', async () => {
    const deck = useBriefingStore.getState()
    const p1 = deck.loadDeck('teacher')
    clock += DECK_DEDUP_WINDOW_MS + 1
    const p2 = useBriefingStore.getState().loadDeck('teacher')

    expect(p2).not.toBe(p1)
    await Promise.all([p1, p2])
    expect(h.calls).toBe(2)
  })

  it('失败也清空 in-flight：后续调用可重试', async () => {
    h.fail = true
    await expect(useBriefingStore.getState().loadDeck('teacher')).rejects.toThrow('boom')
    expect(h.calls).toBe(1)

    h.fail = false
    await useBriefingStore.getState().loadDeck('teacher')
    expect(h.calls).toBe(2)
  })
})
