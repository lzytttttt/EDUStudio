/**
 * Director 状态持久化（v1.1 M2，roadmap §5 / 研究 01 §4）
 *
 * 契约：`edustudio:director`（schemaVersion 1，PersistedDirectorV1）
 * - 只落「持久化切片」：decisions / stats / mission / missionCursor / planSource /
 *   autonomy / guideSeen / facts；toasts、screen、artifactId、guideActive/guideStep、
 *   planLoading、定时器、滚动位置一律排除（派生/瞬态）；
 * - 写盘走 `createDebouncedWriter`（300ms）+ 切片签名比对（瞬态字段变化不触发写盘，
 *   照抄 loomStore 的 writer 范式）；关键节点由 store 调 `writeDirectorPersist` 立即落盘；
 * - 恢复矩阵：planning 原样 / running→paused / waiting 原样 / done 原样 / 损坏回初始；
 * - guideSeen 由 v1.0 的裸 localStorage 旧键合并进 v1 payload 后删除旧键；
 * - 任何坏数据都回初始态，**绝不抛**（loadJSON 已 catch 坏 JSON，本层再兜类型校验）。
 */
import { createDebouncedWriter } from '../lib/debouncedWrite'
import { loadJSON, saveJSON } from '../lib/storage'
import type {
  AutonomyLevel,
  DecisionItem,
  DecisionKind,
  DirectorAgentId,
  DirectorStats,
  Fact,
  FactUnit,
  FeedItem,
  GateId,
  MissionKind,
  MissionPlanTask,
  MissionState,
  MissionStatus,
  PersistedDirectorV1,
  PlanSource,
} from '../harness/director/types'

/** storage 键（不含 `edustudio:` 前缀） */
export const DIRECTOR_PERSIST_KEY = 'director'
export const DIRECTOR_SCHEMA_VERSION = 1 as const
/** 写盘上限：decisions ≤12、feed ≤30、facts ≤12（roadmap §5.1） */
export const DIRECTOR_DECISIONS_MAX = 12
export const DIRECTOR_FEED_MAX = 30
export const DIRECTOR_FACTS_MAX = 12
/** 单键体积上限（实测目标 <10KB） */
export const DIRECTOR_PERSIST_MAX_BYTES = 30 * 1024
/** v1.0 旧引导已读键（裸 localStorage，独立键；v1.1 合并后删除） */
export const DIRECTOR_LEGACY_GUIDE_KEY = 'edustudio:director-guide'

const AGENT_IDS: readonly DirectorAgentId[] = ['chief', 'analyst', 'assessor', 'curriculum', 'communicator', 'steward']
const AUTONOMY_LEVELS: readonly AutonomyLevel[] = ['L0', 'L1', 'L2', 'L3']
const MISSION_KINDS: readonly MissionKind[] = ['parent_meeting', 'exam_loop']
const MISSION_STATUSES: readonly MissionStatus[] = ['idle', 'planning', 'running', 'paused', 'waiting', 'done']
const GATE_IDS: readonly GateId[] = ['speech', 'letters', 'worksheet', 'lesson']
const PLAN_SOURCES: readonly PlanSource[] = ['template', 'llm']
const DECISION_KINDS: readonly DecisionKind[] = ['prepared', 'approve', 'conflict']
const DECISION_STATUSES: readonly DecisionItem['status'][] = ['new', 'done', 'snoozed']
const FEED_KINDS: readonly FeedItem['kind'][] = ['step', 'gate', 'system']
const FACT_UNITS: readonly FactUnit[] = ['分', '%', '百分点', '人', '题', '分钟']

/* ------------------------------------------------------------------ */
/* 基础工具（纯函数，坏数据一律回退，不抛）                              */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** JSON 数据克隆：切断与模板常量的引用，避免恢复态反向污染 data.ts */
function cloneJSON<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function asFinite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asNonNegative(value: unknown, fallback: number): number {
  const n = asFinite(value, fallback)
  return n >= 0 ? n : fallback
}

