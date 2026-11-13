/**
 * v1.2 M4 · Director 持久化 v2 契约单测（写入切片 / 截断 / 读回矩阵 / 合并写盘 / 体积）
 *
 * v1→v2 迁移矩阵见 directorMigration.test.ts；本文件只验证「M4 起写 v2」的读写契约。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DIRECTOR_DECISIONS_MAX,
  DIRECTOR_FACTS_MAX,
  DIRECTOR_FEED_MAX,
  DIRECTOR_LEGACY_GUIDE_KEY,
  DIRECTOR_PERSIST_KEY,
  DIRECTOR_PERSIST_MAX_BYTES,
  DIRECTOR_SCHEMA_VERSION,
  cancelDirectorPersist,
  flushDirectorPersist,
  hasPendingDirectorPersist,
  loadDirectorPersisted,
  migrateDirectorPersisted,
  scheduleDirectorPersist,
  toPersistedDirector,
  writeDirectorPersist,
  type DirectorPersistSource,
} from '../stores/directorPersistence'
import { localStorageProvider, setDataProvider, type DataProvider } from '../lib/dataProvider'
import type {
  AutonomyLevel,
  DecisionItem,
  DirectorAgentId,
  Fact,
  FeedItem,
  MissionState,
  PersistedDirectorV2,
} from '../harness/director/types'

function memoryProvider(): DataProvider & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, v)
    },
    removeItem: (k) => {
      store.delete(k)
    },
    keys: () => [...store.keys()],
  }
}

const AUTONOMY: Record<DirectorAgentId, AutonomyLevel> = {
  chief: 'L2',
  analyst: 'L2',
  assessor: 'L2',
  curriculum: 'L2',
  communicator: 'L1',
  steward: 'L3',
}

const MISSION: MissionState = {
  status: 'planning',
  kind: 'parent_meeting',
  title: '家长会材料包',
  progress: 0,
  feed: [],
  plan: [
    { id: 't1', agentId: 'analyst', title: '核对学情与名单', seconds: 40 },
    { id: 't2', agentId: 'curriculum', title: '起草发言稿 + PPT 大纲', seconds: 90, gate: 'speech', deps: ['t1'] },
  ],
  doneTasks: [],
  gate: null,
  planSource: 'template',
}

/** 合法 v2 初始载荷（等价于 store 首访时由空状态写出的形状） */
function initialV2(overrides: Partial<PersistedDirectorV2> = {}): PersistedDirectorV2 {
  const base = toPersistedDirector(
    {
      decisions: [],
      stats: { pending: 3, running: 1, hosted: 4, savedHours: 2.1 },
      mission: JSON.parse(JSON.stringify(MISSION)) as MissionState,
      missionCursor: 0,
      planSource: 'template',
      autonomy: AUTONOMY,
      facts: [],
    },
    false,
  )
  return { ...base, ...overrides }
}

function decision(id: string): DecisionItem {
  return {
    id,
    agentId: 'chief',
    kind: 'approve',
    title: `决定 ${id}`,
    subtitle: '',
    readiness: 100,
    minutes: 1,
    tag: '家校',
    primaryLabel: '发送',
    preview: { rows: [{ label: '收件人', value: '3 位家长' }] },
    status: 'new',
  }
}

function feedItem(index: number): FeedItem {
  return { id: `f-${index}`, agentId: 'analyst', text: `动态 ${index}`, at: 1_700_000_000_000 + index, kind: 'step' }
}

function fact(index: number): Fact {
  return {
    factId: `f-${index}`,
    key: `metric.${index}`,
    value: index,
    unit: '分',
    label: `指标 ${index}`,
    source: '学情库 · 单元考',
    asOf: '2026-11-06',
  }
}

