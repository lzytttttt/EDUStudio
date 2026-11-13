/**
 * v1.2 M3a · mission 审批门投影（Director lazy chunk；roadmap §4.4）
 *
 * mission gate 与 Loom checkpoint 统一投影为 `ApprovalGate`（同一张决策卡）；
 * 本模块只做纯投影，不做等待 / 解决（等待由执行控制器实现 `MissionGateWaiter`，
 * 唯一出口 `resolveGate` 在 studio/gateRegistry，M3b 接线）。
 *
 * 硬门常量表（§4.4）：对外发送 / 不可逆动作恒 `sensitive: true`，L0–L3 授权不可上调；
 * v1.2 范围内家长信（letters）是唯一硬门，其余门可继续。
 */
import type { ApprovalGate, ExecutionPlan } from '../../studio/contracts'
import type { GateId } from '../director/types'
import type { MissionPlanTask } from '../director/types'

/** 硬门常量表：letters = 家长信对外发送（永不自动放行）；其余门非硬门 */
export const SENSITIVE_GATES: Record<GateId, boolean> = {
  speech: false,
  letters: true,
  worksheet: false,
  lesson: false,
}

/** 带门的任务（createMissionGate 只接受确实有 gate 的任务，避免把 undefined 写成 gateId） */
export type MissionGateTask = MissionPlanTask & { gate: GateId }

/**
 * task.gate → ApprovalGate（纯函数，不改入参）。
 * gateId 直接用 GateId（mission gate 与 Loom checkpoint 在收件箱按 gateId 去重）；
 * title 与 v1.1 剧本文案一致（「…待你过目」）。
 */
export function createMissionGate(plan: Pick<ExecutionPlan, 'missionId'>, task: MissionGateTask): ApprovalGate {
  const gateId = task.gate
  return {
    gateId,
    missionId: plan.missionId,
    taskId: task.id,
    source: 'mission',
    title: `${task.title}待你过目`,
    ownerAgentId: task.agentId,
    requiredAction: 'approve',
    sensitive: SENSITIVE_GATES[gateId] ?? false,
  }
}