function asClampedProgress(value: unknown, fallback: number): number {
  const n = asFinite(value, fallback)
  return n < 0 ? 0 : n > 100 ? 100 : n
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asAgentId(value: unknown, fallback: DirectorAgentId = 'chief'): DirectorAgentId {
  return AGENT_IDS.includes(value as DirectorAgentId) ? (value as DirectorAgentId) : fallback
}

function asGateId(value: unknown): GateId | null {
  return GATE_IDS.includes(value as GateId) ? (value as GateId) : null
}

function asMissionKind(value: unknown, fallback: MissionKind = 'parent_meeting'): MissionKind {
  return MISSION_KINDS.includes(value as MissionKind) ? (value as MissionKind) : fallback
}

/* ------------------------------------------------------------------ */
/* store → 持久化切片                                                   */
/* ------------------------------------------------------------------ */

/** store 中参与持久化的字段（screen / toasts / artifactId / guide 状态 / planLoading 不在其中） */
export interface DirectorPersistSource {
  decisions: DecisionItem[]
  stats: DirectorStats
  mission: MissionState
  missionCursor: number
  planSource: PlanSource
  autonomy: Record<DirectorAgentId, AutonomyLevel>
  facts: Fact[]
}

/**
 * 组装 v1 载荷（纯函数）：
 * - guideSeen 不在 DirectorState 里（历史原因），由 store 侧模块变量传入；
 * - 写盘前按契约截断 decisions ≤12 / feed ≤30 / facts ≤12；
 * - updatedAt 由调度层在真正写盘时盖章（这里先记 now，便于直接调用/断言）。
 */
export function toPersistedDirector(
  source: DirectorPersistSource,
  guideSeen: boolean,
  now = Date.now(),
): PersistedDirectorV1 {
  const mission: MissionState = {
    ...source.mission,
    kind: asMissionKind(source.mission?.kind),
    planSource: PLAN_SOURCES.includes(source.planSource) ? source.planSource : 'template',
    feed: (Array.isArray(source.mission?.feed) ? source.mission.feed : []).slice(-DIRECTOR_FEED_MAX),
    plan: Array.isArray(source.mission?.plan) ? source.mission.plan : [],
    doneTasks: Array.isArray(source.mission?.doneTasks) ? source.mission.doneTasks : [],
  }
  return {
    schemaVersion: DIRECTOR_SCHEMA_VERSION,
    updatedAt: now,
    decisions: (Array.isArray(source.decisions) ? source.decisions : []).slice(0, DIRECTOR_DECISIONS_MAX),
    stats: { ...source.stats },
    mission,
    missionKind: mission.kind,
    missionCursor: asNonNegative(source.missionCursor, 0),
    planSource: PLAN_SOURCES.includes(source.planSource) ? source.planSource : 'template',
    autonomy: { ...source.autonomy },
    guideSeen,
    facts: (Array.isArray(source.facts) ? source.facts : []).slice(0, DIRECTOR_FACTS_MAX),
  }
}

/* ------------------------------------------------------------------ */
/* 校验 / 迁移（load 与单测共用；坏数据回 initial，绝不抛）              */
/* ------------------------------------------------------------------ */

function sanitizeFeed(raw: unknown): FeedItem[] {
  if (!Array.isArray(raw)) return []
  const items: FeedItem[] = []
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.text !== 'string') continue
    items.push({
      id: item.id,
      agentId: asAgentId(item.agentId),
      text: item.text,
      at: asFinite(item.at, 0),
      kind: FEED_KINDS.includes(item.kind as FeedItem['kind']) ? (item.kind as FeedItem['kind']) : 'step',
    })
  }
  return items.slice(-DIRECTOR_FEED_MAX)
}

function sanitizePlan(raw: unknown, fallback: MissionPlanTask[]): MissionPlanTask[] {
  if (!Array.isArray(raw)) return cloneJSON(fallback)
  const tasks: MissionPlanTask[] = []
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id) continue
    if (typeof item.title !== 'string') continue
    const gate = asGateId(item.gate)
    const task: MissionPlanTask = {
      id: item.id,
      agentId: asAgentId(item.agentId),
      title: item.title,
      seconds: asNonNegative(item.seconds, 60),
    }
    if (Array.isArray(item.deps)) {
      task.deps = item.deps.filter((dep): dep is string => typeof dep === 'string')
    }
    if (gate) task.gate = gate
    tasks.push(task)
  }
  return tasks.length > 0 ? tasks : cloneJSON(fallback)
}

