import type { BriefingCard, BriefingGenContext, BriefingProvider, RoleId } from '../types'
import { BRIEFING_DECKS } from '../scripts/briefing'

/** 个性化排序档位：0=收藏 tag 关联（前置） 1=默认 2=跳过 ≥2 次 tag（沉底） */
const RANK_FAV = 0
const RANK_DEFAULT = 1
const RANK_SKIPPED = 2
const SKIP_SINK_THRESHOLD = 2

/**
 * 个性化稳定排序（v0.7）：
 *  - 收藏过的 tag 关联卡前置（用户兴趣信号）；
 *  - 被跳过 ≥2 次的 tag 沉底（避免重复打扰）；
 *  - 同档位按原索引排序，保证顺序稳定、重载不闪烁。
 */
export function personalize(deck: BriefingCard[], ctx: BriefingGenContext): BriefingCard[] {
  const skipCount = new Map<string, number>()
  for (const card of deck) {
    if (ctx.decisions[card.id] === 'skip') {
      skipCount.set(card.tag, (skipCount.get(card.tag) ?? 0) + 1)
    }
  }
  const favTags = new Set(ctx.favorites.map((f) => f.tag))
  return deck
    .map((card, index) => {
      const skips = skipCount.get(card.tag) ?? 0
      const rank = skips >= SKIP_SINK_THRESHOLD ? RANK_SKIPPED : favTags.has(card.tag) ? RANK_FAV : RANK_DEFAULT
      return { card, index, rank }
    })
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((x) => x.card)
}

export class MockBriefingProvider implements BriefingProvider {
  /** 返回角色剧本的浅拷贝，避免调用方直接改动剧本；ctx 存在时做个性化排序 */
  getDeck(role: RoleId, ctx?: BriefingGenContext): BriefingCard[] {
    const deck = (BRIEFING_DECKS[role] ?? []).map((c) => ({ ...c }))
    return ctx ? personalize(deck, ctx) : deck
  }
}
