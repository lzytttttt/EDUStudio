import { create } from 'zustand'
import type { BriefingCard, BriefingGenContext, BriefingGenOptions, PayloadPatch, RoleId } from '../harness/types'
import { getProviders } from '../harness/providerRegistry'
import { buildDataCards } from '../harness/sources/dataCards'
import { getSourceProvider, type SourceMeta } from '../harness/sources'
import { loadJSON, saveJSON } from '../lib/storage'

export type CardDecision = 'skip' | 'fav' | 'accept'

interface PersistedBriefing {
  decisions: Record<string, CardDecision>
  favorites: BriefingCard[]
  /** 用户交互覆盖层（v0.7）：选项选择/待办勾选/文本编辑，按卡片 id 持久化 */
  payloads?: Record<string, PayloadPatch>
  /** 重新生成选项（v0.8.4）：弹窗记忆，下次打开回填并随 loadDeck 透传 */
  genOptions?: BriefingGenOptions
}

interface BriefingState {
  cards: BriefingCard[]
  decisions: Record<string, CardDecision>
  favorites: BriefingCard[]
  /** payload 覆盖层：loadDeck 时按 kind 判别合并进 cards，保证刷新后交互态不丢 */
  payloads: Record<string, PayloadPatch>
  /** 已处理计数（skip + accept） */
  processed: number
  /** 卡组加载中（异步取数期间展示骨架屏） */
  loading: boolean
  /** 本次卡组的数据元信息（来源 + 时间戳，v0.5 M1④ 新鲜度标注） */
  meta: SourceMeta | null
  /** 重新生成选项（v0.8.4）：弹窗回填 + loadDeck 缺省透传，随 'briefing' 持久化 */
  genOptions: BriefingGenOptions
  /** 保存重新生成选项（弹窗确认时调用），立即持久化 */
  setGenOptions: (options: BriefingGenOptions) => void
  /** 加载卡组：静态剧本（Mock 个性化 / API 生成）+ 数据驱动卡（异步，v0.5 M1②）；options 缺省时沿用已存 genOptions */
  loadDeck: (role: RoleId, options?: BriefingGenOptions) => Promise<void>
  decide: (cardId: string, decision: CardDecision) => BriefingCard | undefined
  /** 选中选项卡（v0.7）：写覆盖层 + 即时更新 cards */
  selectOption: (cardId: string, index: number) => void
  /** 勾选/取消待办（v0.7） */
  toggleTodo: (cardId: string, index: number) => void
  /** 保存可编辑文本（v0.7） */
  editCardText: (cardId: string, text: string) => void
  removeFavorite: (cardId: string) => void
  /** 撤回决策（v0.8.2）：拖回已处理卡片重新批阅——移除决策、收藏联动移除、processed 回退 */
  revertDecision: (cardId: string) => void
  resetDeck: () => void
}

const persisted = loadJSON<PersistedBriefing>('briefing', { decisions: {}, favorites: [] })

function persist(s: {
  decisions: Record<string, CardDecision>
  favorites: BriefingCard[]
  payloads: Record<string, PayloadPatch>
  genOptions: BriefingGenOptions
}): void {
  saveJSON('briefing', { decisions: s.decisions, favorites: s.favorites, payloads: s.payloads, genOptions: s.genOptions })
}

/** 按 kind 判别合并覆盖层：只作用于匹配类型的 payload，不破坏 chart 等只读卡 */
function applyPatch(card: BriefingCard, patch: PayloadPatch | undefined): BriefingCard {
  if (!patch || !card.payload || card.payload.kind !== patch.kind) return card
  if (patch.kind === 'options' && card.payload.kind === 'options') {
    return { ...card, payload: { ...card.payload, selected: patch.selected } }
  }
  if (patch.kind === 'todos' && card.payload.kind === 'todos') {
    return {
      ...card,
      payload: { ...card.payload, todos: card.payload.todos.map((t, i) => ({ ...t, done: patch.done[i] ?? t.done ?? false })) },
    }
  }
  if (patch.kind === 'editable' && card.payload.kind === 'editable') {
    return { ...card, payload: { ...card.payload, text: patch.text } }
  }
  return card
}

