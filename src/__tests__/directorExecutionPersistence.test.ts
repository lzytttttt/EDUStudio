/**
 * v1.2 M3 · director 持久化 optional 增量单测（D11 过渡期纪律）
 *
 * 验证：schemaVersion 仍为 1、只增字段；execution/intake/artifactIds/stale 写出→读回保留；
 * 旧 v1 数据（无新字段）读回后行为不变；坏字段逐个丢弃；体积仍 <30KB。
 */
import { describe, expect, it } from 'vitest'
import {
  DIRECTOR_PERSIST_MAX_BYTES,
  DIRECTOR_SCHEMA_VERSION,
  emptyDirectorPersisted,
  migrateDirectorPersisted,
  toPersistedDirector,
  type DirectorPersistSource,
} from '../stores/directorPersistence'
import type { MissionState, PersistedDirectorV1 } from '../harness/director/types'

function mission(overrides: Partial<MissionState> = {}): MissionState {
  return {
    status: 'planning',
    kind: 'parent_meeting',
    title: '家长会筹备',
    progress: 0,
    feed: [],
    plan: [{ id: 't1', agentId: 'analyst', title: '核对学情', seconds: 60 }],
    doneTasks: [],
    gate: null,
    planSource: 'template',
    ...overrides,
  }
}

function source(overrides: Partial<DirectorPersistSource> = {}): DirectorPersistSource {
  return {
    decisions: [],
    stats: { pending: 0, running: 0, hosted: 0, savedHours: 0 },
    mission: mission(),
    missionCursor: 0,
    planSource: 'template',
    autonomy: { chief: 'L1', analyst: 'L1', assessor: 'L1', curriculum: 'L1', communicator: 'L1', steward: 'L1' },
    facts: [],
    ...overrides,
  }
}

describe('toPersistedDirector · M3 optional 增量', () => {
  it('缺省（旧 v1 形状）：不出现 execution/intake/artifactIds/stale 字段', () => {
    const payload = toPersistedDirector(source(), false)
    expect(payload.schemaVersion).toBe(DIRECTOR_SCHEMA_VERSION)
    expect('execution' in payload).toBe(false)
    expect('intake' in payload).toBe(false)
    expect('artifactIds' in payload).toBe(false)
    expect('stale' in payload).toBe(false)
  })

  it('写出现有 execution 元数据（missionId/outcome/failedTasks/attempts）', () => {
    const payload = toPersistedDirector(
      source({
        execution: {
          mode: 'real',
          missionId: 'm-1700000000000',
          outcome: 'partial',
          startedAt: 1700000000000,
          finishedAt: 1700000009000,
          completedTasks: ['t1'],
          failedTasks: [{ taskId: 't2', reason: '超时' }],
          attempts: 3,
        },
      }),
      false,
    )
    expect(payload.execution?.mode).toBe('real')
    expect(payload.execution?.outcome).toBe('partial')
    expect(payload.execution?.failedTasks?.[0]).toEqual({ taskId: 't2', reason: '超时' })
    expect(payload.execution?.attempts).toBe(3)
  })

  it('写出 intake / artifactIds / stale', () => {
    const payload = toPersistedDirector(
      source({
        intake: { source: 'briefing', cardId: 'd-drill' },
        artifactIds: ['doc-rt-m-1-t1', 'doc-rt-m-1-t2'],
        stale: true,
      }),
      false,
    )
    expect(payload.intake).toEqual({ source: 'briefing', cardId: 'd-drill' })
    expect(payload.artifactIds).toEqual(['doc-rt-m-1-t1', 'doc-rt-m-1-t2'])
    expect(payload.stale).toBe(true)
  })

  it('坏 execution/intake 被丢弃，不污染 v1 字段', () => {
    const payload = toPersistedDirector(
      source({
        execution: { mode: 'bad' } as never,
        intake: { source: 'bad' } as never,
        artifactIds: [1, 'ok'] as never,
      }),
      false,
    )
    expect(payload.execution).toBeUndefined()
    expect(payload.intake).toBeUndefined()
    expect(payload.artifactIds).toEqual(['ok'])
  })

  it('体积仍 <30KB（artifactIds 引用而非正文）', () => {
    const payload = toPersistedDirector(
      source({ artifactIds: Array.from({ length: 30 }, (_, i) => `doc-rt-m-1-t${i}`) }),
      true,
    )
    expect(JSON.stringify(payload).length).toBeLessThan(DIRECTOR_PERSIST_MAX_BYTES)
  })
})

describe('migrateDirectorPersisted · M3 optional 增量读回', () => {
  it('往返：写出 → 读回保留全部新字段', () => {
    const written = toPersistedDirector(
      source({
        execution: { mode: 'mock', missionId: 'm-1', outcome: 'done', completedTasks: ['t1'], attempts: 2 },
        intake: { source: 'inbox' },
        artifactIds: ['doc-1'],
      }),
      false,
    )
    const read = migrateDirectorPersisted(written, emptyDirectorPersisted(written))
    expect(read.execution).toEqual(written.execution)
    expect(read.intake).toEqual({ source: 'inbox' })
    expect(read.artifactIds).toEqual(['doc-1'])
  })

  it('旧 v1 数据（无新字段）：读回不产生新字段（行为不变）', () => {
    const written = toPersistedDirector(source(), false)
    const read = migrateDirectorPersisted(written, emptyDirectorPersisted(written))
    expect(read.execution).toBeUndefined()
    expect(read.intake).toBeUndefined()
    expect(read.artifactIds).toBeUndefined()
    expect(read.stale).toBeUndefined()
    expect(read.mission.status).toBe('planning')
  })

  it('刷新语义不变：running → paused（真执行中断由 controller/resume 处理）', () => {
    const written = toPersistedDirector(
      source({ mission: mission({ status: 'running' }), execution: { mode: 'real', missionId: 'm-2' } }),
      false,
    )
    const read = migrateDirectorPersisted(written, emptyDirectorPersisted(written))
    expect(read.mission.status).toBe('paused')
    expect(read.execution?.mode).toBe('real')
  })

  it('损坏的新字段逐个丢弃，其余字段仍可用', () => {
    const written = toPersistedDirector(source({ intake: { source: 'chat' } }), false) as PersistedDirectorV1
    const corrupted: PersistedDirectorV1 = {
      ...written,
      execution: { mode: 'nope', attempts: -2 } as never,
      artifactIds: ['ok', 42] as never,
    }
    const read = migrateDirectorPersisted(corrupted, emptyDirectorPersisted(written))
    expect(read.execution).toBeUndefined()
    expect(read.artifactIds).toEqual(['ok'])
    expect(read.intake).toEqual({ source: 'chat' })
  })
})
