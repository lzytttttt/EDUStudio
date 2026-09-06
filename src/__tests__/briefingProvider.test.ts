import { describe, expect, it } from 'vitest'
import {
  MockBriefingProvider,
  deckGroupIndex,
  personalize,
  rotateDeck,
} from '../harness/briefing/MockBriefingProvider'
import { BRIEFING_DECKS, DECK_GROUP_COUNT } from '../harness/scripts/briefing'
import {
  ApiBriefingProvider,
  clampGenAttempts,
  clampGenCount,
  clampGenPrompt,
  clampGenTimeout,
  composeBriefingUser,
  composeGenConstraints,
  GEN_PROMPT_MAX_LEN,
} from '../harness/briefing/ApiBriefingProvider'
import { extractJsonArray, validateBriefingCard } from '../harness/briefing/validate'
import { getBriefingProvider } from '../harness/briefing'
import type { BriefingCard, BriefingGenContext } from '../harness/types'

/* 简报生成层 v0.7：运行时校验、JSON 提取、Mock 个性化排序、API 骨架失败回退 */
/* 简报生成层 v0.8.4：重新生成选项——约束注入、参考资料开关、Mock 种类过滤、参数 clamp */

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

  it('L3 语义偏好 tag 次优先前置（v0.9.1：收藏 > 偏好 > 默认，跳过仍沉底）', () => {
    const prefCtx: BriefingGenContext = {
      decisions: {},
      favorites: [],
      prefs: [
        { t: 0, role: 'teacher', kind: 'semantic', key: 'teacher.pref.card.tag.成绩', value: true, confidence: 0.6 },
      ],
    }
    const order = personalize(deck, prefCtx).map((c) => c.id)
    expect(order[0]).toBe('c4') // 偏好 tag「成绩」前置（收藏缺失时次优先）
    expect(order.slice(1)).toEqual(['c1', 'c2', 'c3']) // 其余保持原序
    // 偏好 + 收藏并存：收藏档（0）优先于偏好档（0.5）
    const bothCtx: BriefingGenContext = { ...prefCtx, favorites: [deck[1]] }
    const both = personalize(deck, bothCtx).map((c) => c.id)
    expect(both[0]).toBe('c2')
    expect(both[1]).toBe('c4')
    // 偏好与跳过并存：跳过 ≥2 次 tag 仍沉底
    const sinkCtx: BriefingGenContext = {
      decisions: { c1: 'skip', c3: 'skip' },
      favorites: [],
      prefs: prefCtx.prefs,
    }
    const sink = personalize(deck, sinkCtx).map((c) => c.id)
    expect(sink[0]).toBe('c4')
    expect(sink.slice(-2)).toEqual(['c1', 'c3'])
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

  it('LLM 不可达 → 回退 Mock 时 options 透传（种类过滤仍生效）', async () => {
    const provider = new ApiBriefingProvider({ baseUrl: 'http://localhost:9/v1', apiKey: 'k', model: 'm' })
    const deck = await provider.getDeckAsync('teacher', { decisions: {}, favorites: [] }, { types: ['insight'], maxAttempts: 1 })
    expect(deck.length).toBeGreaterThan(0)
    expect(deck.every((c) => c.type === 'insight')).toBe(true)
  })
})

