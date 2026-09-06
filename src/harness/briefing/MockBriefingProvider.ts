import type { BriefingCard, BriefingGenContext, BriefingGenOptions, BriefingProvider, RoleId } from '../types'
import { BRIEFING_DECKS, DECK_GROUP_COUNT } from '../scripts/briefing'

/** 个性化排序档位：0=收藏 tag 关联（前置） 0.5=L3 语义偏好 tag（v0.9.1 注入 B） 1=默认 2=跳过 ≥2 次 tag（沉底） */
const RANK_FAV = 0
const RANK_PREF = 0.5
const RANK_DEFAULT = 1
const RANK_SKIPPED = 2
const SKIP_SINK_THRESHOLD = 2

/**
 * 个性化稳定排序（v0.7）：
 *  - 收藏过的 tag 关联卡前置（用户兴趣信号）；
 *  - 被跳过 ≥2 次的 tag 沉底（避免重复打扰）；
 *  - 同档位按原索引排序，保证顺序稳定、重载不闪烁。
 * v0.9.1 注入 B：L3 语义偏好 tag 次优先前置（收藏 tag 之后、默认档之前）。
 */
export function personalize(deck: BriefingCard[], ctx: BriefingGenContext): BriefingCard[] {
  const skipCount = new Map<string, number>()
  for (const card of deck) {
    if (ctx.decisions[card.id] === 'skip') {
      skipCount.set(card.tag, (skipCount.get(card.tag) ?? 0) + 1)
    }
  }
  const favTags = new Set(ctx.favorites.map((f) => f.tag))
  // v0.9.1 注入 B：L3 语义偏好标签（key 形如 `${role}.pref.card.tag.${tag}`）→ 次优先前置（收藏 > 偏好 > 默认）
  const prefTags = new Set(
    (ctx.prefs ?? [])
      .map((e) => e.key?.match(/\.pref\.card\.tag\.(.+)$/)?.[1])
      .filter((t): t is string => Boolean(t)),
  )
  return deck
    .map((card, index) => {
      const skips = skipCount.get(card.tag) ?? 0
      const rank =
        skips >= SKIP_SINK_THRESHOLD
          ? RANK_SKIPPED
          : favTags.has(card.tag)
            ? RANK_FAV
            : prefTags.has(card.tag)
              ? RANK_PREF
              : RANK_DEFAULT
      return { card, index, rank }
    })
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((x) => x.card)
}

/** 周粒度派生（v0.9 M6④）：dayIndex = floor(now / 86400000 / 7) → 组号（导出供单测） */
export function deckGroupIndex(now: number): number {
  return Math.floor(now / 86_400_000 / 7) % DECK_GROUP_COUNT
}

/** 组内确定性轮换：保持 8 张结构与六类占比，仅顺序变化（第 0 组不动 = 默认体验与回归基线不变） */
export function rotateDeck(deck: BriefingCard[], group: number): BriefingCard[] {
  const shift = deck.length ? (group * 3) % deck.length : 0
  return [...deck.slice(shift), ...deck.slice(0, shift)]
}

export class MockBriefingProvider implements BriefingProvider {
  /**
   * 返回角色剧本的浅拷贝，避免调用方直接改动剧本；ctx 存在时做个性化排序。
   * v0.8.4：options.types 非空时按种类过滤静态剧本（空选/全选 = 不过滤，个性化排序保持不变）。
   * v0.9 M6④：按 ctx.now（缺省 Date.now()）周粒度派生内容池分组，周更换序保持新鲜感。
   */
  getDeck(role: RoleId, ctx?: BriefingGenContext, options?: BriefingGenOptions): BriefingCard[] {
    let deck = (BRIEFING_DECKS[role] ?? []).map((c) => ({ ...c }))
    const group = deckGroupIndex(ctx?.now ?? Date.now())
    if (group > 0) deck = rotateDeck(deck, group)
    const types = options?.types
    if (types && types.length > 0) deck = deck.filter((c) => types.includes(c.type))
    return ctx ? personalize(deck, ctx) : deck
  }
}