function sanitizeMission(raw: unknown, fallback: MissionState): MissionState {
  if (!isRecord(raw)) return cloneJSON(fallback)
  const planSource = PLAN_SOURCES.includes(raw.planSource as PlanSource)
    ? (raw.planSource as PlanSource)
    : fallback.planSource
  const gate = asGateId(raw.gate)
  const mission: MissionState = {
    status: MISSION_STATUSES.includes(raw.status as MissionStatus)
      ? (raw.status as MissionStatus)
      : fallback.status,
    kind: asMissionKind(raw.kind, fallback.kind),
    title: asString(raw.title, fallback.title) || fallback.title,
    progress: asClampedProgress(raw.progress, fallback.progress),
    feed: Array.isArray(raw.feed) ? sanitizeFeed(raw.feed) : cloneJSON(fallback.feed),
    plan: sanitizePlan(raw.plan, fallback.plan),
    doneTasks: Array.isArray(raw.doneTasks)
      ? raw.doneTasks.filter((id): id is string => typeof id === 'string')
      : [],
    gate,
    planSource,
  }
  if (typeof raw.planReason === 'string' && raw.planReason) mission.planReason = raw.planReason
  if (typeof raw.startedAt === 'number' && Number.isFinite(raw.startedAt)) mission.startedAt = raw.startedAt
  if (typeof raw.finishedAt === 'number' && Number.isFinite(raw.finishedAt)) mission.finishedAt = raw.finishedAt
  return mission
}

function sanitizeStats(raw: unknown, fallback: DirectorStats): DirectorStats {
  if (!isRecord(raw)) return { ...fallback }
  return {
    pending: asNonNegative(raw.pending, fallback.pending),
    running: asNonNegative(raw.running, fallback.running),
    hosted: asNonNegative(raw.hosted, fallback.hosted),
    savedHours: Math.round(asNonNegative(raw.savedHours, fallback.savedHours) * 10) / 10,
  }
}

function sanitizePreview(raw: unknown): DecisionItem['preview'] {
  if (!isRecord(raw)) return { rows: [] }
  const rows = Array.isArray(raw.rows)
    ? raw.rows
        .filter((row): row is Record<string, unknown> => isRecord(row))
        .map((row) => ({ label: asString(row.label, ''), value: asString(row.value, '') }))
        .filter((row) => row.label !== '' || row.value !== '')
    : []
  const preview: DecisionItem['preview'] = { rows }
  if (typeof raw.note === 'string' && raw.note) preview.note = raw.note
  return preview
}

function sanitizeDecisions(raw: unknown, fallback: DecisionItem[]): DecisionItem[] {
  if (!Array.isArray(raw)) return cloneJSON(fallback)
  const decisions: DecisionItem[] = []
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id) continue
    if (typeof item.title !== 'string') continue
    const decision: DecisionItem = {
      id: item.id,
      agentId: asAgentId(item.agentId),
      kind: DECISION_KINDS.includes(item.kind as DecisionKind) ? (item.kind as DecisionKind) : 'prepared',
      title: item.title,
      subtitle: asString(item.subtitle, ''),
      readiness: asClampedProgress(item.readiness, 100),
      minutes: asNonNegative(item.minutes, 1),
      tag: asString(item.tag, ''),
      primaryLabel: asString(item.primaryLabel, '采纳'),
      preview: sanitizePreview(item.preview),
      status: DECISION_STATUSES.includes(item.status as DecisionItem['status'])
        ? (item.status as DecisionItem['status'])
        : 'new',
    }
    if (isRecord(item.conflict) && typeof item.conflict.question === 'string') {
      const options = Array.isArray(item.conflict.options)
        ? item.conflict.options
            .filter((opt): opt is Record<string, unknown> => isRecord(opt))
            .filter((opt) => typeof opt.id === 'string' && typeof opt.label === 'string')
            .map((opt) => ({
              id: opt.id as string,
              label: opt.label as string,
              detail: asString(opt.detail, ''),
            }))
        : []
      if (options.length > 0) decision.conflict = { question: item.conflict.question, options }
    }
    decisions.push(decision)
  }
  if (decisions.length === 0) return cloneJSON(fallback)
  return decisions.slice(0, DIRECTOR_DECISIONS_MAX)
}

