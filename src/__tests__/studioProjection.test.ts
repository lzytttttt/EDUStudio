/**
 * v1.2 M0 · StudioDigest 只读投影单测（roadmap §2.4 / §3.1 规则 3 / §3.4）
 * 覆盖：mission 生命周期、runningTasks 由计划数-完成数推导、progress 完成比、gate 幂等/不为负、
 *      artifact/notice 口径、未知事件、不可变性、≤1KB 预算与规范序列化。
 */
import { describe, expect, it } from 'vitest'
import {
  applyStudioDigest,
  digestSize,
  emptyDigest,
  isDigestWithinBudget,
  serializeDigest,
} from '../studio/projection'
import type { ApprovalGate, StudioEvent } from '../studio/contracts'

/** 构造审批门（只填投影需要的 gateId，其余按契约补默认） */
const gate = (gateId: string): ApprovalGate => ({
  gateId,
  source: 'mission',
  title: `门 ${gateId}`,
  requiredAction: 'approve',
  sensitive: false,
})

const planned = (missionId = 'm-1', tasks = 4): StudioEvent => ({
  type: 'mission.planned',
  missionId,
  kind: 'parent_meeting',
  planSource: 'template',
  tasks,
})

const started = (missionId = 'm-1'): StudioEvent => ({
  type: 'mission.started',
  missionId,
  execution: 'mock',
})

const taskDone = (missionId = 'm-1', taskId = 't-1'): StudioEvent => ({
  type: 'mission.task.done',
  missionId,
  taskId,
  agentId: 'analyst',
})

