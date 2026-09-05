import { describe, expect, it } from 'vitest'
import { MockBriefingProvider, personalize } from '../harness/briefing/MockBriefingProvider'
import { ApiBriefingProvider } from '../harness/briefing/ApiBriefingProvider'
import { extractJsonArray, validateBriefingCard } from '../harness/briefing/validate'
import { getBriefingProvider } from '../harness/briefing'
import type { BriefingCard, BriefingGenContext } from '../harness/types'

/* 简报生成层 v0.7：运行时校验、JSON 提取、Mock 个性化排序、API 骨架失败回退 */

const baseCard = { id: 'ai-1', type: 'insight', title: '标题', body: '正文', confidence: 2 }

describe('validateBriefingCard 运行时校验', () => {
  it('合法卡片通过并补齐默认值', () => {
    const card = validateBriefingCard(baseCard, 'teacher')
    expect(card).not.toBeNull()
    expect(card!.role).toBe('teacher')
    expect(card!.tag).toBe('AI')
    expect(card!.source).toBe('AI 生成')
  })

  it('必填字段缺失/类型不符 → 整卡丢弃', () => {
    expect(validateBriefingCard(null, 'teacher')).toBeNull()
    expect(validateBriefingCard({ ...baseCard, title: 42 }, 'teacher')).toBeNull()
    expect(validateBriefingCard({ ...baseCard, type: 'unknown-type' }, 'teacher')).toBeNull()
    expect(validateBriefingCard({ ...baseCard, id: '' }, 'teacher')).toBeNull()
  })

  it('payload 非法 → 丢弃 payload 但保留卡片；合法 payload 附带 extra', () => {
    const bad = validateBriefingCard({ ...baseCard, payload: { kind: 'chart', title: '', bars: [] } }, 'teacher')
    expect(bad).not.toBeNull()
    expect(bad!.payload).toBeUndefined()
    expect(bad!.extra).toBeUndefined()

    const good = validateBriefingCard(
      { ...baseCard, payload: { kind: 'options', options: [{ text: 'A' }, { text: 'B' }] } },
      'teacher',
    )
    expect(good!.payload?.kind).toBe('options')
    expect(good!.extra).toBe('options')
  })

  it('link/action 非法 kind 被丢弃，合法保留', () => {
    const bad = validateBriefingCard({ ...baseCard, link: { kind: 'unknown', label: 'x' } }, 'teacher')
    expect(bad!.link).toBeUndefined()
    const good = validateBriefingCard(
      { ...baseCard, link: { kind: 'source', label: '查看数据源' }, action: { kind: 'openTask', goal: '做某事' } },
      'teacher',
    )
    expect(good!.link?.kind).toBe('source')
    expect(good!.action?.goal).toBe('做某事')
  })
})

describe('extractJsonArray 提取', () => {
  it('容忍代码块包裹与前后噪声', () => {
    const arr = extractJsonArray('好的，以下是卡片：\n```json\n[{"id":"ai-1"}]\n```\n以上。')
    expect(arr).toEqual([{ id: 'ai-1' }])
    expect(extractJsonArray('前缀 [{"id":1}] 后缀')).toEqual([{ id: 1 }])
  })
  it('无数组/非法 JSON → null', () => {
    expect(extractJsonArray('纯文本回复')).toBeNull()
    expect(extractJsonArray('[{broken')).toBeNull()
  })
})

describe('Mock 个性化排序', () => {
  const deck: BriefingCard[] = [
    { id: 'c1', role: 'teacher', type: 'insight', tag: '学情', title: 'a', body: '', confidence: 2, source: '' },
    { id: 'c2', role: 'teacher', type: 'decision', tag: '作业', title: 'b', body: '', confidence: 2, source: '' },
    { id: 'c3', role: 'teacher', type: 'todo', tag: '学情', title: 'c', body: '', confidence: 2, source: '' },
    { id: 'c4', role: 'teacher', type: 'data', tag: '成绩', title: 'd', body: '', confidence: 2, source: '' },
  ]
  const ctx: BriefingGenContext = {
    decisions: { c1: 'skip', c3: 'skip' },
    favorites: [deck[3]],
  }

  it('收藏 tag 前置、跳过 ≥2 次 tag 沉底、同序保持稳定', () => {
    const order = personalize(deck, ctx).map((c) => c.id)
    expect(order[0]).toBe('c4') // 收藏 tag「成绩」前置
    expect(order.slice(-2)).toEqual(['c1', 'c3']) // 「学情」跳过 2 次沉底
  })

  it('无 ctx 时保持剧本原序；getDeck 返回副本不污染剧本', () => {
    const provider = new MockBriefingProvider()
    const first = provider.getDeck('teacher')
    const second = provider.getDeck('teacher')
    expect(first.map((c) => c.id)).toEqual(second.map((c) => c.id))
    first[0].title = ' mutated'
    expect(provider.getDeck('teacher')[0].title).not.toBe(' mutated')
  })
})

describe('ApiBriefingProvider 骨架', () => {
  it('同步 getDeck 始终返回 Mock 剧本', () => {
    const provider = new ApiBriefingProvider({ baseUrl: 'http://localhost:9/v1', apiKey: 'k', model: 'm' })
    const deck = provider.getDeck('teacher')
    expect(deck.length).toBeGreaterThan(0)
    expect(deck[0].id).not.toMatch(/^ai-/)
  })

  it('LLM 不可达 → 回退 Mock 剧本（不抛错）', async () => {
    const provider = new ApiBriefingProvider({ baseUrl: 'http://localhost:9/v1', apiKey: 'k', model: 'm' })
    const deck = await provider.getDeckAsync('teacher', { decisions: {}, favorites: [] })
    expect(deck.length).toBeGreaterThan(0)
    expect(deck[0].id).not.toMatch(/^ai-/)
  })
})

describe('getBriefingProvider 工厂', () => {
  it('mock 模式返回 Mock；api 缺配置回退 Mock；api 有配置返回 Api', () => {
    expect(getBriefingProvider('mock')).toBeInstanceOf(MockBriefingProvider)
    expect(getBriefingProvider('api')).toBeInstanceOf(MockBriefingProvider)
    expect(getBriefingProvider('api', { baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' })).toBeInstanceOf(ApiBriefingProvider)
  })
})
