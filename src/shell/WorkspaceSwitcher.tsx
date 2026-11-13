/**
 * v1.2 M1 · 工作区切换分段控件（主 chunk，roadmap §2.2 / §3.3）
 *
 * 一级导航：总指挥 ⇄ 经典。点击语义（§3.2「所有跳转必须经 Navigator」）：
 * - 总指挥 → `navigateTo({ kind: 'inbox' })`（落战情台，事找人）；
 * - 经典   → `goRoute(CLASSIC_ROUTE)`（对话 + 文档栏，与 DEFAULT_ROUTE 一致）。
 *
 * 角色纪律（D14）：总指挥只对 teacher 开放；校/局看到的是禁用态（title/aria 说明教师专属），
 * 外壳同时会把误带的总指挥路由强制回经典（见 ShellLayout）。
 */
import { useRouteStore } from '../stores/routeStore'
import { useAuthStore } from '../stores/authStore'
import { goRoute, navigateTo } from '../studio/router'
import type { RouteState, WorkspaceId } from '../studio/contracts'
import { cn } from '../lib/cn'

/** 经典工作区的规范落点（与 DEFAULT_ROUTE 同值；工作区切换只认这一处，避免多处漂移） */
export const CLASSIC_ROUTE: Partial<RouteState> = {
  workspace: 'classic',
  classicView: 'chat',
  rightTab: 'doc',
  target: null,
}

const SEGMENT_BASE =
  'inline-flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-lg px-2.5 text-xs font-medium transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg ' +
  'disabled:cursor-not-allowed disabled:opacity-40 md:px-3'

export default function WorkspaceSwitcher(): JSX.Element {
  const route = useRouteStore((s) => s.route)
  const role = useAuthStore((s) => s.role)
  const canDirector = role === 'teacher'
  /** 非教师强制经典（与 ShellLayout 的 workspace 口径一致，避免高亮与渲染不一致） */
  const active: WorkspaceId = canDirector ? route.workspace : 'classic'

  const toDirector = (): void => {
    if (!canDirector) return
    const current = useRouteStore.getState().route
    /* 已停在战情台就不重复入栈（返回键语义更干净） */
    if (current.workspace === 'director' && current.directorView === 'inbox' && current.target?.kind === 'inbox') return
    navigateTo({ kind: 'inbox' })
  }

  const toClassic = (): void => {
    const current = useRouteStore.getState().route
    if (
      current.workspace === 'classic' &&
      current.classicView === 'chat' &&
      current.rightTab === 'doc' &&
      current.target === null
    ) {
      return
    }
    goRoute(CLASSIC_ROUTE)
  }

  return (
    <div
      data-testid="studio-workspace-switcher"
      role="group"
      aria-label="工作区切换"
      className="flex shrink-0 items-center rounded-xl bg-surface-2 p-0.5"
    >
      <button
        type="button"
        data-testid="studio-workspace-director"
        aria-pressed={active === 'director'}
        aria-label="总指挥工作区"
        disabled={!canDirector}
        title={canDirector ? '总指挥工作区' : '总指挥工作区 · 教师专属'}
        onClick={toDirector}
        className={cn(SEGMENT_BASE, active === 'director' ? 'bg-surface text-ink shadow-soft' : 'text-ink-mute hover:text-ink')}
      >
        总指挥
      </button>
      <button
        type="button"
        data-testid="studio-workspace-classic"
        aria-pressed={active === 'classic'}
        aria-label="经典工作区"
        title="经典工作区"
        onClick={toClassic}
        className={cn(SEGMENT_BASE, active === 'classic' ? 'bg-surface text-ink shadow-soft' : 'text-ink-mute hover:text-ink')}
      >
        经典
      </button>
    </div>
  )
}
