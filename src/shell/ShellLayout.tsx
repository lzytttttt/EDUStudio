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
import { ArrowLeft, Inbox, Play, Sparkles, Users, X, type LucideIcon } from 'lucide-react'
import ShellChrome from './ShellChrome'
import AppShell from './AppShell'
import { CLASSIC_ROUTE } from './WorkspaceSwitcher'
import { useRouteStore } from '../stores/routeStore'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { useChatStore } from '../stores/chatStore'
import { useSettingsStore } from '../stores/settingsStore'
import { inboxCounts, useStudioInbox } from '../stores/studioInboxStore'
import { goRoute, navigateTo } from '../studio/router'
import {
  EMPTY_ONBOARDING,
  nextStep,
  shouldShowUpgradeNotice,
} from '../lib/onboarding'
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
  /* v1.2 M2（roadmap §2.3 F6）：战情台派生待办角标 = 收件箱 decisions 数（不含只读 notices），
     与战情台派生列表同口径；0 时不渲染。桌面/移动同一套 DOM，只出现一份。 */
  const pendingDecisions = inboxCounts(useStudioInbox()).decisions

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
              'relative flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[0.6875rem] font-medium transition-colors',
              'md:flex-none md:flex-row md:justify-start md:gap-2.5 md:rounded-xl md:px-3 md:py-2.5 md:text-sm',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
              active ? 'text-primary md:bg-primary-soft' : 'text-ink-soft hover:text-ink md:hover:bg-surface-2',
            )}
          >
            <Icon size={18} strokeWidth={1.8} aria-hidden />
            <span>{item.label}</span>
            {item.id === 'inbox' && pendingDecisions > 0 && (
              <>
                <span
                  data-testid="studio-nav-inbox-badge"
                  aria-hidden
                  title={`${pendingDecisions} 件待决策`}
                  className="absolute right-2 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-coral px-1 text-[0.5625rem] font-bold leading-none text-white md:static md:ml-auto md:right-auto md:top-auto"
                >
                  {pendingDecisions}
                </span>
                <span className="sr-only">，{pendingDecisions} 件待决策</span>
              </>
            )}
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

/* ------------------------------------------------------------------ */
/* v1.2 M4 · 连续引导提示条（升级提示 / 下一站 CTA，两条互斥）            */
/* ------------------------------------------------------------------ */

/** 提示条按钮统一的焦点环 + 触控高度（≥44px，沿用 §3.8 a11y 约定） */
const ONBOARDING_BTN =
  'inline-flex min-h-[44px] items-center rounded-xl px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg'

/**
 * 顶栏下方的轻提示条（只对教师生效；两条互斥，升级提示优先）：
 * - 升级提示：M4 之前就有数据的用户首次进入 → 「新增：总指挥工作区」；关闭只写 `noticeSeen`
 *   （不推进引导进度，保证「只在版本升级后出现一次」的打扰预算）；
 * - 经典 CTA：`settings.studio.onboarding` 显示下一站是经典（总指挥段已完成、经典段未完成）→
 *   「下一站：经典工作区（30 秒）」；跳过写 `classicSeen`（onboarded 由 merge 派生）。
 * 样式复用现有 token，不新增色相；role=status + aria-live，可关闭、不遮挡内容。
 */