export const useBriefingStore = create<BriefingState>((set, get) => ({
  cards: [],
  decisions: persisted.decisions,
  favorites: persisted.favorites,
  payloads: persisted.payloads ?? {},
  processed: 0,
  loading: false,
  meta: null,
  genOptions: persisted.genOptions ?? {},
  setGenOptions: (options) => {
    set({ genOptions: options })
    persist({ decisions: get().decisions, favorites: get().favorites, payloads: get().payloads, genOptions: options })
  },
  loadDeck: async (role, options) => {
    set({ loading: true })
    // 个性化上下文（v0.7）：历史决策 + 收藏，Mock 排序 / API 生成共用
    const ctx: BriefingGenContext = { decisions: get().decisions, favorites: get().favorites }
    // 重新生成选项（v0.8.4）：显式传入优先，否则沿用已存偏好（刷新/重播同样生效）
    const genOpts = options ?? get().genOptions
    const provider = getProviders().briefing
    const deck = provider.getDeckAsync ? await provider.getDeckAsync(role, ctx, genOpts) : provider.getDeck(role, ctx, genOpts)
    let dataCards: BriefingCard[] = []
    let meta: SourceMeta | null = null
    try {
      dataCards = await buildDataCards(role)
      // 数据卡存在时以最新数据源 meta 为准；否则取数据源默认 meta（新鲜度标注）
      if (dataCards.length > 0) {
        meta = await getSourceProvider().getClassProfile().then((r) => r.meta).catch(() => null)
      } else {
        meta = await getSourceProvider().getRegionMetrics().then((r) => r.meta).catch(() => null)
      }
    } catch (err) {
      console.error('[briefing] data cards failed:', err)
    }
    // 数据卡插到最前；静态卡中同 id 去重（理论上不冲突，防御性处理）
    const dataIds = new Set(dataCards.map((c) => c.id))
    const payloads = get().payloads
    set({
      cards: [...dataCards, ...deck.filter((c) => !dataIds.has(c.id))].map((c) => applyPatch(c, payloads[c.id])),
      processed: 0,
      meta,
      loading: false,
    })
  },
  decide: (cardId, decision) => {
    const { cards, decisions, favorites } = get()
    const card = cards.find((c) => c.id === cardId)
    if (!card) return undefined
    const nextDecisions = { ...decisions, [cardId]: decision }
    const nextFavorites =
      decision === 'fav'
        ? [card, ...favorites.filter((f) => f.id !== cardId)]
        : favorites.filter((f) => f.id !== cardId)
    set({
      decisions: nextDecisions,
      favorites: nextFavorites,
      processed: get().processed + 1,
    })
    persist({ decisions: nextDecisions, favorites: nextFavorites, payloads: get().payloads, genOptions: get().genOptions })
    return card
  },
  selectOption: (cardId, index) => {
    const { cards, payloads } = get()
    const card = cards.find((c) => c.id === cardId)
    if (!card || card.payload?.kind !== 'options') return
    const nextPayloads: Record<string, PayloadPatch> = { ...payloads, [cardId]: { kind: 'options', selected: index } }
    set({
      payloads: nextPayloads,
      cards: cards.map((c) =>
        c.id === cardId && c.payload?.kind === 'options' ? { ...c, payload: { ...c.payload, selected: index } } : c,
      ),
    })
    persist({ decisions: get().decisions, favorites: get().favorites, payloads: nextPayloads, genOptions: get().genOptions })
  },
  toggleTodo: (cardId, index) => {
    const { cards, payloads } = get()
    const card = cards.find((c) => c.id === cardId)
    if (!card || card.payload?.kind !== 'todos') return
    const todos = card.payload.todos
    if (index < 0 || index >= todos.length) return
    const done = todos.map((t, i) => (i === index ? !(t.done ?? false) : t.done ?? false))
    const nextPayloads: Record<string, PayloadPatch> = { ...payloads, [cardId]: { kind: 'todos', done } }
    set({
      payloads: nextPayloads,
      cards: cards.map((c) =>
        c.id === cardId && c.payload?.kind === 'todos'
          ? { ...c, payload: { ...c.payload, todos: todos.map((t, i) => ({ ...t, done: done[i] })) } }
          : c,
      ),
    })
    persist({ decisions: get().decisions, favorites: get().favorites, payloads: nextPayloads, genOptions: get().genOptions })
  },
  editCardText: (cardId, text) => {
    const { cards, payloads } = get()
    const card = cards.find((c) => c.id === cardId)
    if (!card || card.payload?.kind !== 'editable') return
    const nextPayloads: Record<string, PayloadPatch> = { ...payloads, [cardId]: { kind: 'editable', text } }
    set({
      payloads: nextPayloads,
      cards: cards.map((c) =>
        c.id === cardId && c.payload?.kind === 'editable' ? { ...c, payload: { ...c.payload, text } } : c,
      ),
    })
    persist({ decisions: get().decisions, favorites: get().favorites, payloads: nextPayloads, genOptions: get().genOptions })
  },
  removeFavorite: (cardId) => {
    const next = get().favorites.filter((f) => f.id !== cardId)
    set({ favorites: next })
    persist({ decisions: get().decisions, favorites: next, payloads: get().payloads, genOptions: get().genOptions })
  },
  /** 撤回决策（v0.8.2）：卡片回到未批示状态，可修改内容后重新批阅 */
  revertDecision: (cardId) => {
    const { decisions, favorites, processed } = get()
    if (!decisions[cardId]) return
    const nextDecisions = { ...decisions }
    delete nextDecisions[cardId]
    const nextFavorites = favorites.filter((f) => f.id !== cardId)
    set({ decisions: nextDecisions, favorites: nextFavorites, processed: Math.max(0, processed - 1) })
    persist({ decisions: nextDecisions, favorites: nextFavorites, payloads: get().payloads, genOptions: get().genOptions })
  },
  /** 重置卡组与决策（收藏保留，交互覆盖层清空），配合 loadDeck 可重新过一遍简报 */
  resetDeck: () => {
    set({ cards: [], decisions: {}, processed: 0, payloads: {} })
    persist({ decisions: {}, favorites: get().favorites, payloads: {}, genOptions: get().genOptions })
  },
}))