describe('getBriefingProvider 工厂', () => {
  it('mock 模式返回 Mock；api 缺配置回退 Mock；api 有配置返回 Api', () => {
    expect(getBriefingProvider('mock')).toBeInstanceOf(MockBriefingProvider)
    expect(getBriefingProvider('api')).toBeInstanceOf(MockBriefingProvider)
    expect(getBriefingProvider('api', { baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' })).toBeInstanceOf(ApiBriefingProvider)
  })
})

describe('composeGenConstraints 生成约束（v0.8.4）', () => {
  it('缺省 options = 既有默认（5-7 张、类型多样、至少 2 张带 payload）', () => {
    const c = composeGenConstraints()
    expect(c).toContain('生成 5-7 张卡片')
    expect(c).toContain('类型多样')
    expect(c).toContain('至少 2 张带 payload')
  })

  it('数量/种类/风格/payload 按 options 注入', () => {
    const c = composeGenConstraints({
      count: 4,
      types: ['insight', 'data'],
      style: 'concise',
      payloads: { chart: true, options: false, todos: false },
    })
    expect(c).toContain('生成 4 张卡片')
    expect(c).toContain('卡片类型仅限：insight|data')
    expect(c).toContain('payload 仅限 chart 类型')
    expect(c).toContain('简洁扼要')
  })

  it('全选种类 = 不限；payload 全关 = 纯文本卡；非法种类被忽略', () => {
    const all = composeGenConstraints({ types: ['insight', 'decision', 'creation', 'todo', 'data', 'question'] })
    expect(all).toContain('类型多样')
    const none = composeGenConstraints({ payloads: { chart: false, options: false, todos: false } })
    expect(none).toContain('不要使用 payload')
    const weird = composeGenConstraints({ types: ['insight', 'unknown-type' as never] })
    expect(weird).toContain('卡片类型仅限：insight')
  })
})

describe('composeBriefingUser 自定义选项注入（v0.8.4）', () => {
  const ctx: BriefingGenContext = { decisions: { c1: 'skip' }, favorites: [] }

  it('自定义提示词注入【自定义要求】并 clamp 200 字', () => {
    const long = 'a'.repeat(260)
    const user = composeBriefingUser('teacher', ctx, '', { prompt: `  ${long}  ` })
    expect(user).toContain('【自定义要求】')
    expect(user).toContain('a'.repeat(GEN_PROMPT_MAX_LEN))
    expect(user).not.toContain('a'.repeat(GEN_PROMPT_MAX_LEN + 1))
  })

  it('参考资料开关：关闭后不注入对应段，默认全开', () => {
    const dataText = '【班级学情】测试数据'
    const off = composeBriefingUser('teacher', ctx, dataText, {
      references: { dataContext: false, decisions: false, favorites: false },
    })
    expect(off).not.toContain(dataText)
    expect(off).not.toContain('历史决策')
    expect(off).not.toContain('收藏过的卡片')
    const on = composeBriefingUser('teacher', ctx, dataText)
    expect(on).toContain(dataText)
    expect(on).toContain('历史决策')
  })
})

describe('MockBriefingProvider 种类过滤（v0.8.4）', () => {
  it('按 types 过滤静态剧本；空选 = 不过滤；个性化排序保持', () => {
    const provider = new MockBriefingProvider()
    const full = provider.getDeck('teacher')
    expect(full.length).toBeGreaterThan(0)
    const filtered = provider.getDeck('teacher', undefined, { types: ['insight'] })
    expect(filtered.length).toBeGreaterThan(0)
    expect(filtered.length).toBeLessThan(full.length)
    expect(filtered.every((c) => c.type === 'insight')).toBe(true)
    const empty = provider.getDeck('teacher', undefined, { types: [] })
    expect(empty.map((c) => c.id)).toEqual(full.map((c) => c.id))
  })
})

describe('生成参数 clamp（v0.8.4）', () => {
  it('超时 6-30s、重试 1-3、数量 3-10、提示词去空白截断', () => {
    expect(clampGenTimeout(undefined)).toBe(12000)
    expect(clampGenTimeout(1000)).toBe(6000)
    expect(clampGenTimeout(60000)).toBe(30000)
    expect(clampGenAttempts(undefined)).toBe(2)
    expect(clampGenAttempts(0)).toBe(1)
    expect(clampGenAttempts(9)).toBe(3)
    expect(clampGenCount(undefined)).toBeUndefined()
    expect(clampGenCount(2)).toBe(3)
    expect(clampGenCount(99)).toBe(10)
    expect(clampGenPrompt('  聚焦薄弱点  ')).toBe('聚焦薄弱点')
  })
})

describe('卡组周派生（v0.9 M6④/M8①）', () => {
  const DAY = 86_400_000
  const mk = (i: number): BriefingCard => ({
    id: `c${i}`,
    role: 'teacher',
    type: 'insight',
    tag: '学情',
    title: '',
    body: '',
    confidence: 2,
    source: '',
  })

  it('deckGroupIndex：第 0 周为 0，按周递增并对组数取模回绕', () => {
    expect(deckGroupIndex(0)).toBe(0)
    expect(deckGroupIndex(6 * DAY)).toBe(0)
    expect(deckGroupIndex(7 * DAY)).toBe(1)
    expect(deckGroupIndex(7 * DAY * DECK_GROUP_COUNT)).toBe(0)
  })

  it('第 0 组回归：now=0 时 getDeck 与剧本原序一致（默认体验与回归基线不变）', () => {
    const provider = new MockBriefingProvider()
    const deck = provider.getDeck('teacher', { decisions: {}, favorites: [], now: 0 })
    expect(deck.map((c) => c.id)).toEqual(BRIEFING_DECKS.teacher.map((c) => c.id))
  })

  it('非 0 组轮换：顺序变化但集合与张数不变（8 张结构保持）', () => {
    const provider = new MockBriefingProvider()
    const g0 = provider.getDeck('teacher', { decisions: {}, favorites: [], now: 0 })
    const g1 = provider.getDeck('teacher', { decisions: {}, favorites: [], now: 7 * DAY })
    expect(g1.length).toBe(g0.length)
    expect(g1.map((c) => c.id)).not.toEqual(g0.map((c) => c.id))
    expect([...g1.map((c) => c.id)].sort()).toEqual([...g0.map((c) => c.id)].sort())
  })

  it('rotateDeck 纯函数：确定性轮换（shift = group*3 % len），空卡组安全', () => {
    const deck = Array.from({ length: 8 }, (_, i) => mk(i))
    expect(rotateDeck(deck, 1).map((c) => c.id)).toEqual(['c3', 'c4', 'c5', 'c6', 'c7', 'c0', 'c1', 'c2'])
    expect(rotateDeck(deck, 0).map((c) => c.id)).toEqual(deck.map((c) => c.id))
    expect(rotateDeck([], 2)).toEqual([])
  })
})