function OnboardingBar(): JSX.Element | null {
  const role = useAuthStore((s) => s.role)
  /* 只订阅 onboarding 段（digest 等高频更新不触发提示条重渲染） */
  const onboarding = useSettingsStore((s) => s.studio.onboarding)
  const legacyUser = useSettingsStore((s) => s.onboardingLegacyUser)
  const updateOnboarding = useSettingsStore((s) => s.updateOnboarding)
  /* D14：总指挥工作区仅教师可见，提示条同理（校/局不展示升级/接力提示） */
  if (role !== 'teacher') return null
  const progress = onboarding ?? EMPTY_ONBOARDING

  if (shouldShowUpgradeNotice(progress, legacyUser)) {
    return (
      <div
        data-testid="studio-onboarding-notice"
        role="status"
        aria-live="polite"
        className="flex min-h-[44px] shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-primary-soft/70 px-3 py-1.5 text-xs text-ink sm:px-4"
      >
        <Sparkles size={14} strokeWidth={1.9} className="text-primary" aria-hidden />
        <span className="font-semibold">新增：总指挥工作区</span>
        <span className="hidden text-ink-soft sm:inline">事找人 · 一句话交给战队</span>
        <span className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            data-testid="studio-onboarding-notice-open"
            onClick={() => {
              updateOnboarding({ noticeSeen: true })
              navigateTo({ kind: 'inbox' })
            }}
            className={cn(ONBOARDING_BTN, 'bg-primary text-white hover:bg-primary-deep')}
          >
            看一眼新工作区
          </button>
          <button
            type="button"
            data-testid="studio-onboarding-notice-close"
            title="关闭升级提示"
            aria-label="关闭升级提示"
            onClick={() => updateOnboarding({ noticeSeen: true })}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
          >
            <X size={14} strokeWidth={2} aria-hidden />
          </button>
        </span>
      </div>
    )
  }

  if (nextStep(progress) === 'classic') {
    return (
      <div
        data-testid="studio-onboarding-cta"
        role="status"
        aria-live="polite"
        className="flex min-h-[44px] shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-mint-soft/60 px-3 py-1.5 text-xs text-ink sm:px-4"
      >
        <Sparkles size={14} strokeWidth={1.9} className="text-mint-ink" aria-hidden />
        <button
          type="button"
          data-testid="studio-onboarding-cta-go"
          onClick={() => goRoute(CLASSIC_ROUTE)}
          className={cn(ONBOARDING_BTN, 'bg-primary text-white hover:bg-primary-deep')}
        >
          下一站：经典工作区（30 秒）
        </button>
        <span className="hidden text-ink-soft sm:inline">总指挥看完了，再看看经典三栏</span>
        <button
          type="button"
          data-testid="studio-onboarding-cta-skip"
          onClick={() => updateOnboarding({ classicSeen: true })}
          className={cn(ONBOARDING_BTN, 'ml-auto text-ink-soft hover:bg-surface-2 hover:text-ink')}
        >
          跳过
        </button>
      </div>
    )
  }

  return null
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

  /* v1.2 M2：「点开看会话」——派生收件箱 / 深链跳到 `{kind:'chat', id}` 后，把经典工作区的
     当前会话定位到该会话（旧三栏仍读 chatStore.activeId）。只在路由目标变化时写一次，
     且与当前会话比较后再写（幂等：同一目标重复渲染不产生多余 setState / 回写循环）。 */
  const targetChatId = route.target?.kind === 'chat' ? route.target.id ?? null : null
  useEffect(() => {
    if (workspace !== 'classic' || !targetChatId) return
    const { activeId, setActive } = useChatStore.getState()
    if (activeId === targetChatId) return
    setActive(targetChatId)
  }, [workspace, targetChatId])

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

  /* v1.2 M3b：画布 checkpoint → 统一审批门桥（动态加载；不在主 chunk 静态拉起 loom 桥）。
     安装后 Loom checkpoint 的 waiting/resolved 会进同一个收件箱与角标口径。 */
  useEffect(() => {
    let stop: (() => void) | undefined
    let cancelled = false
    void import('../integrations/studio/loomGates')
      .then((mod) => {
        if (cancelled) return
        stop = mod.installLoomGateBridge()
      })
      .catch((error) => console.error('[ShellLayout] 画布审批门桥安装失败:', error))
    return () => {
      cancelled = true
      try {
        stop?.()
      } catch {
        /* 卸载失败不影响壳 */
      }
    }
  }, [])

  return (
    <div data-testid="studio-shell" className="flex h-full flex-col overflow-hidden bg-bg">
      <ShellChrome />
      {/* v1.2 M4：连续引导提示条（升级提示 → 经典 CTA；两条互斥，教师专属） */}
      <OnboardingBar />

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
