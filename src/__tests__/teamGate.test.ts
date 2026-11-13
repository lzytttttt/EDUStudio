/**
 * v1.2 M3a · mission 审批门投影单测（roadmap §4.4）
 * 覆盖：字段映射 / 硬门常量表（letters=true）/ 未知门兜底 / 纯函数不改入参 / 不伪造证据字段。
 */
import { describe, expect, it } from 'vitest'
import type { ExecutionPlan } from '../studio/contracts'
import type { GateId, MissionPlanTask } from '../harness/director/types'
import { SENSITIVE_GATES, createMissionGate, type MissionGateTask } from '../harness/team/gate'
import { MISSION_AGENT_SPECS } from '../harness/team/agents'

const PLAN: Pick<ExecutionPlan, 'missionId'> = { missionId: 'm-1' }

const gateTask = (patch: Partial<MissionGateTask> = {}): MissionGateTask => ({
  id: 't3',
  agentId: 'communicator',
  title: '写 3 封家长信',
  seconds: 90,
  gate: 'letters',
  ...patch,
})

describe('createMissionGate · 字段映射', () => {
  it('gateId / missionId / taskId / source / ownerAgentId / requiredAction / title 全映射', () => {
    const gate = createMissionGate(PLAN, gateTask())
    expect(gate.gateId).toBe('letters')
    expect(gate.missionId).toBe('m-1')
    expect(gate.taskId).toBe('t3')
    expect(gate.source).toBe('mission')
    expect(gate.ownerAgentId).toBe('communicator')
    expect(gate.requiredAction).toBe('approve')
    expect(gate.title).toBe('写 3 封家长信待你过目')
  })

  it('不伪造可编辑目标与证据（evidence / editableTarget 缺省 undefined，由发布链接入）', () => {
    const gate = createMissionGate(PLAN, gateTask({ gate: 'speech' }))
    expect(gate.editableTarget).toBeUndefined()
    expect(gate.evidence).toBeUndefined()
  })
})

describe('SENSITIVE_GATES · 硬门常量表', () => {
  it('letters = true（家长信对外发送，永不自动放行）', () => {
    expect(SENSITIVE_GATES.letters).toBe(true)
    expect(createMissionGate(PLAN, gateTask({ gate: 'letters' })).sensitive).toBe(true)
  })

  it('speech / worksheet / lesson = false（可继续的门）', () => {
    expect(SENSITIVE_GATES.speech).toBe(false)
    expect(SENSITIVE_GATES.worksheet).toBe(false)
    expect(SENSITIVE_GATES.lesson).toBe(false)
    expect(createMissionGate(PLAN, gateTask({ gate: 'speech' })).sensitive).toBe(false)
    expect(createMissionGate(PLAN, gateTask({ gate: 'worksheet' })).sensitive).toBe(false)
    expect(createMissionGate(PLAN, gateTask({ gate: 'lesson' })).sensitive).toBe(false)
  })

  it('常量表覆盖 GateId 全部四项（新增门必须先登记硬门属性）', () => {
    const gateIds: GateId[] = ['speech', 'letters', 'worksheet', 'lesson']
    expect(Object.keys(SENSITIVE_GATES).sort()).toEqual([...gateIds].sort())
    for (const gateId of gateIds) expect(typeof SENSITIVE_GATES[gateId]).toBe('boolean')
  })

  it('未知 gate 运行时兜底 sensitive=false（不因脏数据误报硬门）', () => {
    const gate = createMissionGate(PLAN, gateTask({ gate: 'unknown' as GateId }))
    expect(gate.sensitive).toBe(false)
    expect(gate.gateId).toBe('unknown')
  })
})

describe('createMissionGate · 纯函数', () => {
  it('同输入返回等值对象，且不修改 plan / task 入参', () => {
    const plan = { missionId: 'm-9' }
    const task = gateTask()
    const snapshot = JSON.stringify({ plan, task })
    const first = createMissionGate(plan, task)
    const second = createMissionGate(plan, task)
    expect(first).toEqual(second)
    expect(JSON.stringify({ plan, task })).toBe(snapshot)
  })

  it('门标题使用任务标题原文拼接（与 v1.1 剧本文案一致）', () => {
    expect(createMissionGate(PLAN, gateTask({ title: '分层练习单（基础 70%／提高 30%）', gate: 'worksheet' })).title).toBe(
      '分层练习单（基础 70%／提高 30%）待你过目',
    )
  })

  it('执行成员 id 原样带入 ownerAgentId（6 个成员均可进门）', () => {
    for (const id of Object.keys(MISSION_AGENT_SPECS) as (keyof typeof MISSION_AGENT_SPECS)[]) {
      const task: MissionGateTask = { id: 't-x', agentId: id, title: '过目', seconds: 5, gate: 'speech' }
      expect(createMissionGate(PLAN, task).ownerAgentId).toBe(id)
    }
  })

  it('MissionPlanTask（无 gate）不能直接构造门 —— 类型层由 MissionGateTask 收紧', () => {
    const plain: MissionPlanTask = { id: 't1', agentId: 'analyst', title: '学情', seconds: 5 }
    // @ts-expect-error 普通任务（gate 缺省）不得传给 createMissionGate，避免 undefined 写成 gateId
    expect(() => createMissionGate(PLAN, plain)).toBeTypeOf('function')
  })
})
