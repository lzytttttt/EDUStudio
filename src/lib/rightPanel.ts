import type { RoleId } from '../harness/types'
import type { DirectorAgentId } from '../harness/director/types'
import { DIRECTOR_AGENT_IDS, DIRECTOR_AGENT_LABELS, type StudioTeamSummary } from '../studio/contracts'

/** 右栏 tab（v0.9.3 P0-A：由 RightPanel 本地状态上移到 uiStore，便于跨组件联动）
 *  v1.2 M2：新增只读「团队」tab（roadmap §2.3 F9）；DEFAULT_RIGHT_TAB 保持不变。 */
export type RightTab = 'doc' | 'board' | 'flow' | 'team'

/** 角色主工作台默认右栏 tab（v0.9.2 P0-B：教师进工作台即见「出题工作台」） */
export const DEFAULT_RIGHT_TAB: Record<RoleId, RightTab> = {
  teacher: 'board',
  schoolAdmin: 'board',
  bureau: 'flow',
}

/** 角色主工作台名称（v0.9.3 P0-A ③：中栏 / 文档面板「返回主工作台」提示复用） */
export const BOARD_LABEL: Record<RoleId, string> = {
  teacher: '出题工作台',
  schoolAdmin: '校情驾驶舱',
  bureau: '区域看板',
}

/* ------------------------------------------------------------------ */
/* v1.2 M2 · 右栏只读「团队」摘要（roadmap §2.3 F9 / §3.8）              */
/* 纯函数导出供单测（无 JSX 测试环境）；组件 TeamSummaryPanel 只做渲染。  */
/* ------------------------------------------------------------------ */

/** 成员运行时状态（与 StudioTeamSummary.agents[].status 同域） */
export type TeamAgentStatus = 'idle' | 'running' | 'waiting'

/** 一行只读团队摘要：成员 id / 展示名 / 状态 */
export interface TeamSummaryRow {
  id: DirectorAgentId
  label: string
  status: TeamAgentStatus
}

/** 状态短词（少字；授权编辑仍只在战队页，右栏只读） */
export const TEAM_STATUS_LABEL: Record<TeamAgentStatus, string> = {
  idle: '空闲',
  running: '执行中',
  waiting: '等待拍板',
}

/** 状态点颜色（复用既有 token，不新增色相） */
export const TEAM_STATUS_DOT: Record<TeamAgentStatus, string> = {
  idle: 'bg-ink-mute/40',
  running: 'bg-primary',
  waiting: 'bg-amber',
}

/**
 * digest.team → 6 位固定成员的只读行（缺省 = 全员 idle；未知成员状态回落 idle）。
 * 顺序固定为 DIRECTOR_AGENT_IDS（展示稳定，不随事件流抖动）。
 */
export function buildTeamSummaryRows(team?: StudioTeamSummary): TeamSummaryRow[] {
  const statusById = new Map<DirectorAgentId, TeamAgentStatus>()
  for (const agent of team?.agents ?? []) statusById.set(agent.id, agent.status)
  return DIRECTOR_AGENT_IDS.map((id) => ({
    id,
    label: DIRECTOR_AGENT_LABELS[id],
    status: statusById.get(id) ?? 'idle',
  }))
}

/** 待批准数：优先团队摘要，其次 digest.pendingDecisions；非负整数（只读派生，不硬编码） */
export function teamPendingApprovals(team?: StudioTeamSummary, pendingDecisions = 0): number {
  const fromTeam = team?.pendingApprovals
  /* 脏值（负数 / NaN / 小数）在展示层收敛，不写回投影 */
  const raw = Number.isFinite(fromTeam) ? (fromTeam as number) : pendingDecisions
  return Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0
}
