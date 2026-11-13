/**
 * Director 状态持久化（v1.1 M2 → v1.2 M4：schema v1→v2 迁移）
 *
 * 契约：`edustudio:director`
 * - **v2（schemaVersion 2，M4 起写）**：mission.runtime（执行模式/outcome/cursor/completedTasks/
 *   failedTasks/attempts/startedAt/finishedAt）、artifactIds、intake、stale、migrations；
 *   `guideSeen` 仅作迁移来源保留一个版本（新代码以 `settings.studio.onboarded` 为准）。
 * - **v1（schemaVersion 1）只读迁移**：读取时经纯函数 `migrateV1toV2()` 一次性升级并立即写回；
 *   字段一一映射（mission/decisions/autonomy/facts/guideSeen/execution → runtime）。
 * - 只落「持久化切片」：decisions / stats / mission / runtime / autonomy / guideSeen / facts /
 *   artifactIds / intake / stale / migrations；toasts、screen、artifactId、guideActive/guideStep、
 *   planLoading、定时器、滚动位置一律排除（派生/瞬态）。
 * - 写盘走 `createDebouncedWriter`（300ms）+ 切片签名比对；关键节点由 store 调 write 立即落盘。
 * - 恢复矩阵：planning 原样 / running→paused / waiting 原样（M4 起执行控制器在安装时归一为 paused）/
 *   done/partial/failed 原样 / 损坏回初始。**绝不抛**。
 * - 旧引导裸键 `edustudio:director-guide` 合并进 payload 后删除。
 */
import { createDebouncedWriter } from '../lib/debouncedWrite'
import { loadJSON, saveJSON } from '../lib/storage'
import type {
  AutonomyLevel,
  DecisionItem,
  DecisionKind,
  DirectorAgentId,
  DirectorMissionRuntime,
  DirectorStats,
  Fact,
  FactUnit,
  FeedItem,
  GateId,
  MissionKind,
  MissionPlanTask,
  MissionState,
  MissionStatus,
  PersistedDirectorExecution,
  PersistedDirectorIntake,
  PersistedDirectorV1,
  PersistedDirectorV2,
  PlanSource,
} from '../harness/director/types'

/** storage 键（不含 `edustudio:` 前缀） */
export const DIRECTOR_PERSIST_KEY = 'director'
/** v1.2 M4 起写 v2；v1 只读迁移 */
export const DIRECTOR_SCHEMA_VERSION = 2 as const
export const DIRECTOR_SCHEMA_VERSION_V1 = 1 as const
/** 写盘上限：decisions ≤12、feed ≤30、facts ≤12（roadmap §5.1） */
export const DIRECTOR_DECISIONS_MAX = 12
export const DIRECTOR_FEED_MAX = 30
export const DIRECTOR_FACTS_MAX = 12
export const DIRECTOR_ARTIFACT_IDS_MAX = 30
/** 单键体积上限（实测目标 <10KB） */
export const DIRECTOR_PERSIST_MAX_BYTES = 30 * 1024
/** v1.0 旧引导已读键（裸 localStorage，独立键；v1.1 合并后删除） */
export const DIRECTOR_LEGACY_GUIDE_KEY = 'edustudio:director-guide'

const AGENT_IDS: readonly DirectorAgentId[] = ['chief', 'analyst', 'assessor', 'curriculum', 'communicator', 'steward']
const AUTONOMY_LEVELS: readonly AutonomyLevel[] = ['L0', 'L1', 'L2', 'L3']
const MISSION_KINDS: readonly MissionKind[] = ['parent_meeting', 'exam_loop']
const MISSION_STATUSES: readonly MissionStatus[] = [
  'idle',
  'planning',
  'running',
  'paused',
  'waiting',
  'done',
  'partial',
  'failed',
]
const GATE_IDS: readonly GateId[] = ['speech', 'letters', 'worksheet', 'lesson']
const PLAN_SOURCES: readonly PlanSource[] = ['template', 'llm']
const DECISION_KINDS: readonly DecisionKind[] = ['prepared', 'approve', 'conflict']
const DECISION_STATUSES: readonly DecisionItem['status'][] = ['new', 'done', 'snoozed']
const FEED_KINDS: FeedItem['kind'][] = ['step', 'gate', 'system']
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

