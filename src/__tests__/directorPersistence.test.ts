import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DIRECTOR_DECISIONS_MAX,
  DIRECTOR_FACTS_MAX,
  DIRECTOR_FEED_MAX,
  DIRECTOR_LEGACY_GUIDE_KEY,
  DIRECTOR_PERSIST_KEY,
  DIRECTOR_PERSIST_MAX_BYTES,
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
  PersistedDirectorV1,
} from '../harness/director/types'

/* v1.1 M2 持久化契约：edustudio:director v1 / 迁移矩阵 / 300ms 合并写盘（roadmap §5） */

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

/** 合法 v1 载荷（等价于「首访初始态」） */
function payload(overrides: Partial<PersistedDirectorV1> = {}): PersistedDirectorV1 {
  return {
    schemaVersion: 1,
    updatedAt: 1_700_000_000_000,
    decisions: [],
    stats: { pending: 3, running: 1, hosted: 4, savedHours: 2.1 },
    mission: JSON.parse(JSON.stringify(MISSION)) as MissionState,
    missionKind: 'parent_meeting',
    missionCursor: 0,
    planSource: 'template',
    autonomy: AUTONOMY as unknown as PersistedDirectorV1['autonomy'],
    guideSeen: false,
    facts: [],
    ...overrides,
  }
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

describe('toPersistedDirector 切片（写入侧）', () => {
  it('只保留持久化字段：toasts / screen / artifactId / guideActive / planLoading 不进载荷', () => {
    const source = {
      decisions: [decision('d-1')],
      stats: { pending: 2, running: 1, hosted: 5, savedHours: 2.3 },
      mission: MISSION,
      missionCursor: 3,
      planSource: 'template',
      autonomy: { ...AUTONOMY },
      facts: [fact(1)],
      // 瞬态字段：即使被误传也不应落入 payload
      screen: 'mission',
      toasts: [{ id: 't1', text: 'hi', tone: 'primary' }],
      artifactId: 'a-brief',
      guideActive: true,
      guideStep: 2,
      planLoading: true,
    } as DirectorPersistSource
    const result = toPersistedDirector(source, false, 123)
    expect(result.schemaVersion).toBe(1)
    expect(result.updatedAt).toBe(123)
    expect(result.missionKind).toBe('parent_meeting')
    expect(result.missionCursor).toBe(3)
    const json = JSON.stringify(result)
    expect(json).not.toContain('toasts')
    expect(json).not.toContain('screen')
    expect(json).not.toContain('artifactId')
    expect(json).not.toContain('guideActive')
    expect(json).not.toContain('planLoading')
    expect(result.guideSeen).toBe(false)
  })

  it('写盘截断：decisions ≤12 / feed ≤30 / facts ≤12', () => {
    const longMission: MissionState = {
      ...MISSION,
      feed: Array.from({ length: 40 }, (_, i) => feedItem(i)),
    }
    const result = toPersistedDirector(
      {
        decisions: Array.from({ length: 20 }, (_, i) => decision(`d-${i}`)),
        stats: { pending: 0, running: 0, hosted: 0, savedHours: 0 },
        mission: longMission,
        missionCursor: 0,
        planSource: 'template',
        autonomy: { ...AUTONOMY },
        facts: Array.from({ length: 20 }, (_, i) => fact(i)),
      },
      true,
    )
    expect(result.decisions).toHaveLength(DIRECTOR_DECISIONS_MAX)
    expect(result.mission.feed).toHaveLength(DIRECTOR_FEED_MAX)
    /* 保留最后 30 条（最新动态优先） */
    expect(result.mission.feed[0].id).toBe('f-10')
    expect(result.mission.feed[DIRECTOR_FEED_MAX - 1].id).toBe('f-39')
    expect(result.facts).toHaveLength(DIRECTOR_FACTS_MAX)
    expect(result.guideSeen).toBe(true)
  })
})

describe('migrateDirectorPersisted / loadDirectorPersisted（恢复矩阵）', () => {
  let provider: ReturnType<typeof memoryProvider>

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

  it('无持久化数据：回初始、hasPersisted=false（首访仍回战情台）', () => {
    const initial = payload()
    const result = loadDirectorPersisted(initial)
    expect(result.hasPersisted).toBe(false)
    expect(result.recovered).toBe(false)
    expect(result.value).toEqual(initial)
  })

  it('版本未知 / 非对象：回初始 + recovered，绝不抛', () => {
    const initial = payload()
    for (const raw of [null, 42, 'x', [], { foo: 1 }, { ...payload(), schemaVersion: 2 }]) {
      expect(() => migrateDirectorPersisted(raw, initial)).not.toThrow()
      expect(migrateDirectorPersisted(raw, initial)).toEqual(initial)
    }
    provider.setItem(`edustudio:${DIRECTOR_PERSIST_KEY}`, JSON.stringify({ ...payload(), schemaVersion: 2 }))
    const loaded = loadDirectorPersisted(initial)
    expect(loaded.hasPersisted).toBe(false)
    expect(loaded.recovered).toBe(true)
    expect(loaded.value).toEqual(initial)
  })

  it('坏 JSON：loadJSON 兜底为初始态，不白屏', () => {
    const initial = payload()
    provider.setItem(`edustudio:${DIRECTOR_PERSIST_KEY}`, 'not-json{')
    const loaded = loadDirectorPersisted(initial)
    expect(loaded.hasPersisted).toBe(false)
    expect(loaded.value).toEqual(initial)
  })

  it('running → paused（刷新恢复语义），其余状态原样', () => {
    const initial = payload()
    for (const [status, expected] of [
      ['running', 'paused'],
      ['waiting', 'waiting'],
      ['planning', 'planning'],
      ['done', 'done'],
      ['paused', 'paused'],
      ['idle', 'idle'],
    ] as const) {
      const raw = payload({ mission: { ...JSON.parse(JSON.stringify(MISSION)), status } as MissionState })
      const migrated = migrateDirectorPersisted(raw, initial)
      expect(migrated.mission.status).toBe(expected)
    }
  })

  it('字段类型校验补默认：非法 status/kind/gate/title/progress/planSource/plan 回落初始', () => {
    const initial = payload()
    const migrated = migrateDirectorPersisted(
      {
        ...payload(),
        missionKind: 'unknown_kind',
        planSource: 'nope',
        missionCursor: -5,
        stats: { pending: 'x', running: -1, hosted: 4, savedHours: 2.1 },
        autonomy: { communicator: 'L9', steward: 3 },
        mission: {
          status: 'weird',
          kind: 'unknown_kind',
          title: '',
          progress: 150,
          gate: 'nope',
          planSource: 'nope',
          feed: [{ id: 'f1', agentId: 'nobody', text: 'x', at: 'y', kind: 'weird' }, 'garbage'],
          plan: [{ id: '', title: '' }, { id: 't1', agentId: 'nobody', title: '保留', seconds: -1 }],
          doneTasks: ['t1', 5],
        },
      },
      initial,
    )
    /* kind / 计划 / planSource 回落初始模板（parent_meeting） */
    expect(migrated.mission.status).toBe('planning')
    expect(migrated.missionKind).toBe('parent_meeting')
    expect(migrated.planSource).toBe('template')
    expect(migrated.mission.kind).toBe('parent_meeting')
    expect(migrated.mission.title).toBe(initial.mission.title)
    expect(migrated.mission.progress).toBe(100)
    expect(migrated.mission.gate).toBeNull()
    expect(migrated.missionCursor).toBe(0)
    expect(migrated.stats.pending).toBe(initial.stats.pending)
    expect(migrated.stats.running).toBe(initial.stats.running)
    expect(migrated.autonomy.chief).toBe(initial.autonomy.chief)
    expect(migrated.autonomy.communicator).toBe(initial.autonomy.communicator)
    /* 坏 feed 条目被归一（非法 agent/kind 回默认，非字符串项丢弃）；plan 里唯一合法任务保留并补默认 seconds */
    expect(migrated.mission.feed).toHaveLength(1)
    expect(migrated.mission.feed[0]).toMatchObject({ id: 'f1', agentId: 'chief', text: 'x', at: 0, kind: 'step' })
    expect(migrated.mission.plan).toHaveLength(1)
    expect(migrated.mission.plan[0]).toMatchObject({ id: 't1', title: '保留', agentId: 'chief', seconds: 60 })
    expect(migrated.mission.doneTasks).toEqual(['t1'])
  })

  it('plan 全非法 → 回落初始模板计划；decisions 全非法 → 回落初始决策', () => {
    const initial = payload({
      decisions: [decision('d-fallback')],
    })
    const migrated = migrateDirectorPersisted(
      { ...payload(), decisions: [{}, { id: '' }], mission: { ...MISSION, plan: [null, 'x', { id: 'ok' }] } },
      initial,
    )
    expect(migrated.decisions.map((d) => d.id)).toEqual(['d-fallback'])
    expect(migrated.mission.plan).toEqual(initial.mission.plan)
  })

  it('missionKind / planSource 以顶层契约字段为准并同步进 mission', () => {
    const initial = payload()
    const migrated = migrateDirectorPersisted(
      {
        ...payload(),
        missionKind: 'exam_loop',
        planSource: 'llm',
        mission: { ...MISSION, kind: 'parent_meeting', planSource: 'template' },
      },
      initial,
    )
    expect(migrated.missionKind).toBe('exam_loop')
    expect(migrated.mission.kind).toBe('exam_loop')
    expect(migrated.planSource).toBe('llm')
    expect(migrated.mission.planSource).toBe('llm')
  })

  it('cursor 归一：负数 / 小数 / 非数字', () => {
    const initial = payload()
    expect(migrateDirectorPersisted({ ...payload(), missionCursor: -3 }, initial).missionCursor).toBe(0)
    expect(migrateDirectorPersisted({ ...payload(), missionCursor: 3.7 }, initial).missionCursor).toBe(3)
    expect(migrateDirectorPersisted({ ...payload(), missionCursor: 'x' }, initial).missionCursor).toBe(0)
  })

  it('guideSeen 旧键合并后删除旧键，并把合并结果写回 v1', () => {
    provider.setItem(`edustudio:${DIRECTOR_PERSIST_KEY}`, JSON.stringify(payload({ guideSeen: false })))
    window.localStorage.setItem(DIRECTOR_LEGACY_GUIDE_KEY, '1')
    const loaded = loadDirectorPersisted(payload())
    expect(loaded.value.guideSeen).toBe(true)
    expect(window.localStorage.getItem(DIRECTOR_LEGACY_GUIDE_KEY)).toBeNull()
    const persisted = JSON.parse(provider.store.get(`edustudio:${DIRECTOR_PERSIST_KEY}`)!) as PersistedDirectorV1
    expect(persisted.guideSeen).toBe(true)
  })

  it('只有旧引导键、没有 v1 载荷：迁移为 v1 并立刻写回，guideSeen 不丢', () => {
    window.localStorage.setItem(DIRECTOR_LEGACY_GUIDE_KEY, '1')
    const loaded = loadDirectorPersisted(payload())
    expect(loaded.hasPersisted).toBe(false)
    expect(loaded.value.guideSeen).toBe(true)
    expect(provider.store.has(`edustudio:${DIRECTOR_PERSIST_KEY}`)).toBe(true)
    expect(window.localStorage.getItem(DIRECTOR_LEGACY_GUIDE_KEY)).toBeNull()
  })

  it('合法数据往返：值保持、hasPersisted=true', () => {
    const original = payload({
      missionCursor: 4,
      mission: { ...JSON.parse(JSON.stringify(MISSION)) as MissionState, status: 'waiting', gate: 'speech' },
      facts: [fact(1), fact(2)],
      decisions: [decision('d-1')],
      guideSeen: true,
    })
    provider.setItem(`edustudio:${DIRECTOR_PERSIST_KEY}`, JSON.stringify(original))
    const loaded = loadDirectorPersisted(payload())
    expect(loaded.hasPersisted).toBe(true)
    expect(loaded.recovered).toBe(false)
    expect(loaded.value.missionCursor).toBe(4)
    expect(loaded.value.mission.status).toBe('waiting')
    expect(loaded.value.mission.gate).toBe('speech')
    expect(loaded.value.facts).toHaveLength(2)
    expect(loaded.value.decisions.map((d) => d.id)).toEqual(['d-1'])
    expect(loaded.value.guideSeen).toBe(true)
  })

  it('体积：满额载荷远低于 30KB 上限', () => {
    const big = payload({
      decisions: Array.from({ length: DIRECTOR_DECISIONS_MAX }, (_, i) => decision(`d-${i}`)),
      facts: Array.from({ length: DIRECTOR_FACTS_MAX }, (_, i) => fact(i)),
      mission: {
        ...JSON.parse(JSON.stringify(MISSION)) as MissionState,
        feed: Array.from({ length: DIRECTOR_FEED_MAX }, (_, i) => feedItem(i)),
        doneTasks: ['t1', 't2'],
        planReason: 'mock_mode',
        startedAt: 1_700_000_000_000,
      },
    })
    expect(JSON.stringify(big).length).toBeLessThan(DIRECTOR_PERSIST_MAX_BYTES)
  })
})

describe('合并写盘（300ms 防抖 + 切片比对 + 强制 flush）', () => {
  let provider: ReturnType<typeof memoryProvider>

  beforeEach(() => {
    vi.useFakeTimers()
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
    vi.useRealTimers()
    setDataProvider(localStorageProvider)
  })

  it('schedule 后 300ms 才落盘；updatedAt 变化不算切片变化', () => {
    const first = payload()
    expect(scheduleDirectorPersist(first)).toBe(true)
    expect(hasPendingDirectorPersist()).toBe(true)
    /* 同一份切片（updatedAt 不同 / 瞬态变化不在这里体现）不重复排队 */
    expect(scheduleDirectorPersist({ ...first, updatedAt: first.updatedAt + 5000 })).toBe(false)
    vi.advanceTimersByTime(299)
    expect(provider.store.has(`edustudio:${DIRECTOR_PERSIST_KEY}`)).toBe(false)
    vi.advanceTimersByTime(1)
    expect(provider.store.has(`edustudio:${DIRECTOR_PERSIST_KEY}`)).toBe(true)
    expect(hasPendingDirectorPersist()).toBe(false)
    const written = JSON.parse(provider.store.get(`edustudio:${DIRECTOR_PERSIST_KEY}`)!) as PersistedDirectorV1
    expect(written.schemaVersion).toBe(1)
    expect(written.updatedAt).not.toBe(0)
  })

  it('flush 立即写出待写快照', () => {
    scheduleDirectorPersist(payload())
    flushDirectorPersist()
    expect(provider.store.has(`edustudio:${DIRECTOR_PERSIST_KEY}`)).toBe(true)
    expect(hasPendingDirectorPersist()).toBe(false)
  })

  it('cancel 丢弃待写快照：不会把旧状态写回（reset/清库前置）', () => {
    scheduleDirectorPersist(payload())
    cancelDirectorPersist()
    vi.advanceTimersByTime(1000)
    expect(provider.store.has(`edustudio:${DIRECTOR_PERSIST_KEY}`)).toBe(false)
  })

  it('writeDirectorPersist 关键节点立即落盘并清掉待写', () => {
    scheduleDirectorPersist(payload())
    writeDirectorPersist(payload({ missionKind: 'exam_loop', mission: { ...MISSION, kind: 'exam_loop' } }))
    expect(hasPendingDirectorPersist()).toBe(false)
    vi.advanceTimersByTime(1000)
    const written = JSON.parse(provider.store.get(`edustudio:${DIRECTOR_PERSIST_KEY}`)!) as PersistedDirectorV1
    expect(written.missionKind).toBe('exam_loop')
  })

  it('切片变化会重新排队并写最新值', () => {
    scheduleDirectorPersist(payload())
    scheduleDirectorPersist(payload({ missionCursor: 5 }))
    vi.advanceTimersByTime(300)
    const written = JSON.parse(provider.store.get(`edustudio:${DIRECTOR_PERSIST_KEY}`)!) as PersistedDirectorV1
    expect(written.missionCursor).toBe(5)
  })
})
