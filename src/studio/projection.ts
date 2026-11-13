/**
 * v1.2 M0 · StudioDigest 只读投影（主 chunk，≤1KB）
 *
 * 依据 doc/v1.2-roadmap.md §2.4 / §3.1 规则 3 / §3.4：
 * - 只存计数与一行摘要（不存实体/正文），由 StudioBus 事件驱动更新，供侧栏角标/顶栏收件箱/右栏只读摘要消费；
 * - 事件目录：mission.planned / mission.started / mission.task.done / mission.partial /
 *   mission.delivered / gate.waiting / gate.resolved / artifact.published / notice.push；
 * - 幂等：同一 gateId 的重复 waiting 不重复计数，resolved 只对已计入的门递减且永不为负；
 * - 不可变：每次返回新对象；未知事件内容原样返回（新对象，方便调用方统一替换引用）。
 *
 * 派生账本（plan 任务总数 / 已完成数 / 在办 gateId 集合）用 WeakMap 挂在 digest 对象上：
 * - 不写进 digest（类型只有计数与摘要，且 ≤1KB、不持久化实体），也不进入序列化；
 * - 沿 applyStudioDigest 的返回链自动传递；若从持久化 JSON 重建 digest 后继续接事件，
 *   则退化为「不重复计数只做 best-effort」（resolved 不清未知门，任务进度保持不变）。
 */

import type { StudioDigest, StudioEvent } from './contracts'

/** 投影体积上限（roadmap §3.1 规则 3：≤1KB） */
const DIGEST_BUDGET_BYTES = 1024
/** 摘要标题单行上限（一次只显示一行） */
const ONE_LINE_MAX_CHARS = 40

/** 剧本 kind → 一行摘要（避免把 MissionKind 英文直接展示给教师） */
const MISSION_TITLE: Record<string, string> = {
  parent_meeting: '家长会筹备',
  exam_loop: '单元考学情闭环',
}

/** 派生账本：不进入 digest 本身，仅随 apply 调用链传递（M0 瞬态，不持久化） */
interface MissionTally {
  id: string
  plannedTasks: number
  completedTasks: number
}
interface DigestLedger {
  /** 已计入 pendingDecisions 的 gateId（去重 / resolved 幂等） */
  pendingGateIds: Set<string>
  /** 当前 mission 的任务数账本（runningTasks / progress 由此推导） */
  mission: MissionTally | null
}

const ledgers = new WeakMap<StudioDigest, DigestLedger>()

/** 取 digest 的派生账本；外部重建的 digest（如持久化恢复）给空账本 */
function ledgerOf(digest: StudioDigest): DigestLedger {
  const existing = ledgers.get(digest)
  if (existing) return existing
  const created: DigestLedger = { pendingGateIds: new Set<string>(), mission: null }
  ledgers.set(digest, created)
  return created
}

/** 记录返回值对应的派生账本（同一账本对象只读复用，绝不原地修改） */
function withLedger(digest: StudioDigest, ledger: DigestLedger): StudioDigest {
  ledgers.set(digest, ledger)
  return digest
}

/**
 * v1.2 M2：不可变更新（如再叠加 unreadNotices/team 字段）后，把 from 的派生账本继承给 to。
 * 否则 gate.waiting 的 gateId 去重与 mission 进度账本会在「再包一层新对象」后丢失，
 * 导致同一审批门重复计数。返回 to（便于链式）。
 */
export function inheritDigestLedger(from: StudioDigest, to: StudioDigest): StudioDigest {
  const ledger = ledgers.get(from)
  if (ledger) ledgers.set(to, ledger)
  return to
}

/** 压成一行（摘要只允许一行，超长截断） */
function oneLine(text: string, fallback: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const safe = normalized.length > 0 ? normalized : fallback
  return safe.length > ONE_LINE_MAX_CHARS ? safe.slice(0, ONE_LINE_MAX_CHARS) : safe
}