function uniqueStrings(value: unknown, max = 30): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of value) {
    if (typeof id !== 'string' || !id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= max) break
  }
  return out
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
  /* ---- v1.2 过渡期 optional 增量（M4 起映射进 v2 的 runtime/artifactIds/intake） ---- */
  execution?: PersistedDirectorExecution
  intake?: PersistedDirectorIntake
  artifactIds?: string[]
  stale?: boolean
  migrations?: { from: 1; at: number }[]
}

/** v1.2 M3/M4：执行元数据校验（坏字段逐个回落，绝不抛） */
function sanitizeExecution(raw: unknown): PersistedDirectorExecution | undefined {
  if (!isRecord(raw)) return undefined
  const mode = raw.mode === 'real' ? 'real' : raw.mode === 'mock' ? 'mock' : null
  if (!mode) return undefined
  const execution: PersistedDirectorExecution = { mode }
  if (typeof raw.missionId === 'string' && raw.missionId) execution.missionId = raw.missionId
  if (raw.outcome === 'done' || raw.outcome === 'partial' || raw.outcome === 'failed' || raw.outcome === 'cancelled') {
    execution.outcome = raw.outcome
  }
  if (typeof raw.startedAt === 'number' && Number.isFinite(raw.startedAt)) execution.startedAt = raw.startedAt
  if (typeof raw.finishedAt === 'number' && Number.isFinite(raw.finishedAt)) execution.finishedAt = raw.finishedAt
  if (Array.isArray(raw.completedTasks)) {
    execution.completedTasks = raw.completedTasks.filter((id): id is string => typeof id === 'string').slice(0, 20)
  }
  if (Array.isArray(raw.failedTasks)) {
    const failed: { taskId: string; reason: string }[] = []
    for (const item of raw.failedTasks) {
      if (!isRecord(item) || typeof item.taskId !== 'string') continue
      failed.push({ taskId: item.taskId, reason: asString(item.reason, '') })
    }
    execution.failedTasks = failed.slice(0, 20)
  }
  if (typeof raw.attempts === 'number' && Number.isFinite(raw.attempts) && raw.attempts >= 0) {
    execution.attempts = Math.floor(raw.attempts)
  }
  return execution
}

/** v1.2 M3：mission 来源校验 */
function sanitizeIntake(raw: unknown): PersistedDirectorIntake | undefined {
  if (!isRecord(raw)) return undefined
  const source = raw.source === 'inbox' || raw.source === 'briefing' || raw.source === 'chat' ? raw.source : null
  if (!source) return undefined
  const intake: PersistedDirectorIntake = { source }
  if (typeof raw.cardId === 'string' && raw.cardId) intake.cardId = raw.cardId
  if (typeof raw.sessionId === 'string' && raw.sessionId) intake.sessionId = raw.sessionId
  return intake
}

/** v2 runtime 校验（缺省用兜底；坏字段回退，绝不抛） */
function sanitizeRuntime(raw: unknown, fallback: DirectorMissionRuntime): DirectorMissionRuntime {
  if (!isRecord(raw)) return { ...fallback }
  const runtime: DirectorMissionRuntime = {
    execution: raw.execution === 'real' ? 'real' : raw.execution === 'mock' ? 'mock' : fallback.execution,
    cursor: Math.floor(asNonNegative(raw.cursor, fallback.cursor)),
    completedTasks: Array.isArray(raw.completedTasks)
      ? uniqueStrings(raw.completedTasks, 30)
      : [...fallback.completedTasks],
    failedTasks: [],
    attempts: Math.floor(asNonNegative(raw.attempts, fallback.attempts)),
  }
  if (raw.outcome === 'done' || raw.outcome === 'partial' || raw.outcome === 'failed' || raw.outcome === 'cancelled') {
    runtime.outcome = raw.outcome
  }
  if (Array.isArray(raw.failedTasks)) {
    for (const item of raw.failedTasks) {
      if (!isRecord(item) || typeof item.taskId !== 'string') continue
      runtime.failedTasks.push({ taskId: item.taskId, reason: asString(item.reason, '') })
    }
    runtime.failedTasks = runtime.failedTasks.slice(0, 20)
  } else {
    runtime.failedTasks = [...fallback.failedTasks]
  }
  if (typeof raw.startedAt === 'number' && Number.isFinite(raw.startedAt)) runtime.startedAt = raw.startedAt
  if (typeof raw.finishedAt === 'number' && Number.isFinite(raw.finishedAt)) runtime.finishedAt = raw.finishedAt
  return runtime
}