function sanitizeAutonomy(
  raw: unknown,
  fallback: Record<DirectorAgentId, AutonomyLevel>,
): Record<DirectorAgentId, AutonomyLevel> {
  const result = { ...fallback }
  if (!isRecord(raw)) return result
  for (const agentId of AGENT_IDS) {
    const level = raw[agentId]
    if (AUTONOMY_LEVELS.includes(level as AutonomyLevel)) result[agentId] = level as AutonomyLevel
  }
  return result
}

function sanitizeFacts(raw: unknown): Fact[] {
  if (!Array.isArray(raw)) return []
  const facts: Fact[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    if (typeof item.factId !== 'string' || typeof item.key !== 'string') continue
    if (typeof item.value !== 'number' || !Number.isFinite(item.value)) continue
    if (!FACT_UNITS.includes(item.unit as FactUnit)) continue
    const fact: Fact = {
      factId: item.factId,
      key: item.key,
      value: item.value,
      unit: item.unit as FactUnit,
      label: asString(item.label, item.key),
      source: asString(item.source, ''),
      asOf: asString(item.asOf, ''),
    }
    if (item.derived === true) fact.derived = true
    facts.push(fact)
  }
  return facts.slice(0, DIRECTOR_FACTS_MAX)
}

/** 初始载荷（store 首次启动 / 坏数据回退的唯一基线） */
export function emptyDirectorPersisted(initial: PersistedDirectorV1): PersistedDirectorV1 {
  return cloneJSON(initial)
}

/**
 * v1 迁移 / 校验：非对象或版本≠1 → initial；字段类型校验补默认；
 * `running → paused`（纯前端无后台，刷新后如实标「已暂停」）；feed/decisions 截断；
 * kind/planSource/plan 非法回落模板。**绝不抛**。
 */
export function migrateDirectorPersisted(raw: unknown, initial: PersistedDirectorV1): PersistedDirectorV1 {
  if (!isRecord(raw) || raw.schemaVersion !== DIRECTOR_SCHEMA_VERSION) {
    return emptyDirectorPersisted(initial)
  }
  const baseMission = sanitizeMission(raw.mission, initial.mission)
  // 恢复语义：running 一律降级为 paused，等教师点「继续」从 missionCursor 续跑
  if (baseMission.status === 'running') baseMission.status = 'paused'
  const missionKind = MISSION_KINDS.includes(raw.missionKind as MissionKind)
    ? (raw.missionKind as MissionKind)
    : baseMission.kind
  baseMission.kind = missionKind
  const planSource = PLAN_SOURCES.includes(raw.planSource as PlanSource)
    ? (raw.planSource as PlanSource)
    : baseMission.planSource
  baseMission.planSource = planSource
  return {
    schemaVersion: DIRECTOR_SCHEMA_VERSION,
    updatedAt: asFinite(raw.updatedAt, Date.now()),
    decisions: sanitizeDecisions(raw.decisions, initial.decisions),
    stats: sanitizeStats(raw.stats, initial.stats),
    mission: baseMission,
    missionKind,
    missionCursor: Math.floor(asNonNegative(raw.missionCursor, 0)),
    planSource,
    autonomy: sanitizeAutonomy(raw.autonomy, initial.autonomy),
    guideSeen: asBoolean(raw.guideSeen, initial.guideSeen),
    facts: sanitizeFacts(raw.facts),
  }
}

/* ------------------------------------------------------------------ */
/* 旧引导已读键（v1.0 用裸 localStorage，绕过 storage 抽象）              */
/* ------------------------------------------------------------------ */