describe('toPersistedDirector · v2 写入切片', () => {
  it('写出 schemaVersion=2 + mission.runtime + artifactIds + migrations；瞬态字段不进载荷', () => {
    const source = {
      decisions: [decision('d-1')],
      stats: { pending: 2, running: 1, hosted: 5, savedHours: 2.3 },
      mission: MISSION,
      missionCursor: 3,
      planSource: 'template',
      autonomy: { ...AUTONOMY },
      facts: [fact(1)],
      execution: {
        mode: 'real',
        missionId: 'm-123',
        outcome: 'partial',
        startedAt: 1_700_000_000_000,
        finishedAt: 1_700_000_009_000,
        completedTasks: ['t1'],
        failedTasks: [{ taskId: 't2', reason: '超时' }],
        attempts: 3,
      },
      intake: { source: 'briefing', cardId: 'd-drill' },
      artifactIds: ['doc-rt-m-1-t1'],
      stale: true,
      migrations: [{ from: 1, at: 1 }],
      // 瞬态字段：即使被误传也不应落入载荷
      screen: 'mission',
      toasts: [{ id: 't1', text: 'hi', tone: 'primary' }],
      artifactId: 'a-brief',
      guideActive: true,
      guideStep: 2,
      planLoading: true,
    } as DirectorPersistSource
    const result = toPersistedDirector(source, false, 123)
    expect(result.schemaVersion).toBe(DIRECTOR_SCHEMA_VERSION)
    expect(result.updatedAt).toBe(123)
    expect(result.mission.runtime.execution).toBe('real')
    expect(result.mission.runtime.outcome).toBe('partial')
    expect(result.mission.runtime.cursor).toBe(3)
    expect(result.mission.runtime.completedTasks).toEqual(['t1'])
    expect(result.mission.runtime.failedTasks).toEqual([{ taskId: 't2', reason: '超时' }])
    expect(result.mission.runtime.attempts).toBe(3)
    expect(result.mission.runtime.startedAt).toBe(1_700_000_000_000)
    expect(result.artifactIds).toEqual(['doc-rt-m-1-t1'])
    expect(result.intake).toEqual({ source: 'briefing', cardId: 'd-drill' })
    expect(result.stale).toBe(true)
    expect(result.migrations).toEqual([{ from: 1, at: 1 }])
    const json = JSON.stringify(result)
    for (const field of ['toasts', 'screen', 'artifactId', 'guideActive', 'planLoading']) {
      expect(json).not.toContain(`"${field}"`)
    }
    /* guideSeen=false 时不写字段（可选迁移来源） */
    expect(result.guideSeen).toBeUndefined()
  })

  it('写盘截断：decisions ≤12 / feed ≤30 / facts ≤12 / artifactIds ≤30，且保留最新 feed', () => {
    const longMission: MissionState = { ...MISSION, feed: Array.from({ length: 40 }, (_, i) => feedItem(i)) }
    const result = toPersistedDirector(
      {
        decisions: Array.from({ length: 20 }, (_, i) => decision(`d-${i}`)),
        stats: { pending: 0, running: 0, hosted: 0, savedHours: 0 },
        mission: longMission,
        missionCursor: 0,
        planSource: 'template',
        autonomy: { ...AUTONOMY },
        facts: Array.from({ length: 20 }, (_, i) => fact(i)),
        artifactIds: Array.from({ length: 40 }, (_, i) => `doc-${i}`),
      },
      true,
    )
    expect(result.decisions).toHaveLength(DIRECTOR_DECISIONS_MAX)
    expect(result.mission.feed).toHaveLength(DIRECTOR_FEED_MAX)
    expect(result.mission.feed[0].id).toBe('f-10')
    expect(result.mission.feed[DIRECTOR_FEED_MAX - 1].id).toBe('f-39')
    expect(result.facts).toHaveLength(DIRECTOR_FACTS_MAX)
    expect(result.artifactIds).toHaveLength(30)
    expect(result.guideSeen).toBe(true)
  })

  it('体积 <30KB（引用而非正文；feed/facts/artifacts 截断后）', () => {
    const result = toPersistedDirector(
      {
        decisions: [],
        stats: { pending: 0, running: 0, hosted: 0, savedHours: 0 },
        mission: { ...MISSION, feed: Array.from({ length: 30 }, (_, i) => feedItem(i)) },
        missionCursor: 0,
        planSource: 'template',
        autonomy: { ...AUTONOMY },
        facts: Array.from({ length: 12 }, (_, i) => fact(i)),
        artifactIds: Array.from({ length: 30 }, (_, i) => `doc-rt-m-1-t${i}`),
      },
      true,
    )
    expect(JSON.stringify(result).length).toBeLessThan(DIRECTOR_PERSIST_MAX_BYTES)
  })
})