function sanitizeMigrations(raw: unknown): { from: 1; at: number }[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is Record<string, unknown> => isRecord(item) && item.from === 1)
    .map((item) => ({ from: 1 as const, at: asFinite(item.at, Date.now()) }))
    .slice(0, 3)
}

/** 由持久化源组装行内 mission（v2 形状：MissionState + runtime） */
function missionWithRuntime(source: DirectorPersistSource, now: number): MissionState & { runtime: DirectorMissionRuntime } {
  const mission: MissionState = {
    ...source.mission,
    kind: asMissionKind(source.mission?.kind),
    planSource: PLAN_SOURCES.includes(source.planSource) ? source.planSource : 'template',
    feed: (Array.isArray(source.mission?.feed) ? source.mission.feed : []).slice(-DIRECTOR_FEED_MAX),
    plan: Array.isArray(source.mission?.plan) ? source.mission.plan : [],
    doneTasks: Array.isArray(source.mission?.doneTasks) ? source.mission.doneTasks : [],
  }
  const execution = sanitizeExecution(source.execution)
  const runtime: DirectorMissionRuntime = {
    execution: execution?.mode ?? 'mock',
    cursor: Math.floor(asNonNegative(source.missionCursor, 0)),
    completedTasks: uniqueStrings([...(mission.doneTasks ?? []), ...(execution?.completedTasks ?? [])], 30),
    failedTasks: execution?.failedTasks ?? [],
    attempts: execution?.attempts ?? 0,
  }
  if (execution?.outcome) runtime.outcome = execution.outcome
  const startedAt = execution?.startedAt ?? mission.startedAt
  const finishedAt = execution?.finishedAt ?? mission.finishedAt
  if (typeof startedAt === 'number' && Number.isFinite(startedAt)) runtime.startedAt = startedAt
  if (typeof finishedAt === 'number' && Number.isFinite(finishedAt)) runtime.finishedAt = finishedAt
  void now
  return { ...mission, runtime }
}

/**
 * 组装 v2 载荷（纯函数）：
 * - guideSeen 不在 DirectorState 里（历史原因），由 store 侧模块变量传入；仅 true 时写出（迁移来源）；
 * - 写盘前按契约截断 decisions ≤12 / feed ≤30 / facts ≤12 / artifactIds ≤30；
 * - migrations 缺省 []，updatedAt 由调度层写盘时盖章。
 */
export function toPersistedDirector(
  source: DirectorPersistSource,
  guideSeen: boolean,
  now = Date.now(),
): PersistedDirectorV2 {
  const payload: PersistedDirectorV2 = {
    schemaVersion: DIRECTOR_SCHEMA_VERSION,
    updatedAt: now,
    decisions: (Array.isArray(source.decisions) ? source.decisions : []).slice(0, DIRECTOR_DECISIONS_MAX),
    stats: { ...source.stats },
    mission: missionWithRuntime(source, now),
    autonomy: { ...source.autonomy },
    facts: (Array.isArray(source.facts) ? source.facts : []).slice(0, DIRECTOR_FACTS_MAX),
    artifactIds: uniqueStrings(source.artifactIds, DIRECTOR_ARTIFACT_IDS_MAX),
    migrations: sanitizeMigrations(source.migrations),
  }
  if (guideSeen) payload.guideSeen = true
  const intake = sanitizeIntake(source.intake)
  if (intake) payload.intake = intake
  if (source.stale === true) payload.stale = true
  return payload
}

/* ------------------------------------------------------------------ */
/* 校验（load 与单测共用；坏数据回 initial，绝不抛）                      */
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
export function emptyDirectorPersisted(initial: PersistedDirectorV2): PersistedDirectorV2 {
  return cloneJSON(initial)
}