export function readLegacyDirectorGuideSeen(): boolean {
  try {
    return window.localStorage.getItem(DIRECTOR_LEGACY_GUIDE_KEY) === '1'
  } catch {
    return false
  }
}

function removeLegacyDirectorGuideSeen(): void {
  try {
    window.localStorage.removeItem(DIRECTOR_LEGACY_GUIDE_KEY)
  } catch {
    /* 隐私模式忽略 */
  }
}

/* ------------------------------------------------------------------ */
/* load / 写盘（writer 范式照抄 loomStore.ts:51-83）                     */
/* ------------------------------------------------------------------ */

export interface DirectorLoadResult {
  value: PersistedDirectorV1
  /** 有可用持久化数据（首访为 false：开场仍回战情台，不走「刷新恢复」落点） */
  hasPersisted: boolean
  /** 有过持久化数据但损坏/版本未知（回初始；UI 可给非打断提示） */
  recovered: boolean
}

/**
 * 读取并迁移：
 * - 旧 `edustudio:director-guide` 合并进 v1 payload（OR）后删除旧键；
 * - 发生过迁移/合并时立刻把 v1 写回，避免旧键删除后 guideSeen 丢失；
 * - JSON 损坏由 loadJSON 兜底为 null → 按首访处理；结构损坏 → initial + recovered。
 */
export function loadDirectorPersisted(initial: PersistedDirectorV1): DirectorLoadResult {
  const legacyGuideSeen = readLegacyDirectorGuideSeen()
  let raw: unknown = null
  try {
    raw = loadJSON<unknown>(DIRECTOR_PERSIST_KEY, null)
  } catch {
    raw = null
  }
  const hasRaw = raw !== null && raw !== undefined
  const recovered = hasRaw && (!isRecord(raw) || raw.schemaVersion !== DIRECTOR_SCHEMA_VERSION)
  const value = migrateDirectorPersisted(raw, initial)
  if (legacyGuideSeen) {
    value.guideSeen = true
    removeLegacyDirectorGuideSeen()
  }
  if (legacyGuideSeen || recovered) {
    saveJSON(DIRECTOR_PERSIST_KEY, { ...value, updatedAt: Date.now() })
  }
  return { value, hasPersisted: hasRaw && !recovered, recovered }
}

let pending: PersistedDirectorV1 | null = null
let lastSignature = ''

/** 切片签名（updatedAt 不参与比对，否则每次调用都视为变更） */
function signatureOf(value: PersistedDirectorV1): string {
  return JSON.stringify({ ...value, updatedAt: 0 })
}

function writePending(): void {
  if (!pending) return
  const payload = { ...pending, updatedAt: Date.now() }
  pending = null
  saveJSON(DIRECTOR_PERSIST_KEY, payload)
}

const writer = createDebouncedWriter(() => writePending())

/**
 * store.subscribe 调用：只有「持久化切片」变化才排一次 300ms 合并写盘，
 * toast / screen / artifactId / guideActive 等瞬态变化不写盘。
 */
export function scheduleDirectorPersist(value: PersistedDirectorV1): boolean {
  const signature = signatureOf(value)
  if (signature === lastSignature) return false
  lastSignature = signature
  pending = { ...value, updatedAt: 0 }
  writer.schedule()
  return true
}

/** 关键节点立即落盘（confirmPlan / 门命中 / approve / reject / finish / reset） */
export function writeDirectorPersist(value: PersistedDirectorV1): void {
  writer.cancel()
  pending = null
  lastSignature = signatureOf(value)
  saveJSON(DIRECTOR_PERSIST_KEY, { ...value, updatedAt: Date.now() })
}

/** 页面隐藏 / pagehide / 单测：把待写快照立即写出 */
export function flushDirectorPersist(): void {
  writer.flush()
}

/** 重置 / 清库 / 恢复备份前：丢弃待写快照（否则 300ms 后旧状态会写回） */
export function cancelDirectorPersist(): void {
  pending = null
  lastSignature = ''
  writer.cancel()
}

/** 是否有待写快照（诊断 / 单测） */
export function hasPendingDirectorPersist(): boolean {
  return writer.pending
}
