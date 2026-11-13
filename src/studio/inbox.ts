/**
 * v1.2 M0 · studio 融合运行时：派生收件箱（纯逻辑）
 *
 * 依据 doc/v1.2-roadmap.md §2.4 / §3.4 / §4.4：
 * - 收件箱是派生视图：来源 = mission gate / briefing accept / taskFlow 回执 / notice 通知；
 *   本模块不持有任务本体，只接收「来源 item + 覆盖态（done/snoozed）」并算出列表；
 * - `kind==='notice'` 或 `source==='notice'` 进只读 notices，其余进可决策 decisions；
 * - 审批门以 `gate.gateId` 去重，保证「同一件事不会两处各点一次」。
 *
 * 去重语义（固定下来，便于测试）：数组**靠前**的一条优先（先到优先），
 * 同 `id` 或同 `gate.gateId` 的后来者被丢弃；去重先于覆盖态过滤。
 */

import type { ApprovalGate } from './contracts'

/** 收件箱来源（roadmap §2.4 决策表的四类派生源；v1.2 M0） */
export type InboxSource = 'mission' | 'briefing' | 'taskFlow' | 'notice'

/** 一条派生收件箱条目：只放引用与展示字段，不放任务/文档本体 */
export interface InboxSourceItem {
  /** 收件箱内唯一 id（通常是「来源 + 业务 id」） */
  id: string
  source: InboxSource
  /** 指向事实源实体的 id（missionId / cardId / flowId / noticeId） */
  refId: string
  title: string
  body?: string
  /** 显式优先级：越大越靠前；缺省按 0 参与排序 */
  priority?: number
  /** 审批门（mission gate 或 Loom checkpoint 投影，统一 ApprovalGate） */
  gate?: ApprovalGate
  /** 产生时间戳（毫秒） */
  at: number
  /** 展示分类覆盖：'notice' = 只读通知；缺省按 source 判定 */
  kind?: 'decision' | 'notice'
  /** v1.2 M2：点开时跳转动作（如简报采纳回对应会话；缺省只做只读展示） */
  action?: { kind: 'chat'; sessionId: string }
}

/** 收件箱覆盖态：只存用户处理结果，不存任务本体（roadmap §2.4「决策」行） */
export interface InboxOverrides {
  [id: string]: { status: 'done' | 'snoozed'; resolvedAt?: number; snoozeUntil?: number }
}

export interface InboxResult {
  decisions: InboxSourceItem[]
  notices: InboxSourceItem[]
  /** 待决策数 = 派生后 decisions 长度（角标唯一口径，不硬编码） */
  unreadDecisions: number
}

/** 是否只读通知（notice 只读、不可决策；v1.2 M0） */
function isNotice(item: InboxSourceItem): boolean {
  return item.kind === 'notice' || item.source === 'notice'
}

/**
 * 判断覆盖态是否过滤掉该条目：
 * done 永不出现；snoozed 且时间窗未到（snoozeUntil > now）不出现；到期/无时间窗则回归。
 */
function isHiddenByOverride(
  override: InboxOverrides[string] | undefined,
  now: number,
): boolean {
  if (!override) return false
  if (override.status === 'done') return true
  if (override.status === 'snoozed') {
    const until = override.snoozeUntil
    return typeof until === 'number' && until > now
  }
  return false
}

/**
 * 决策排序（roadmap §2.4 / 任务说明固定口径）：
 * ① 显式 priority 降序（缺省 0）→ ② 带审批门优先 → ③ at 降序 → ④ id 升序（稳定兜底）。
 */
function compareDecisions(a: InboxSourceItem, b: InboxSourceItem): number {
  const priorityA = a.priority ?? 0
  const priorityB = b.priority ?? 0
  if (priorityA !== priorityB) return priorityB - priorityA
  const gateA = a.gate ? 1 : 0
  const gateB = b.gate ? 1 : 0
  if (gateA !== gateB) return gateB - gateA
  if (a.at !== b.at) return b.at - a.at
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

/**
 * 派生收件箱（纯函数，不改入参；v1.2 M0）。
 * @param sources 来源条目（顺序即去重优先级：靠前优先）
 * @param overrides 覆盖态（done/snoozed）
 * @param now 当前时间戳（毫秒，用于 snooze 时间窗判定）
 */
export function deriveInbox(
  sources: InboxSourceItem[],
  overrides: InboxOverrides,
  now: number,
): InboxResult {
  const seenIds = new Set<string>()
  const seenGateIds = new Set<string>()
  const decisions: InboxSourceItem[] = []
  const notices: InboxSourceItem[] = []

  for (const item of sources) {
    // ① 去重（先到优先）：同 id 或同 gateId 的后来者丢弃
    if (seenIds.has(item.id)) continue
    const gateId = item.gate?.gateId
    if (gateId !== undefined) {
      if (seenGateIds.has(gateId)) continue
      seenGateIds.add(gateId)
    }
    seenIds.add(item.id)

    // ② 覆盖态过滤（done / snoozed 时间窗）
    if (isHiddenByOverride(overrides[item.id], now)) continue

    // ③ 拆分为 decisions / notices
    if (isNotice(item)) notices.push(item)
    else decisions.push(item)
  }

  decisions.sort(compareDecisions)
  return { decisions, notices, unreadDecisions: decisions.length }
}

/** 待决策数（收件箱角标唯一口径；v1.2 M0） */
export function countPending(
  sources: InboxSourceItem[],
  overrides: InboxOverrides,
  now: number,
): number {
  return deriveInbox(sources, overrides, now).unreadDecisions
}
