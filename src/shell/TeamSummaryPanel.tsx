/**
 * v1.2 M2 · 右栏只读「团队」摘要 TeamSummaryPanel（主 chunk，roadmap §2.3 F9 / §3.8）
 *
 * 数据唯一来源 `useStudioDigestStore.digest.team`（StudioBus 事件更新的只读投影）：
 * - 缺省（尚无 mission/gate 事件）= 6 位成员 idle，不读 Director 实体、不反向写入；
 * - 只展示「成员状态点 + 待批准数」，**不提供任何授权编辑入口**（授权编辑仍只在战队页，语义不同不混）。
 *
 * testid 约定（E2E / 视觉回归共用）：
 * - 容器 `team-summary`，待批准数 `team-summary-pending`，成员行 `team-summary-agent-<id>`。
 */
import { useStudioDigestStore } from '../stores/studioDigestStore'
import {
  TEAM_STATUS_DOT,
  TEAM_STATUS_LABEL,
  buildTeamSummaryRows,
  teamPendingApprovals,
} from '../lib/rightPanel'
import { cn } from '../lib/cn'

export default function TeamSummaryPanel(): JSX.Element {
  const team = useStudioDigestStore((s) => s.digest.team)
  const pendingDecisions = useStudioDigestStore((s) => s.digest.pendingDecisions)
  const rows = buildTeamSummaryRows(team)
  const pending = teamPendingApprovals(team, pendingDecisions)

  return (
    <div data-testid="team-summary" className="flex h-full w-full flex-col overflow-y-auto px-4 py-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">团队</h2>
        <span className="text-[0.625rem] text-ink-mute">只读 · 授权请到战队页</span>
      </div>

      {/* 待批准数：派生值（digest.team → 回落 digest.pendingDecisions），不硬编码 */}
      <div className="mt-2 flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2">
        <span className="text-xs text-ink-soft">待批准</span>
        <span data-testid="team-summary-pending" className="text-sm font-bold text-ink">
          {pending}
        </span>
      </div>

      <ul className="mt-3 space-y-1.5" aria-label="团队成员状态">
        {rows.map((row) => (
          <li
            key={row.id}
            data-testid={`team-summary-agent-${row.id}`}
            className="flex items-center gap-2.5 rounded-xl px-2 py-2 hover:bg-surface-2"
          >
            <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', TEAM_STATUS_DOT[row.status])} />
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{row.label}</span>
            <span className="shrink-0 text-[0.625rem] text-ink-mute">{TEAM_STATUS_LABEL[row.status]}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