function missionTitle(kind: string): string {
  return MISSION_TITLE[kind] ?? '在办任务'
}

/** UTF-8 字节数（不依赖 TextEncoder，SSR/测试/主 chunk 均可跑） */
function utf8ByteLength(text: string): number {
  let bytes = 0
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0
    if (codePoint <= 0x7f) bytes += 1
    else if (codePoint <= 0x7ff) bytes += 2
    else if (codePoint <= 0xffff) bytes += 3
    else bytes += 4
  }
  return bytes
}

/** 空投影：全 0、无在办 mission、updatedAt=0（尚未有事件） */
export function emptyDigest(): StudioDigest {
  const digest: StudioDigest = {
    pendingDecisions: 0,
    runningMissions: 0,
    runningTasks: 0,
    unreadDocs: 0,
    updatedAt: 0,
  }
  ledgers.set(digest, { pendingGateIds: new Set<string>(), mission: null })
  return digest
}

/**
 * 应用一个 StudioEvent，返回新 digest（不可变；v1.2 M0）。
 * 未知/不关心的事件：内容原样返回新对象（不可变语义，便于调用方统一 set）。
 */
export function applyStudioDigest(digest: StudioDigest, event: StudioEvent): StudioDigest {
  switch (event.type) {
    case 'mission.planned': {
      // 计划落定：runningMissions+1、activeMission 一行摘要；pending 不硬编码（只由 gate.* 驱动）
      const plannedTasks = Math.max(0, Math.floor(event.tasks))
      const ledger: DigestLedger = {
        pendingGateIds: new Set(ledgerOf(digest).pendingGateIds),
        mission: { id: event.missionId, plannedTasks, completedTasks: 0 },
      }
      return withLedger(
        {
          ...digest,
          runningMissions: digest.runningMissions + 1,
          runningTasks: plannedTasks,
          activeMission: {
            id: event.missionId,
            title: oneLine(missionTitle(event.kind), '在办任务'),
            progress: 0,
            status: 'planning',
          },
          updatedAt: digest.updatedAt + 1,
        },
        ledger,
      )
    }

    case 'mission.started': {
      // 开始执行：已有摘要标 running；没有 planned 也补一条（事件乱序兜底）
      const active = digest.activeMission
      const activeMission =
        active && active.id === event.missionId
          ? { ...active, status: 'running' as const }
          : { id: event.missionId, title: '在办任务', progress: 0, status: 'running' as const }
      return withLedger(
        {
          ...digest,
          runningMissions: Math.max(1, digest.runningMissions),
          activeMission,
          updatedAt: digest.updatedAt + 1,
        },
        ledgerOf(digest),
      )
    }

    case 'mission.task.done': {
      // runningTasks = 计划数 - 完成数；progress = 完成比（0–100 整数）
      const ledger = ledgerOf(digest)
      const mission =
        ledger.mission && ledger.mission.id === event.missionId
          ? { ...ledger.mission, completedTasks: ledger.mission.completedTasks + 1 }
          : ledger.mission
      const total = mission?.plannedTasks ?? 0
      const completed = mission?.completedTasks ?? 0
      const runningTasks = mission ? Math.max(0, total - completed) : Math.max(0, digest.runningTasks - 1)
      const progress =
        mission && total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : digest.activeMission?.progress ?? 0
      const active = digest.activeMission
      const activeMission =
        active && active.id === event.missionId ? { ...active, progress, status: 'running' as const } : active
      return withLedger(
        {
          ...digest,
          runningTasks,
          activeMission,
          updatedAt: digest.updatedAt + 1,
        },
        { ...ledger, mission },
      )
    }

    case 'mission.partial': {
      // 部分完成：本轮不再有在办任务，mission 未交付仍在办（等人工收尾）
      return withLedger(
        {
          ...digest,
          runningTasks: 0,
          updatedAt: digest.updatedAt + 1,
        },
        ledgerOf(digest),
      )
    }

    case 'mission.delivered': {
      // 交付：runningMissions 归 0，activeMission 清空（只读摘要不再展示在办）
      const ledger = ledgerOf(digest)
      return withLedger(
        {
          ...digest,
          runningMissions: 0,
          runningTasks: 0,
          activeMission: undefined,
          updatedAt: digest.updatedAt + 1,
        },
        { pendingGateIds: new Set(ledger.pendingGateIds), mission: null },
      )
    }

    case 'gate.waiting': {
      // 同一 gateId 重复 waiting 幂等：不重复计数（§3.4 总线纪律：handler 必须幂等）
      const ledger = ledgerOf(digest)
      const gateId = event.gate.gateId
      if (ledger.pendingGateIds.has(gateId)) {
        return withLedger({ ...digest }, ledger)
      }
      const pendingGateIds = new Set(ledger.pendingGateIds)
      pendingGateIds.add(gateId)
      return withLedger(
        {
          ...digest,
          pendingDecisions: digest.pendingDecisions + 1,
          updatedAt: digest.updatedAt + 1,
        },
        { ...ledger, pendingGateIds },
      )
    }

    case 'gate.resolved': {
      // 只对已计入的门递减；未知门/重复解决不重复递减，且永不为负
      const ledger = ledgerOf(digest)
      if (!ledger.pendingGateIds.has(event.gateId)) {
        return withLedger({ ...digest }, ledger)
      }
      const pendingGateIds = new Set(ledger.pendingGateIds)
      pendingGateIds.delete(event.gateId)
      return withLedger(
        {
          ...digest,
          pendingDecisions: Math.max(0, digest.pendingDecisions - 1),
          updatedAt: digest.updatedAt + 1,
        },
        { ...ledger, pendingGateIds },
      )
    }

    case 'artifact.published': {
      // 交付物出现即未读 +1（文档面板未读点口径）
      return withLedger(
        {
          ...digest,
          unreadDocs: digest.unreadDocs + 1,
          updatedAt: digest.updatedAt + 1,
        },
        ledgerOf(digest),
      )
    }

    case 'notice.push': {
      // notice 只读：不进 pendingDecisions（决策与通知不双计数），只推进事件时间
      return withLedger(
        {
          ...digest,
          updatedAt: digest.updatedAt + 1,
        },
        ledgerOf(digest),
      )
    }

    default:
      // 未知/暂不消费的事件：内容原样、返回新对象（不可变），保留派生账本
      return withLedger({ ...digest }, ledgerOf(digest))
  }
}

