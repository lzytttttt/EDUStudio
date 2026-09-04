import { create } from 'zustand'
import type { BriefingCard, RoleId } from '../harness/types'
import { getProviders } from '../harness/providerRegistry'
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
  loadDeck: (role: RoleId) => void
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
  loadDeck: (role) => {
    const deck = getProviders().briefing.getDeck(role)
    set({ cards: deck, processed: 0 })
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
