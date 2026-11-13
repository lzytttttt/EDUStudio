/**
 * v1.2 M2 · 右栏只读「团队」摘要单测（roadmap §2.3 F9 / §3.8）
 *
 * 覆盖：RightTab 扩展 / DEFAULT_RIGHT_TAB 不变、digest.team 缺省 = 6 位成员 idle、
 * 状态映射与状态点、待批准数回落口径（无 JSX 测试环境：只测 lib 纯函数）。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RIGHT_TAB,
  TEAM_STATUS_DOT,
  TEAM_STATUS_LABEL,
  buildTeamSummaryRows,
  teamPendingApprovals,
  type RightTab,
  type TeamAgentStatus,
} from '../lib/rightPanel'
import { DIRECTOR_AGENT_IDS, DIRECTOR_AGENT_LABELS } from '../studio/contracts'
import { emptyDigest } from '../studio/projection'
import type { StudioTeamSummary } from '../studio/contracts'

describe('RightTab 扩展 / 默认值不变', () => {
  it('RightTab 增加 team，文档/工作台/下发旧值仍合法', () => {
    const tabs: RightTab[] = ['doc', 'board', 'flow', 'team']
    expect(tabs).toHaveLength(4)
    /* E2E 依赖的 tab testid 文案约定：'team' 即右栏「团队」 */
    const teamTab: RightTab = 'team'
    expect(teamTab).toBe('team')
  })

  it('DEFAULT_RIGHT_TAB 保持不变（教师/校=board，局=flow，默认不落到团队）', () => {
    expect(DEFAULT_RIGHT_TAB).toEqual({ teacher: 'board', schoolAdmin: 'board', bureau: 'flow' })
    expect(Object.values(DEFAULT_RIGHT_TAB)).not.toContain('team')
  })
})

describe('digest.team 缺省 = 6 位成员 idle', () => {
  it('无 team（空投影）→ 6 行、全员 idle、顺序固定为 DIRECTOR_AGENT_IDS', () => {
    const rows = buildTeamSummaryRows(undefined)
    expect(rows).toHaveLength(DIRECTOR_AGENT_IDS.length)
    expect(rows).toHaveLength(6)
    expect(rows.map((r) => r.id)).toEqual([...DIRECTOR_AGENT_IDS])
    expect(rows.every((r) => r.status === 'idle')).toBe(true)
  })

  it('emptyDigest 本身不含 team（缺省由展示层补 6 位 idle，不写投影）', () => {
    const digest = emptyDigest()
    expect(digest.team).toBeUndefined()
    expect(buildTeamSummaryRows(digest.team)).toHaveLength(6)
  })

  it('成员名来自 DIRECTOR_AGENT_LABELS（主 chunk 常量，不引 Director 实现）', () => {
    const rows = buildTeamSummaryRows(undefined)
    expect(rows.find((r) => r.id === 'chief')?.label).toBe('总指挥')
    expect(rows.find((r) => r.id === 'communicator')?.label).toBe('家校沟通')
    for (const row of rows) expect(row.label).toBe(DIRECTOR_AGENT_LABELS[row.id])
  })
})

describe('状态映射（idle/running/waiting）', () => {
  it('digest.team 的状态落到对应成员；未列出的成员回落 idle、仍是 6 行', () => {
    const team: StudioTeamSummary = {
      agents: [
        { id: 'chief', status: 'running' },
        { id: 'communicator', status: 'waiting' },
      ],
      pendingApprovals: 2,
    }
    const rows = buildTeamSummaryRows(team)
    expect(rows).toHaveLength(6)
    expect(rows.find((r) => r.id === 'chief')?.status).toBe('running')
    expect(rows.find((r) => r.id === 'communicator')?.status).toBe('waiting')
    expect(rows.filter((r) => r.status === 'idle')).toHaveLength(4)
  })

  it('状态短词与状态点覆盖全部 3 种状态', () => {
    const statuses: TeamAgentStatus[] = ['idle', 'running', 'waiting']
    expect(statuses.map((s) => TEAM_STATUS_LABEL[s])).toEqual(['空闲', '执行中', '等待拍板'])
    for (const status of statuses) expect(TEAM_STATUS_DOT[status]).toBeTruthy()
    expect(TEAM_STATUS_DOT.running).toBe('bg-primary')
    expect(TEAM_STATUS_DOT.waiting).toBe('bg-amber')
  })
})

describe('待批准数（派生，不硬编码）', () => {
  it('优先 team.pendingApprovals；team 缺省时回落 digest.pendingDecisions', () => {
    expect(teamPendingApprovals({ agents: [], pendingApprovals: 3 }, 9)).toBe(3)
    expect(teamPendingApprovals(undefined, 2)).toBe(2)
    expect(teamPendingApprovals(undefined)).toBe(0)
  })

  it('非负整数兜底：负数 / NaN / 小数不产生脏值', () => {
    expect(teamPendingApprovals({ agents: [], pendingApprovals: -1 }, 0)).toBe(0)
    expect(teamPendingApprovals({ agents: [], pendingApprovals: Number.NaN }, 4)).toBe(4)
    expect(teamPendingApprovals({ agents: [], pendingApprovals: 2.7 }, 0)).toBe(2)
  })
})
