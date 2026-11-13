/**
 * 战情台视图壳（v1.2 M1-B → M2 派生收件箱，总指挥 lazy chunk）
 *
 * 统一外壳只认识 `SurfaceProps`；本文件把旧整屏的 `InboxSurface`（默认导出、无 props）
 * 挂进 SurfaceHost，不复制其内部实现，也不改旧文件。
 *
 * v1.2 M2（roadmap §2.3 F1/F6、§2.4）：把主 chunk 的派生收件箱（`useStudioInbox`）注入
 * `InboxSurface.derived`，战情台「决策区」改为同源待办列表（简报采纳 / mission 门 / 下发回执 /
 * 通知升级四类来源，与导航角标、顶栏收件箱同一口径，双计数为 0）。
 * - 打开：带 `action.kind==='chat'` 的条目（如简报采纳）跳经典工作区对应会话；
 *   其余条目先落到作战室（M2 只做「同一事实」可达，具体深链由 M3+ 补）；
 * - 完成 / 稍后：写收件箱覆盖态（`resolve` / `snooze`），不写任务本体（§2.4「决策」行）。
 *
 * 深链（最小实现）：`?view=inbox&id=dec-1` → target={kind:'decision', id}
 * - 位移到对应决策卡（`director-decision-*` / `command-inbox-item`），只滚动、不自动展开 Sheet；
 * - 卡片不存在（已处理 / snoozed / id 非法）静默忽略，不报错。
 */
import { useEffect } from 'react'
import type { SurfaceProps } from '../../shell/SurfaceHost'
import { navigateTo } from '../../studio/router'
import { inboxCounts, useStudioInbox, useStudioInboxStore } from '../../stores/studioInboxStore'
import InboxSurface, { type InboxDerivedSource } from '../director/InboxSurface'

/** 首帧 d-rise 入场（≤420ms）后再定位，避免滚到未布局的元素 */
const DEEPLINK_DELAY_MS = 80
/** 「稍后」默认延后 30 分钟（M2 固定值；M3 接设置页前不做用户自定义） */
const SNOOZE_MS = 30 * 60 * 1000

export default function InboxView({ target }: SurfaceProps): JSX.Element {
  const decisionId = target?.kind === 'decision' ? target.id : null
  /** 派生收件箱（gate / briefing / taskFlow / notice 四类来源；与角标同一 selector） */
  const inbox = useStudioInbox()
  const counts = inboxCounts(inbox)

  const derived: InboxDerivedSource = {
    decisions: inbox.decisions,
    /** 待决策数 = decisions.length（与 `studio-nav-inbox-badge` 完全同口径，不含 notices） */
    pendingCount: counts.decisions,
    onOpen: (item) => {
      if (item.action?.kind === 'chat') {
        /* 「点开看会话」：经典工作区 + 对应会话（ShellLayout 会把 chatStore 定位到该会话） */
        navigateTo({ kind: 'chat', id: item.action.sessionId })
        return
      }
      navigateTo({ kind: 'mission' })
    },
    onResolve: (id) => useStudioInboxStore.getState().resolve(id),
    onSnooze: (id) => useStudioInboxStore.getState().snooze(id, Date.now() + SNOOZE_MS),
  }

  useEffect(() => {
    if (!decisionId) return
    const timer = window.setTimeout(() => {
      try {
        const el = document.querySelector<HTMLElement>(
          `[data-testid="director-decision-${decisionId}"], [data-testid="command-inbox-item"][data-id="${decisionId}"]`,
        )
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      } catch {
        /* 非法 id（含引号等）选择器会抛错：深链降级为「只到战情台」，不打扰用户 */
      }
    }, DEEPLINK_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [decisionId])

  return (
    <div data-testid="command-view-inbox" className="h-full">
      <InboxSurface derived={derived} />
    </div>
  )
}
