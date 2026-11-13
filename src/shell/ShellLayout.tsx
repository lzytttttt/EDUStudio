/**
 * v1.2 M1 · 统一外壳 ShellLayout（主 chunk，roadmap §2.2 / §3.3 / §5.1 影子期）
 *
 * 一套壳、两个工作区：
 * - 总指挥工作区（仅 teacher）：左侧导航（战情台/作战室/战队，桌面常驻 / 移动底部一套）
 *   + 中栏 lazy `CommandCenter`（Director chunk，默认导出无 props，主 chunk 不静态 import）；
 * - 经典工作区：原三栏 `AppShell embedded`（沿用其左右栏 / 抽屉 / tabbar / 通知 / 引导）；
 *   深链 `route.target.kind === 'briefing'` 时渲染 lazy 简报页。
 *
 * 同步纪律（§3.2「URL 是唯一事实源」）：
 * - `routeStore.route` 变化是渲染的唯一驱动；本文件不直接写 history，统一经 `navigateTo` / `goRoute`；
 * - 经典工作区把 route.classicView / route.rightTab 灌入 uiStore（旧视图仍读 uiStore）；
 * - 订阅 uiStore.centerView 反向写回 route（仅在经典工作区且不一致时写，防循环）；
 * - 非 teacher 强制经典工作区（D14：总指挥只对教师开放），并把误带的总指挥路由 replace 回经典。
 *
 * 边界：主 chunk 文件，不得静态 import apps/director、harness/director、harness/team
 *（ChunkBoundary 测试扫描 src/shell/**）；只允许 `lazy(() => import(...))`。
 */
import { Suspense, lazy, useEffect } from 'react'
import { ArrowLeft, Inbox, Play, Users, type LucideIcon } from 'lucide-react'
import ShellChrome from './ShellChrome'
import AppShell from './AppShell'
import { CLASSIC_ROUTE } from './WorkspaceSwitcher'
import { useRouteStore } from '../stores/routeStore'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { goRoute, navigateTo } from '../studio/router'
import type { DirectorView, RightTab, WorkspaceId } from '../studio/contracts'
import { cn } from '../lib/cn'

/** 总指挥工作区容器：Director chunk 懒加载入口（默认导出、无 props，M1-B 提供） */
const CommandCenter = lazy(() => import('../apps/command/CommandCenter'))
/** 经典工作区简报页：M0 已把 BriefingPage 挪出主 chunk，这里复用同一动态入口（同一 chunk） */
const BriefingPage = lazy(() => import('../apps/briefing/BriefingPage'))

/** 总指挥一级导航：文案 ≤3 个词，顺序与旧 Director dock 一致（战情 → 作战 → 战队） */
const DIRECTOR_NAV: { id: DirectorView; label: string; icon: LucideIcon }[] = [
  { id: 'inbox', label: '战情台', icon: Inbox },
  { id: 'mission', label: '作战室', icon: Play },
  { id: 'team', label: '战队', icon: Users },
]

/** uiStore 右栏 tab 的取值域（lib/rightPanel：doc/board/flow）；路由里的 'team' 暂无对应实现 */
const UI_RIGHT_TABS = ['doc', 'board', 'flow'] as const
type UiRightTab = (typeof UI_RIGHT_TABS)[number]

function isUiRightTab(tab: RightTab): tab is UiRightTab {
  return (UI_RIGHT_TABS as readonly string[]).includes(tab)
}

/** 懒加载轻骨架：与品牌同源的呼吸块，不产生布局跳动（aria-live 只播报一行） */
function ShellSkeleton({ label }: { label: string }): JSX.Element {
  return (
    <div data-testid="studio-skeleton" role="status" aria-live="polite" className="flex h-full flex-col gap-3 bg-bg p-4">
      <span className="sr-only">{label}</span>
      <div aria-hidden className="h-6 w-1/3 animate-pulse rounded-lg bg-surface-2" />
      <div aria-hidden className="grid min-h-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="animate-pulse rounded-2xl bg-surface-2" />
        <div className="animate-pulse rounded-2xl bg-surface-2" />
        <div className="animate-pulse rounded-2xl bg-surface-2" />
      </div>
    </div>
  )
}

/**
 * 总指挥工作区导航：**同一个 DOM 节点**在移动端变成底部标签栏、在桌面变成左侧栏，
 * 保证 `studio-nav-*` testid 全站唯一（不会出现桌面导航 + 移动导航两份）。
 */