describe('loadDirectorPersisted · v2 恢复矩阵', () => {
  let provider: ReturnType<typeof memoryProvider>
  const initial = initialV2()

  beforeEach(() => {
    provider = memoryProvider()
    setDataProvider(provider)
    cancelDirectorPersist()
    try {
      window.localStorage.removeItem(DIRECTOR_LEGACY_GUIDE_KEY)
    } catch {
      /* ignore */
    }
  })

  afterEach(() => {
    cancelDirectorPersist()
    setDataProvider(localStorageProvider)
  })

  it('无持久化数据：回初始、hasPersisted=false、migrated=false', () => {
    const result = loadDirectorPersisted(initial)
    expect(result.hasPersisted).toBe(false)
    expect(result.recovered).toBe(false)
    expect(result.migrated).toBe(false)
    expect(result.value).toEqual(initial)
  })

  it('坏 JSON / 非对象 / 未知版本：回初始 + recovered，绝不抛', () => {
    for (const raw of ['not-json{', 42, 'x', [], { foo: 1 }, { ...initial, schemaVersion: 3 }]) {
      expect(() => migrateDirectorPersisted(raw, initial)).not.toThrow()
      expect(migrateDirectorPersisted(raw, initial)).toEqual(initial)
    }
    provider.setItem(`edustudio:${DIRECTOR_PERSIST_KEY}`, JSON.stringify({ ...initial, schemaVersion: 3 }))
    const loaded = loadDirectorPersisted(initial)
    expect(loaded.hasPersisted).toBe(false)
    expect(loaded.recovered).toBe(true)
    expect(loaded.value).toEqual(initial)
  })

  it('v2 running → paused（刷新恢复语义）；waiting/done/partial/failed 原样', () => {
    for (const [status, expected] of [
      ['running', 'paused'],
      ['waiting', 'waiting'],
      ['done', 'done'],
      ['partial', 'partial'],
      ['failed', 'failed'],
      ['idle', 'idle'],
    ] as const) {
      const raw = toPersistedDirector(
        {
          decisions: [],
          stats: { pending: 0, running: 0, hosted: 0, savedHours: 0 },
          mission: { ...MISSION, status },
          missionCursor: 0,
          planSource: 'template',
          autonomy: { ...AUTONOMY },
          facts: [],
        },
        false,
      )
      const migrated = migrateDirectorPersisted(raw, initial)
      expect(migrated.mission.status).toBe(expected)
    }
  })

  it('非法 status / garbage runtime 回退兜底，不白屏', () => {
    const raw = {
      ...initial,
      mission: {
        ...initial.mission,
        status: 'weird',
        runtime: { execution: 'bad', attempts: -1, completedTasks: 'x' },
      },
    }
    const migrated = migrateDirectorPersisted(raw, initial)
    expect(migrated.mission.status).toBe(initial.mission.status)
    expect(migrated.mission.runtime.execution).toBe(initial.mission.runtime.execution)
    expect(migrated.mission.runtime.attempts).toBe(0)
    expect(migrated.mission.runtime.completedTasks).toEqual(initial.mission.runtime.completedTasks)
  })

  it('v2 读回保留 artifactIds/intake/stale/guideSeen/migrations', () => {
    const raw = toPersistedDirector(
      {
        decisions: [decision('d-1')],
        stats: { pending: 1, running: 0, hosted: 1, savedHours: 0.2 },
        mission: { ...MISSION, status: 'done', doneTasks: ['t1', 't2'] },
        missionCursor: 5,
        planSource: 'llm',
        autonomy: { ...AUTONOMY },
        facts: [fact(2)],
        artifactIds: ['doc-a', 'doc-b'],
        intake: { source: 'inbox' },
      },
      true,
    )
    provider.setItem(`edustudio:${DIRECTOR_PERSIST_KEY}`, JSON.stringify(raw))
    const loaded = loadDirectorPersisted(initial)
    expect(loaded.hasPersisted).toBe(true)
    expect(loaded.migrated).toBe(false)
    expect(loaded.value.mission.runtime.cursor).toBe(5)
    expect(loaded.value.mission.runtime.completedTasks).toEqual(['t1', 't2'])
    expect(loaded.value.artifactIds).toEqual(['doc-a', 'doc-b'])
    expect(loaded.value.intake).toEqual({ source: 'inbox' })
    expect(loaded.value.guideSeen).toBe(true)
    expect(loaded.value.decisions).toHaveLength(1)
  })

  it('旧裸引导键合并进 v2 并删除旧键', () => {
    window.localStorage.setItem(DIRECTOR_LEGACY_GUIDE_KEY, '1')
    const raw = toPersistedDirector(
      {
        decisions: [],
        stats: { pending: 0, running: 0, hosted: 0, savedHours: 0 },
        mission: MISSION,
        missionCursor: 0,
        planSource: 'template',
        autonomy: { ...AUTONOMY },
        facts: [],
      },
      false,
    )
    provider.setItem(`edustudio:${DIRECTOR_PERSIST_KEY}`, JSON.stringify(raw))
    const loaded = loadDirectorPersisted(initial)
    expect(loaded.value.guideSeen).toBe(true)
    expect(window.localStorage.getItem(DIRECTOR_LEGACY_GUIDE_KEY)).toBeNull()
    const written = JSON.parse(provider.store.get(`edustudio:${DIRECTOR_PERSIST_KEY}`)!) as PersistedDirectorV2
    expect(written.guideSeen).toBe(true)
  })

  it('写盘 / flush / cancel：300ms 合并写盘 + 立即写 + 丢弃待写', () => {
    vi.useFakeTimers()
    try {
      const a = toPersistedDirector(
        {
          decisions: [],
          stats: { pending: 0, running: 0, hosted: 0, savedHours: 0 },
          mission: { ...MISSION, progress: 10 },
          missionCursor: 0,
          planSource: 'template',
          autonomy: { ...AUTONOMY },
          facts: [],
        },
        false,
      )
      expect(scheduleDirectorPersist(a)).toBe(true)
      expect(hasPendingDirectorPersist()).toBe(true)
      vi.advanceTimersByTime(400)
      expect(hasPendingDirectorPersist()).toBe(false)
      const b = toPersistedDirector(
        {
          decisions: [],
          stats: { pending: 0, running: 0, hosted: 0, savedHours: 0 },
          mission: { ...MISSION, progress: 85 },
          missionCursor: 0,
          planSource: 'template',
          autonomy: { ...AUTONOMY },
          facts: [],
        },
        false,
      )
      writeDirectorPersist(b)
      expect(hasPendingDirectorPersist()).toBe(false)
      cancelDirectorPersist()
      expect(hasPendingDirectorPersist()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('flush 写出待写快照（页面隐藏兜底）', () => {
    const a = toPersistedDirector(
      {
        decisions: [],
        stats: { pending: 0, running: 0, hosted: 0, savedHours: 0 },
        mission: { ...MISSION, progress: 33 },
        missionCursor: 0,
        planSource: 'template',
        autonomy: { ...AUTONOMY },
        facts: [],
      },
      false,
    )
    scheduleDirectorPersist(a)
    flushDirectorPersist()
    const written = JSON.parse(provider.store.get(`edustudio:${DIRECTOR_PERSIST_KEY}`)!) as PersistedDirectorV2
    expect(written.mission.progress).toBe(33)
  })
})
