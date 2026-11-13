/**
 * v1.2 M4 · schema v1 → v2 迁移矩阵单测（roadmap §5.3 / 附录 C1）
 *
 * 覆盖：六状态恢复矩阵、字段一一映射（mission/runtime/decisions/autonomy/facts/guideSeen/
 * execution/artifactIds/intake/stale）、损坏字段回落、幂等、体积与「绝不抛」。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { migrateDirectorPersisted, migrateV1toV2, toPersistedDirector } from '../stores/directorPersistence'
import type {
  AutonomyLevel,
  DecisionItem,
  DirectorAgentId,
  Fact,
  MissionState,
  PersistedDirectorV1,
  PersistedDirectorV2,
} from '../harness/director/types'

const AUTONOMY: Record<DirectorAgentId, AutonomyLevel> = {
  chief: 'L2',
  analyst: 'L2',
  assessor: 'L2',
  curriculum: 'L2',
  communicator: 'L1',
  steward: 'L3',
}

const MISSION: MissionState = {
  status: 'waiting',
  kind: 'exam_loop',
  title: '单元考闭环',
  progress: 46,
  feed: [{ id: 'f-1', agentId: 'analyst', text: '核对完成', at: 1, kind: 'step' }],
  plan: [
    { id: 't1', agentId: 'analyst', title: '核对单元考数据', seconds: 40 },
    { id: 't2', agentId: 'assessor', title: '分层练习单', seconds: 90, gate: 'worksheet', deps: ['t1'] },
  ],
  doneTasks: ['t1'],
  gate: 'worksheet',
  planSource: 'llm',
  planReason: 'mock_mode',
  startedAt: 1_700_000_000_000,
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
    preview: { rows: [] },
    status: 'new',
  }
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

function v1(overrides: Partial<PersistedDirectorV1> = {}): PersistedDirectorV1 {
  return {
    schemaVersion: 1,
    updatedAt: 1_700_000_000_000,
    decisions: [decision('d-1')],
    stats: { pending: 2, running: 1, hosted: 4, savedHours: 2.1 },
    mission: JSON.parse(JSON.stringify(MISSION)) as MissionState,
    missionKind: 'exam_loop',
    missionCursor: 7,
    planSource: 'llm',
    autonomy: { ...AUTONOMY },
    guideSeen: true,
    facts: [fact(1)],
    ...overrides,
  }
}

function v2Initial(): PersistedDirectorV2 {
  return toPersistedDirector(
    {
      decisions: [],
      stats: { pending: 0, running: 0, hosted: 0, savedHours: 0 },
      mission: JSON.parse(JSON.stringify({ ...MISSION, status: 'idle', progress: 0, feed: [], doneTasks: [], gate: null })),
      missionCursor: 0,
      planSource: 'template',
      autonomy: { ...AUTONOMY },
      facts: [],
    },
    false,
  )
}

describe('migrateV1toV2 · 字段一一映射', () => {
  it('基础映射：schemaVersion=2 / missionKind→mission.kind / planSource / decisions / stats / facts', () => {
    const migrated = migrateV1toV2(v1(), 123)
    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.updatedAt).toBe(1_700_000_000_000)
    expect(migrated.mission.kind).toBe('exam_loop')
    expect(migrated.mission.planSource).toBe('llm')
    expect(migrated.mission.title).toBe('单元考闭环')
    expect(migrated.stats).toEqual({ pending: 2, running: 1, hosted: 4, savedHours: 2.1 })
    expect(migrated.decisions).toHaveLength(1)
    expect(migrated.facts).toHaveLength(1)
    expect(migrated.autonomy).toEqual(AUTONOMY)
    expect(migrated.migrations).toEqual([{ from: 1, at: 123 }])
  })

  it('missionCursor → mission.runtime.cursor；doneTasks 并入 runtime.completedTasks（去重）', () => {
    const migrated = migrateV1toV2(v1({ mission: { ...MISSION, doneTasks: ['t1', 't1'] } }))
    expect(migrated.mission.runtime.cursor).toBe(7)
    expect(migrated.mission.runtime.completedTasks).toEqual(['t1'])
  })

  it('optional execution（M3 过渡字段）→ mission.runtime', () => {
    const migrated = migrateV1toV2(
      v1({
        execution: {
          mode: 'real',
          missionId: 'm-9',
          outcome: 'partial',
          startedAt: 1_700_000_000_000,
          finishedAt: 1_700_000_009_000,
          completedTasks: ['t1', 't3'],
          failedTasks: [{ taskId: 't2', reason: '超时' }],
          attempts: 3,
        },
      }),
    )
    expect(migrated.mission.runtime.execution).toBe('real')
    expect(migrated.mission.runtime.outcome).toBe('partial')
    expect(migrated.mission.runtime.completedTasks).toEqual(['t1', 't3'])
    expect(migrated.mission.runtime.failedTasks).toEqual([{ taskId: 't2', reason: '超时' }])
    expect(migrated.mission.runtime.attempts).toBe(3)
    expect(migrated.mission.runtime.startedAt).toBe(1_700_000_000_000)
    expect(migrated.mission.runtime.finishedAt).toBe(1_700_000_009_000)
  })

  it('artifactIds / intake / stale 原样搬迁；guideSeen 仅作迁移来源保留', () => {
    const migrated = migrateV1toV2(
      v1({
        artifactIds: ['doc-1', 'doc-2'],
        intake: { source: 'briefing', cardId: 'd-drill', sessionId: 's-1' },
        stale: true,
      }),
    )
    expect(migrated.artifactIds).toEqual(['doc-1', 'doc-2'])
    expect(migrated.intake).toEqual({ source: 'briefing', cardId: 'd-drill', sessionId: 's-1' })
    expect(migrated.stale).toBe(true)
    expect(migrated.guideSeen).toBe(true)
  })

  it('无 execution 的 v1 数据：runtime.execution 默认 mock、attempts=0', () => {
    const migrated = migrateV1toV2(v1())
    expect(migrated.mission.runtime.execution).toBe('mock')
    expect(migrated.mission.runtime.attempts).toBe(0)
    expect(migrated.mission.runtime.failedTasks).toEqual([])
  })
})

describe('migrateV1toV2 · 六状态恢复矩阵', () => {
  const cases: [MissionState['status'], MissionState['status']][] = [
    ['idle', 'idle'],
    ['planning', 'planning'],
    ['running', 'paused'],
    ['paused', 'paused'],
    ['waiting', 'waiting'],
    ['done', 'done'],
  ]
  for (const [from, to] of cases) {
    it(`${from} → ${to}`, () => {
      const migrated = migrateV1toV2(v1({ mission: { ...MISSION, status: from, gate: from === 'waiting' ? 'worksheet' : null } }))
      expect(migrated.mission.status).toBe(to)
    })
  }
})

describe('migrateDirectorPersisted · 兼容分派 / 损坏回落 / 幂等', () => {
  it('schemaVersion 1 → 迁移；schemaVersion 2 → 只做校验不回写 migrations', () => {
    const v2 = migrateDirectorPersisted(v1(), v2Initial())
    expect(v2.schemaVersion).toBe(2)
    expect(v2.migrations).toHaveLength(1)
    const again = migrateDirectorPersisted(v2, v2Initial())
    expect(again.migrations).toHaveLength(1)
    expect(again.updatedAt).toBe(v2.updatedAt)
  })

  it('损坏字段逐个回落：非法 status/kind/gate/decisions/autonomy/facts 不抛', () => {
    const broken = {
      ...v1(),
      mission: { ...MISSION, status: 'weird', kind: 'bad', gate: 'bad', plan: [{ id: 1 }] },
      decisions: [{ id: 1 }, { id: 'ok', title: '合法' }],
      autonomy: { chief: 'X9' },
      facts: [{ factId: 'f', key: 'k', value: 'x', unit: '分' }],
      artifactIds: [1, 'ok'],
    } as unknown
    expect(() => migrateDirectorPersisted(broken, v2Initial())).not.toThrow()
    const migrated = migrateDirectorPersisted(broken, v2Initial())
    expect(migrated.schemaVersion).toBe(2)
    expect(['idle', 'planning', 'paused', 'waiting', 'done']).toContain(migrated.mission.status)
    expect(Array.isArray(migrated.decisions)).toBe(true)
    expect(Array.isArray(migrated.facts)).toBe(true)
    expect(migrated.artifactIds).toEqual(['ok'])
  })

  it('未知版本 / 非对象 → 初始（绝不抛）', () => {
    const initial = v2Initial()
    for (const raw of [null, undefined, 0, 'x', [], { schemaVersion: 99 }]) {
      expect(() => migrateDirectorPersisted(raw, initial)).not.toThrow()
      expect(migrateDirectorPersisted(raw, initial)).toEqual(initial)
    }
  })

  it('迁移结果体积 <30KB（decisions/facts 截断后仍引用而非正文）', () => {
    const migrated = migrateV1toV2(v1())
    expect(JSON.stringify(migrated).length).toBeLessThan(30 * 1024)
  })

  it('迁移不改入参（纯函数）', () => {
    const input = v1()
    const snapshot = JSON.stringify(input)
    migrateV1toV2(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})
