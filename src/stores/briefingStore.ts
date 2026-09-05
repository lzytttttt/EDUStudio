import { create } from 'zustand'
import type { BriefingCard, RoleId } from '../harness/types'
import { getProviders } from '../harness/providerRegistry'
import { buildDataCards } from '../harness/sources/dataCards'
import { getSourceProvider, type SourceMeta } from '../harness/sources'
import { loadJSON, saveJSON } from '../lib/storage'

export type CardDecision = 'skip' | 'fav' | 'accept'

interface PersistedBriefing {
  decisions: Record<string, CardDecision>
  favorites: BriefingCard[]
}

interface BriefingState {
  cards: BriefingCard[]
  decisions: Record<string, CardDecision>
  favorites: BriefingCard[]
  /** 已处理计数（skip + accept） */
  processed: number
  /** 卡组加载中（异步取数期间展示骨架屏） */
  loading: boolean
  /** 本次卡组的数据元信息（来源 + 时间戳，v0.5 M1④ 新鲜度标注） */
  meta: SourceMeta | null
  /** 加载卡组：静态剧本 + 数据驱动卡（异步，v0.5 M1②） */
  loadDeck: (role: RoleId) => Promise<void>
  decide: (cardId: string, decision: CardDecision) => BriefingCard | undefined
  removeFavorite: (cardId: string) => void
  resetDeck: () => void
}

const persisted = loadJSON<PersistedBriefing>('briefing', { decisions: {}, favorites: [] })

export const useBriefingStore = create<BriefingState>((set, get) => ({
  cards: [],
  decisions: persisted.decisions,
  favorites: persisted.favorites,
  processed: 0,
  loading: false,
  meta: null,
  loadDeck: async (role) => {
    set({ loading: true })
    const deck = getProviders().briefing.getDeck(role)
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
    set({
      cards: [...dataCards, ...deck.filter((c) => !dataIds.has(c.id))],
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
    saveJSON('briefing', { decisions: nextDecisions, favorites: nextFavorites })
    return card
  },
  removeFavorite: (cardId) => {
    const next = get().favorites.filter((f) => f.id !== cardId)
    set({ favorites: next })
    saveJSON('briefing', { decisions: get().decisions, favorites: next })
  },
  /** 重置卡组与决策（收藏保留），配合 loadDeck 可重新过一遍简报 */
  resetDeck: () => {
    set({ cards: [], decisions: {}, processed: 0 })
    saveJSON('briefing', { decisions: {}, favorites: get().favorites })
  },
}))
