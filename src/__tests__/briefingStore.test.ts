import { beforeEach, describe, expect, it } from 'vitest'
import { useBriefingStore } from '../stores/briefingStore'
import { useAuthStore } from '../stores/authStore'
import { loadJSON } from '../lib/storage'
import type { PayloadPatch } from '../harness/types'

/* briefingStore v0.7：payload 覆盖层、交互 action、loadDeck kind 合并、decide 回归 */

interface PersistedBriefing {
  decisions: Record<string, string>
  favorites: unknown[]
  payloads?: Record<string, PayloadPatch>
}

const resetState = () => {
  localStorage.clear()
  useBriefingStore.setState({
    cards: [],
    decisions: {},
    favorites: [],
    payloads: {},
    processed: 0,
    loading: false,
    meta: null,
  })
  useAuthStore.setState({ role: 'teacher' })
}

beforeEach(resetState)

describe('briefingStore 交互覆盖层', () => {
  it('selectOption：更新卡片选中态并持久化到 localStorage', async () => {
    await useBriefingStore.getState().loadDeck('teacher')
    const optionsCard = useBriefingStore.getState().cards.find((c) => c.payload?.kind === 'options')
    expect(optionsCard).toBeTruthy()

    useBriefingStore.getState().selectOption(optionsCard!.id, 1)
    const updated = useBriefingStore.getState().cards.find((c) => c.id === optionsCard!.id)
    expect(updated?.payload?.kind === 'options' && updated.payload.selected).toBe(1)

    const persisted = loadJSON<Required<PersistedBriefing>>('briefing', { decisions: {}, favorites: [], payloads: {} })
    expect(persisted.payloads?.[optionsCard!.id]).toEqual({ kind: 'options', selected: 1 })
  })

  it('toggleTodo：勾选待办并持久化，再勾选取消', async () => {
    await useBriefingStore.getState().loadDeck('schoolAdmin')
    const todoCard = useBriefingStore.getState().cards.find((c) => c.payload?.kind === 'todos')
    expect(todoCard).toBeTruthy()

    const store = useBriefingStore.getState()
    store.toggleTodo(todoCard!.id, 0)
    let updated = useBriefingStore.getState().cards.find((c) => c.id === todoCard!.id)
    expect(updated?.payload?.kind === 'todos' && updated.payload.todos[0].done).toBe(true)

    useBriefingStore.getState().toggleTodo(todoCard!.id, 0)
    updated = useBriefingStore.getState().cards.find((c) => c.id === todoCard!.id)
    expect(updated?.payload?.kind === 'todos' && updated.payload.todos[0].done).toBe(false)
  })

  it('editCardText：保存编辑文本并持久化', async () => {
    await useBriefingStore.getState().loadDeck('teacher')
    const editableCard = useBriefingStore.getState().cards.find((c) => c.payload?.kind === 'editable')
    expect(editableCard).toBeTruthy()

    useBriefingStore.getState().editCardText(editableCard!.id, '自定义讲稿内容')
    const updated = useBriefingStore.getState().cards.find((c) => c.id === editableCard!.id)
    expect(updated?.payload?.kind === 'editable' && updated.payload.text).toBe('自定义讲稿内容')

    const persisted = loadJSON<Required<PersistedBriefing>>('briefing', { decisions: {}, favorites: [], payloads: {} })
    expect(persisted.payloads?.[editableCard!.id]).toEqual({ kind: 'editable', text: '自定义讲稿内容' })
  })

  it('loadDeck：按 kind 判别合并覆盖层，chart 等只读卡不受影响', async () => {
    await useBriefingStore.getState().loadDeck('teacher')
    const store = useBriefingStore.getState()
    const optionsCard = store.cards.find((c) => c.payload?.kind === 'options')!
    const chartCard = store.cards.find((c) => c.payload?.kind === 'chart')!
    store.selectOption(optionsCard.id, 2)

    // 重新加载卡组：选中态从覆盖层恢复
    await useBriefingStore.getState().loadDeck('teacher')
    const restored = useBriefingStore.getState().cards.find((c) => c.id === optionsCard.id)
    expect(restored?.payload?.kind === 'options' && restored.payload.selected).toBe(2)
    // chart 卡无 selected 字段（只读 payload 不被污染）
    const chart = useBriefingStore.getState().cards.find((c) => c.id === chartCard.id)
    expect(chart?.payload?.kind).toBe('chart')
    expect(chart?.payload).not.toHaveProperty('selected')
  })
})

describe('briefingStore 决策回归', () => {
  it('decide：记录决策、收藏入夹、processed 递增', async () => {
    await useBriefingStore.getState().loadDeck('teacher')
    const store = useBriefingStore.getState()
    const card = store.cards[0]

    const decided = store.decide(card.id, 'fav')
    expect(decided?.id).toBe(card.id)
    expect(useBriefingStore.getState().decisions[card.id]).toBe('fav')
    expect(useBriefingStore.getState().favorites.map((f) => f.id)).toContain(card.id)
    expect(useBriefingStore.getState().processed).toBe(1)
  })

  it('resetDeck：清空决策与覆盖层，保留收藏', async () => {
    await useBriefingStore.getState().loadDeck('teacher')
    const store = useBriefingStore.getState()
    const [a, b] = store.cards
    store.decide(a.id, 'fav')
    store.decide(b.id, 'skip')
    if (b.payload?.kind === 'options') store.selectOption(b.id, 0)

    useBriefingStore.getState().resetDeck()
    const next = useBriefingStore.getState()
    expect(next.decisions).toEqual({})
    expect(next.payloads).toEqual({})
    expect(next.processed).toBe(0)
    expect(next.favorites.map((f) => f.id)).toContain(a.id)
  })
})