/** 规范序列化：固定键序，便于体积断言与持久化（activeMission 缺省时不写键） */
export function serializeDigest(digest: StudioDigest): string {
  const active = digest.activeMission
  if (active) {
    return JSON.stringify({
      pendingDecisions: digest.pendingDecisions,
      runningMissions: digest.runningMissions,
      runningTasks: digest.runningTasks,
      unreadDocs: digest.unreadDocs,
      activeMission: {
        id: active.id,
        title: active.title,
        progress: active.progress,
        status: active.status,
      },
      updatedAt: digest.updatedAt,
    })
  }
  return JSON.stringify({
    pendingDecisions: digest.pendingDecisions,
    runningMissions: digest.runningMissions,
    runningTasks: digest.runningTasks,
    unreadDocs: digest.unreadDocs,
    updatedAt: digest.updatedAt,
  })
}

/** 投影体积（UTF-8 字节，按规范序列化计算） */
export function digestSize(digest: StudioDigest): number {
  return utf8ByteLength(serializeDigest(digest))
}

/** 是否在预算内（默认 1KB；roadmap §3.1 规则 3） */
export function isDigestWithinBudget(digest: StudioDigest, maxBytes: number = DIGEST_BUDGET_BYTES): boolean {
  return digestSize(digest) <= maxBytes
}
