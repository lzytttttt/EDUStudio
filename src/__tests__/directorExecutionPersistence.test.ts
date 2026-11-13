/**
 * v1.2 M3/M4 · 执行元数据持久化单测（v2 形状）
 *
 * 验证：execution/intake/artifactIds/stale 在 toPersistedDirector → migrate 往返后保留；
 * v2 runtime 坏字段回落；旧 v2 数据（无新字段）读回不产生副作用。
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
import type { MissionState, PersistedDirectorV2 } from '../harness/director/types'

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

function initial(): PersistedDirectorV2 {
  return toPersistedDirector(source(), false)
}

describe('toPersistedDirector · M3/M4 执行元数据（v2 runtime）', () => {
  it('缺省：runtime.execution=mock、migrations=[]、artifactIds=[]，不出现 intake', () => {
    const payload = toPersistedDirector(source(), false)
    expect(payload.schemaVersion).toBe(DIRECTOR_SCHEMA_VERSION)
    expect(payload.mission.runtime.execution).toBe('mock')
    expect(payload.mission.runtime.completedTasks).toEqual([])
    expect(payload.artifactIds).toEqual([])
    expect(payload.migrations).toEqual([])
    expect('intake' in payload).toBe(false)
  })

  it('写出 validation execution：missionId 不落盘（仅 runtime 语义字段）', () => {
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
    expect(payload.mission.runtime.execution).toBe('real')
    expect(payload.mission.runtime.outcome).toBe('partial')
    expect(payload.mission.runtime.failedTasks?.[0]).toEqual({ taskId: 't2', reason: '超时' })
    expect(payload.mission.runtime.attempts).toBe(3)
    expect(JSON.stringify(payload)).not.toContain('m-1700000000000')
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

  it('坏 execution/intake 被丢弃，artifactIds 过滤非字符串', () => {
    const payload = toPersistedDirector(
      source({
        execution: { mode: 'bad' } as never,
        intake: { source: 'bad' } as never,
        artifactIds: [1, 'ok'] as never,
      }),
      false,
    )
    expect(payload.mission.runtime.execution).toBe('mock')
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

describe('migrateDirectorPersisted · v2 执行字段读回', () => {
  it('v2 往返：runtime/artifactIds/intake 保留，migrations 不重复', () => {
    const written = toPersistedDirector(
      source({
        execution: { mode: 'real', outcome: 'done', completedTasks: ['t1'], attempts: 2 },
        intake: { source: 'inbox' },
        artifactIds: ['doc-1'],
        migrations: [{ from: 1, at: 5 }],
      }),
      false,
    )
    const read = migrateDirectorPersisted(written, emptyDirectorPersisted(written))
    expect(read.mission.runtime).toEqual(written.mission.runtime)
    expect(read.intake).toEqual({ source: 'inbox' })
    expect(read.artifactIds).toEqual(['doc-1'])
    expect(read.migrations).toEqual([{ from: 1, at: 5 }])
  })

  it('刷新语义不变：running → paused（真执行中断由控制器/resume 处理），runtime 保留', () => {
    const written = toPersistedDirector(
      source({
        mission: mission({ status: 'running' }),
        execution: { mode: 'real', outcome: undefined, completedTasks: ['t9'], attempts: 4 },
      }),
      false,
    )
    const read = migrateDirectorPersisted(written, emptyDirectorPersisted(written))
    expect(read.mission.status).toBe('paused')
    expect(read.mission.runtime.execution).toBe('real')
    expect(read.mission.runtime.completedTasks).toEqual(['t9'])
  })

  it('损坏的新字段逐个丢弃，其余字段仍可用', () => {
    const written = toPersistedDirector(source({ intake: { source: 'chat' } }), false)
    const corrupted: PersistedDirectorV2 = {
      ...written,
      mission: {
        ...written.mission,
        runtime: { execution: 'nope', attempts: -2, completedTasks: 'x' } as never,
      },
      artifactIds: ['ok', 42] as never,
    }
    const read = migrateDirectorPersisted(corrupted, emptyDirectorPersisted(written))
    expect(read.mission.runtime.execution).toBe('mock')
    expect(read.mission.runtime.attempts).toBe(0)
    expect(read.artifactIds).toEqual(['ok'])
    expect(read.intake).toEqual({ source: 'chat' })
  })
})