function DirectorNav(): JSX.Element {
  const view = useRouteStore((s) => s.route.directorView)

  return (
    <nav
      aria-label="总指挥工作区导航"
      className={cn(
        /* 移动端：固定底部一套导航（含 iOS 安全区避让） */
        'fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur',
        /* 桌面端：左侧常驻导航（宽度固定，M1 不做拖拽；§3.3 的可拖拽留到 M2） */
        'md:static md:inset-auto md:z-auto md:w-56 md:shrink-0 md:flex-col md:gap-1 md:border-r md:border-t-0 md:bg-surface md:px-2 md:pb-3 md:pt-3 md:backdrop-blur-none',
      )}
    >
      {DIRECTOR_NAV.map((item) => {
        const active = view === item.id
        const Icon = item.icon
        return (
          <button
            key={item.id}
            type="button"
            data-testid={`studio-nav-${item.id}`}
            aria-pressed={active}
            onClick={() => navigateTo({ kind: item.id })}
            className={cn(
              'flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[0.6875rem] font-medium transition-colors',
              'md:flex-none md:flex-row md:justify-start md:gap-2.5 md:rounded-xl md:px-3 md:py-2.5 md:text-sm',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
              active ? 'text-primary md:bg-primary-soft' : 'text-ink-soft hover:text-ink md:hover:bg-surface-2',
            )}
          >
            <Icon size={18} strokeWidth={1.8} aria-hidden />
            <span>{item.label}</span>
          </button>
        )
      })}

      {/* 桌面专属：切到经典工作区（移动端由顶栏 WorkspaceSwitcher 承担，底部只留 3 个主去处） */}
      <div className="hidden md:mt-auto md:block md:border-t md:border-line md:pt-2">
        <button
          type="button"
          data-testid="studio-nav-classic"
          onClick={() => goRoute(CLASSIC_ROUTE)}
          className="flex min-h-[44px] w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <ArrowLeft size={16} aria-hidden />
          经典工作区
        </button>
        <p className="px-3 pb-1 pt-2 text-[0.625rem] text-ink-mute">v1.2 预览 · 总指挥工作区</p>
      </div>
    </nav>
  )
}

export default function ShellLayout(): JSX.Element {
  const route = useRouteStore((s) => s.route)
  const role = useAuthStore((s) => s.role)
  const isTeacher = role === 'teacher'
  /** 非教师强制经典工作区（总指挥只对 teacher 开放，§3.9 D14） */
  const workspace: WorkspaceId = isTeacher ? route.workspace : 'classic'
  const classicView = route.classicView
  const rightTab = route.rightTab

  /* 非教师误带总指挥路由（如校/局打开 ?v2=1&view=inbox）：replace 回经典，地址栏与渲染保持一致 */
  useEffect(() => {
    if (isTeacher) return
    if (useRouteStore.getState().route.workspace !== 'director') return
    goRoute(CLASSIC_ROUTE, { replace: true })
  }, [isTeacher, route.workspace])

  /* route → uiStore：经典工作区的中栏视图 / 右栏 tab 以路由为准（旧视图继续读 uiStore） */
  useEffect(() => {
    if (workspace !== 'classic') return
    const { centerView, setCenterView } = useUiStore.getState()
    if (centerView !== classicView) setCenterView(classicView)
  }, [workspace, classicView])

  useEffect(() => {
    if (workspace !== 'classic') return
    if (!isUiRightTab(rightTab)) return
    const { rightTab: current, setRightTab } = useUiStore.getState()
    if (current !== rightTab) setRightTab(rightTab)
  }, [workspace, rightTab])

  /* uiStore.centerView → route：中栏内点「对话/空间任务台」反写路由（仅经典工作区且不一致时写，防循环） */
  useEffect(() => {
    return useUiStore.subscribe((state, prev) => {
      if (state.centerView === prev.centerView) return
      const current = useRouteStore.getState().route
      if (current.workspace !== 'classic') return
      if (current.classicView === state.centerView) return
      goRoute({ classicView: state.centerView })
    })
  }, [])

  return (
    <div data-testid="studio-shell" className="flex h-full flex-col overflow-hidden bg-bg">
      <ShellChrome />

      {workspace === 'director' ? (
        <div className="flex min-h-0 flex-1">
          <DirectorNav />
          {/* 移动端给固定底部导航让位（与 AppShell 的 --tabbar-h 同口径） */}
          <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] md:pb-0">
            <Suspense fallback={<ShellSkeleton label="正在进入总指挥工作区…" />}>
              <CommandCenter />
            </Suspense>
          </main>
        </div>
      ) : route.target?.kind === 'briefing' ? (
        <main className="min-h-0 flex-1 overflow-hidden">
          <Suspense fallback={<ShellSkeleton label="正在打开今日简报…" />}>
            <BriefingPage />
          </Suspense>
        </main>
      ) : (
        /* 经典工作区：原三栏工作台原样嵌入；移动端顶栏由其自带 tabbar 承担（绝不与总指挥底部导航同屏） */
        <div className="min-h-0 flex-1 overflow-hidden">
          <AppShell embedded onOpenBriefing={() => navigateTo({ kind: 'briefing' })} />
        </div>
      )}
    </div>
  )
}