/* ------------------------------------------------------------------ */
/* v1 → v2 迁移（纯函数；M4 一次性，幂等）                               */
/* ------------------------------------------------------------------ */

/** v2 的兜底 runtime（由 mission 自身推导；v1 无 runtime 时同样适用） */
function fallbackRuntime(mission: MissionState): DirectorMissionRuntime {
  const runtime: DirectorMissionRuntime = {
    execution: 'mock',
    cursor: 0,
    completedTasks: uniqueStrings(mission.doneTasks, 30),
    failedTasks: [],
    attempts: 0,
  }
  if (typeof mission.startedAt === 'number') runtime.startedAt = mission.startedAt
  if (typeof mission.finishedAt === 'number') runtime.finishedAt = mission.finishedAt
  return runtime
}

/**
 * v1 载荷 → v2 载荷（纯函数；不改入参）。
 * - mission.status 六值原样保留（v2 可含 partial/failed，但 v1 数据不会有）；
 * - missionCursor → runtime.cursor；optional execution → runtime.execution/outcome/attempts/failedTasks；
 * - artifactIds/intake/stale 原样；guideSeen 保留作迁移来源；migrations 记一条 {from:1, at}。
 */
export function migrateV1toV2(raw: PersistedDirectorV1, now = Date.now()): PersistedDirectorV2 {
  const mission = sanitizeMission(raw.mission, raw.mission)
  /* 防御：入参 fallback 自身可能带非法 status → 强制白名单兜底 */
  if (!MISSION_STATUSES.includes(mission.status)) mission.status = 'idle'
  if (mission.status === 'running') mission.status = 'paused'
  const execution = sanitizeExecution(raw.execution)
  const runtime: DirectorMissionRuntime = {
    execution: execution?.mode ?? 'mock',
    cursor: Math.floor(asNonNegative(raw.missionCursor, 0)),
    completedTasks: uniqueStrings([...(mission.doneTasks ?? []), ...(execution?.completedTasks ?? [])], 30),
    failedTasks: execution?.failedTasks ?? [],
    attempts: execution?.attempts ?? 0,
  }
  if (execution?.outcome) runtime.outcome = execution.outcome
  if (execution?.startedAt ?? mission.startedAt) runtime.startedAt = (execution?.startedAt ?? mission.startedAt) as number
  if (execution?.finishedAt ?? mission.finishedAt) runtime.finishedAt = (execution?.finishedAt ?? mission.finishedAt) as number
  const payload: PersistedDirectorV2 = {
    schemaVersion: DIRECTOR_SCHEMA_VERSION,
    updatedAt: asFinite(raw.updatedAt, now),
    decisions: sanitizeDecisions(raw.decisions, []),
    stats: raw.stats,
    mission: { ...mission, runtime },
    autonomy: sanitizeAutonomy(raw.autonomy, {
      chief: 'L1',
      analyst: 'L1',
      assessor: 'L1',
      curriculum: 'L1',
      communicator: 'L1',
      steward: 'L1',
    }),
    facts: sanitizeFacts(raw.facts ?? []),
    artifactIds: uniqueStrings(raw.artifactIds, DIRECTOR_ARTIFACT_IDS_MAX),
    migrations: [{ from: 1, at: now }],
  }
  if (raw.guideSeen === true) payload.guideSeen = true
  const intake = sanitizeIntake(raw.intake)
  if (intake) payload.intake = intake
  if (raw.stale === true) payload.stale = true
  return payload
}

