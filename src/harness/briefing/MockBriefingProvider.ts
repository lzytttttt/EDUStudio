import type { BriefingCard, BriefingProvider, RoleId } from '../types'
import { BRIEFING_DECKS } from '../scripts/briefing'

export class MockBriefingProvider implements BriefingProvider {
  /** 返回角色剧本的浅拷贝，避免调用方直接改动剧本 */
  getDeck(role: RoleId): BriefingCard[] {
    return (BRIEFING_DECKS[role] ?? []).map((c) => ({ ...c }))
  }
}