describe('StudioDigest 只读投影（v1.2 M0）', () => {
  it('emptyDigest 全 0、无 activeMission，序列化可解析且键序固定', () => {
    const digest = emptyDigest()
    expect(digest).toEqual({
      pendingDecisions: 0,
      runningMissions: 0,
      runningTasks: 0,
      unreadDocs: 0,
      updatedAt: 0,
    })
    expect(digest.activeMission).toBeUndefined()

    const raw = serializeDigest(digest)
    expect(Object.keys(JSON.parse(raw))).toEqual([
      'pendingDecisions',
      'runningMissions',
      'runningTasks',
      'unreadDocs',
      'updatedAt',
    ])
    expect(serializeDigest(digest)).toBe(raw) // 稳定序列化
  })

  it('mission.planned：runningMissions+1、runningTasks=计划数、activeMission 一行摘要，pending 不硬编码', () => {
    const plannedDigest = applyStudioDigest(emptyDigest(), planned('m-1', 4))
    expect(plannedDigest.runningMissions).toBe(1)
    expect(plannedDigest.runningTasks).toBe(4)
    expect(plannedDigest.pendingDecisions).toBe(0) // 计划事件不产生决策计数
    expect(plannedDigest.activeMission).toEqual({
      id: 'm-1',
      title: '家长会筹备',
      progress: 0,
      status: 'planning',
    })
    expect(plannedDigest.updatedAt).toBe(1)
  })

  it('mission.started：已有摘要标 running；无 planned 乱序时也补摘要且 runningMissions ≥1', () => {
    let digest = applyStudioDigest(emptyDigest(), planned('m-1', 3))
    digest = applyStudioDigest(digest, started('m-1'))
    expect(digest.activeMission?.status).toBe('running')
    expect(digest.runningMissions).toBe(1)

    const orphan = applyStudioDigest(emptyDigest(), started('m-9'))
    expect(orphan.runningMissions).toBe(1)
    expect(orphan.activeMission?.id).toBe('m-9')
    expect(orphan.activeMission?.status).toBe('running')
  })

  it('mission.task.done：runningTasks=计划数-完成数，progress 用完成比', () => {
    let digest = applyStudioDigest(emptyDigest(), planned('m-1', 4))
    digest = applyStudioDigest(digest, started('m-1'))

    digest = applyStudioDigest(digest, taskDone('m-1', 't-1'))
    expect(digest.runningTasks).toBe(3)
    expect(digest.activeMission?.progress).toBe(25)

    digest = applyStudioDigest(digest, taskDone('m-1', 't-2'))
    expect(digest.runningTasks).toBe(2)
    expect(digest.activeMission?.progress).toBe(50)

    digest = applyStudioDigest(digest, taskDone('m-1', 't-3'))
    expect(digest.runningTasks).toBe(1)
    expect(digest.activeMission?.progress).toBe(75)

    digest = applyStudioDigest(digest, taskDone('m-1', 't-4'))
    expect(digest.runningTasks).toBe(0)
    expect(digest.activeMission?.progress).toBe(100)
  })

  it('mission 生命周期：planned → started → task.done → partial → delivered 收口归 0', () => {
    let digest = emptyDigest()
    digest = applyStudioDigest(digest, planned('m-1', 3))
    digest = applyStudioDigest(digest, started('m-1'))
    digest = applyStudioDigest(digest, taskDone('m-1'))
    digest = applyStudioDigest(digest, { type: 'mission.partial', missionId: 'm-1', failedTasks: ['t-2'], reason: 'timeout' })
    expect(digest.runningMissions).toBe(1)
    expect(digest.runningTasks).toBe(0)

    digest = applyStudioDigest(digest, { type: 'mission.delivered', missionId: 'm-1', artifactIds: ['doc-1'] })
    expect(digest.runningMissions).toBe(0)
    expect(digest.runningTasks).toBe(0)
    expect(digest.activeMission).toBeUndefined()
    expect(digest.unreadDocs).toBe(0) // 交付物未读只由 artifact.published 计
  })

  it('gate.waiting 按 gateId 幂等：同一 gate 重复事件不重复计数，不同 gate 累加', () => {
    const first = gate('g-1')
    let digest = emptyDigest()
    digest = applyStudioDigest(digest, { type: 'gate.waiting', gate: first })
    expect(digest.pendingDecisions).toBe(1)

    // 同一 gate 重复推送（总线重放/重入）→ 不重复计数
    const replay = applyStudioDigest(digest, { type: 'gate.waiting', gate: first })
    expect(replay.pendingDecisions).toBe(1)
    expect(replay.updatedAt).toBe(digest.updatedAt)

    digest = applyStudioDigest(replay, { type: 'gate.waiting', gate: gate('g-2') })
    expect(digest.pendingDecisions).toBe(2)

    digest = applyStudioDigest(digest, { type: 'gate.resolved', gateId: 'g-1', resolution: 'continue' })
    expect(digest.pendingDecisions).toBe(1)
  })

  it('gate.resolved 不落到负：未知门不递减，重复 resolved 幂等', () => {
    let digest = applyStudioDigest(emptyDigest(), { type: 'gate.resolved', gateId: 'g-unknown', resolution: 'cancel' })
    expect(digest.pendingDecisions).toBe(0)

    digest = applyStudioDigest(digest, { type: 'gate.waiting', gate: gate('g-1') })
    digest = applyStudioDigest(digest, { type: 'gate.resolved', gateId: 'g-1', resolution: 'continue' })
    expect(digest.pendingDecisions).toBe(0)

    digest = applyStudioDigest(digest, { type: 'gate.resolved', gateId: 'g-1', resolution: 'continue' })
    expect(digest.pendingDecisions).toBe(0) // 重复解决不重复递减
  })

  it('artifact.published 累加 unreadDocs；notice.push 只读不累加 pendingDecisions', () => {
    let digest = emptyDigest()
    digest = applyStudioDigest(digest, { type: 'artifact.published', docId: 'doc-1', title: '家长会讲稿' })
    digest = applyStudioDigest(digest, { type: 'artifact.published', docId: 'doc-2', title: '分层练习单' })
    expect(digest.unreadDocs).toBe(2)

    const pendingBefore = digest.pendingDecisions
    const updatedBefore = digest.updatedAt
    digest = applyStudioDigest(digest, {
      type: 'notice.push',
      notice: { id: 'n-1', source: 'notice', refId: 'r-1', title: '提醒' },
    })
    expect(digest.pendingDecisions).toBe(pendingBefore) // notice 只读，不参与决策计数
    expect(digest.updatedAt).toBe(updatedBefore + 1)
  })

  it('未知/不消费事件内容原样返回，但返回新对象（不可变语义）', () => {
    const digest = applyStudioDigest(emptyDigest(), planned('m-1', 2))
    const next = applyStudioDigest(digest, { type: 'card.favorited', cardId: 'c-1', role: 'teacher', tag: 'x' })
    expect(next).toEqual(digest)
    expect(next).not.toBe(digest)
  })

  it('apply 不修改入参 digest，且每次返回新对象', () => {
    const digest = applyStudioDigest(emptyDigest(), planned('m-1', 4))
    const snapshot = JSON.parse(serializeDigest(digest))
    const next = applyStudioDigest(digest, taskDone('m-1', 't-1'))
    expect(next).not.toBe(digest)
    expect(JSON.parse(serializeDigest(digest))).toEqual(snapshot)
  })

  it('≤1KB 预算：摘要恒在 1024 字节内，体积按 UTF-8 字节计算', () => {
    const empty = emptyDigest()
    expect(digestSize(empty)).toBe(serializeDigest(empty).length) // 纯 ASCII：字节数=字符数

    let digest = applyStudioDigest(emptyDigest(), planned('m-' + 'x'.repeat(200), 8))
    digest = applyStudioDigest(digest, started('m-' + 'x'.repeat(200)))
    for (let index = 0; index < 6; index += 1) digest = applyStudioDigest(digest, taskDone('m-' + 'x'.repeat(200), `t-${index}`))
    digest = applyStudioDigest(digest, { type: 'gate.waiting', gate: gate('g-1') })

    expect(digestSize(digest)).toBeLessThanOrEqual(1024)
    expect(isDigestWithinBudget(digest)).toBe(true)
    // 中文标题按 UTF-8 计字节（大于字符数）
    expect(digestSize(digest)).toBeGreaterThan(serializeDigest(digest).length)
    // 边界：恰好等于上限时通过，少 1 字节时失败
    const size = digestSize(digest)
    expect(isDigestWithinBudget(digest, size)).toBe(true)
    expect(isDigestWithinBudget(digest, size - 1)).toBe(false)
  })

  it('serializeDigest 在 activeMission 缺省/存在时键序都可解析，且 JSON 往返不影响计数', () => {
    let digest = applyStudioDigest(emptyDigest(), planned('m-1', 2))
    const withActive = JSON.parse(serializeDigest(digest))
    expect(Object.keys(withActive)).toEqual([
      'pendingDecisions',
      'runningMissions',
      'runningTasks',
      'unreadDocs',
      'activeMission',
      'updatedAt',
    ])
    expect(Object.keys(withActive.activeMission)).toEqual(['id', 'title', 'progress', 'status'])

    digest = applyStudioDigest(digest, { type: 'mission.delivered', missionId: 'm-1', artifactIds: [] })
    const withoutActive = JSON.parse(serializeDigest(digest))
    expect('activeMission' in withoutActive).toBe(false)
    expect(withoutActive.runningMissions).toBe(0)
  })
})