/** v2 载荷校验（损坏字段逐个回退，绝不抛） */
function sanitizeV2(raw: Record<string, unknown>, initial: PersistedDirectorV2): PersistedDirectorV2 {
  const baseMission = sanitizeMission(raw.mission, initial.mission)
  if (baseMission.status === 'running') baseMission.status = 'paused'
  const runtime = sanitizeRuntime(
    isRecord(raw.mission) ? raw.mission.runtime : undefined,
    fallbackRuntime(baseMission),
  )
  const payload: PersistedDirectorV2 = {
    schemaVersion: DIRECTOR_SCHEMA_VERSION,
    updatedAt: asFinite(raw.updatedAt, Date.now()),
    decisions: sanitizeDecisions(raw.decisions, initial.decisions),
    stats: sanitizeStats(raw.stats, initial.stats),
    mission: { ...baseMission, runtime },
    autonomy: sanitizeAutonomy(raw.autonomy, initial.autonomy),
    facts: sanitizeFacts(raw.facts),
    artifactIds: uniqueStrings(raw.artifactIds, DIRECTOR_ARTIFACT_IDS_MAX),
    migrations: sanitizeMigrations(raw.migrations),
  }
  if (raw.guideSeen === true) payload.guideSeen = true
  const intake = sanitizeIntake(raw.intake)
  if (intake) payload.intake = intake
  if (raw.stale === true) payload.stale = true
  return payload
}

/**
 * 迁移 / 校验入口：非对象或未知版本 → initial；schemaVersion 1 → migrateV1toV2；
 * schemaVersion 2 → sanitizeV2（running→paused、字段截断）。**绝不抛**。
 */
export function migrateDirectorPersisted(raw: unknown, initial: PersistedDirectorV2): PersistedDirectorV2 {
  if (!isRecord(raw)) return emptyDirectorPersisted(initial)
  if (raw.schemaVersion === DIRECTOR_SCHEMA_VERSION_V1) {
    return migrateV1toV2(raw as unknown as PersistedDirectorV1)
  }
  if (raw.schemaVersion === DIRECTOR_SCHEMA_VERSION) return sanitizeV2(raw, initial)
  return emptyDirectorPersisted(initial)
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
  value: PersistedDirectorV2
  /** 有可用持久化数据（首访为 false：开场仍回战情台，不走「刷新恢复」落点） */
  hasPersisted: boolean
  /** 有过持久化数据但损坏/版本未知（回初始；UI 可给非打断提示） */
  recovered: boolean
  /** 本次是否发生了 v1→v2 迁移（诊断/测试用） */
  migrated: boolean
}

/**
 * 读取并迁移：
 * - v1 → v2 一次性迁移并立刻写回（避免下次再迁移；日志留 migrations）；
 * - 旧 `edustudio:director-guide` 合并进 payload（OR）后删除旧键；
 * - JSON 损坏由 loadJSON 兜底为 null → 按首访处理；结构损坏 → initial + recovered。
 */
export function loadDirectorPersisted(initial: PersistedDirectorV2): DirectorLoadResult {
  const legacyGuideSeen = readLegacyDirectorGuideSeen()
  let raw: unknown = null
  try {
    raw = loadJSON<unknown>(DIRECTOR_PERSIST_KEY, null)
  } catch {
    raw = null
  }
  const hasRaw = raw !== null && raw !== undefined
  const migrated = isRecord(raw) && raw.schemaVersion === DIRECTOR_SCHEMA_VERSION_V1
  const recovered = hasRaw && (!isRecord(raw) || (raw.schemaVersion !== 1 && raw.schemaVersion !== 2))
  const value = migrateDirectorPersisted(raw, initial)
  if (legacyGuideSeen) {
    value.guideSeen = true
    removeLegacyDirectorGuideSeen()
  }
  if (legacyGuideSeen || recovered || migrated) {
    saveJSON(DIRECTOR_PERSIST_KEY, { ...value, updatedAt: Date.now() })
  }
  return { value, hasPersisted: hasRaw && !recovered, recovered, migrated }
}

let pending: PersistedDirectorV2 | null = null
let lastSignature = ''

/** 切片签名（updatedAt 不参与比对，否则每次调用都视为变更） */
function signatureOf(value: PersistedDirectorV2): string {
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
export function scheduleDirectorPersist(value: PersistedDirectorV2): boolean {
  const signature = signatureOf(value)
  if (signature === lastSignature) return false
  lastSignature = signature
  pending = { ...value, updatedAt: 0 }
  writer.schedule()
  return true
}

/** 关键节点立即落盘（confirmPlan / 门命中 / approve / reject / finish / reset） */
export function writeDirectorPersist(value: PersistedDirectorV2): void {
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
