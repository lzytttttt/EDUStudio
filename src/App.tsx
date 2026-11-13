import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import { useAuthStore } from './stores/authStore'
import { useSettingsStore } from './stores/settingsStore'
import LoginScreen from './shell/LoginScreen'
import AppShell from './shell/AppShell'
import { cn } from './lib/cn'
import { isStudioV2Enabled } from './lib/studioEntry'
import { applyStageRouteIntent, goRoute, startStudioRouting } from './studio/router'
import type { Stage } from './harness/types'

/** v1.2 M1：统一外壳（主 chunk；内部对 CommandCenter/视图做 chunk 内懒加载） */
import ShellLayout from './shell/ShellLayout'

const STAGE_EXIT_MS = 200

/** v1.0 总指挥模式：独立 lazy chunk，旧三屏与主 chunk 不受影响 */
const DirectorApp = lazy(() => import('./apps/director/DirectorApp'))

/** v1.2 M0 腾预算：简报（34KB 源码）与分享（18.6KB 源码）移出主 chunk。
 *  简报是教师登录默认落点，用一次异步 chunk 加载换主 chunk 预算（§3.10）；分享只在 #share= 出现，纯收益。 */
const BriefingPage = lazy(() => import('./apps/briefing/BriefingPage'))
const ShareView = lazy(() => import('./apps/share/ShareView'))

/** 分享路由：hash 以 #share= 开头时渲染只读分享视图（独立于登录状态机，v0.4 M2①） */
function useShareRoute(): boolean {
  const [isShare, setIsShare] = useState(() => window.location.hash.startsWith('#share='))
  useEffect(() => {
    const onHash = () => setIsShare(window.location.hash.startsWith('#share='))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return isShare
}

/** 浏览器历史集成（v0.9 M5①②③）：阶段切换写入历史栈，返回键回退阶段而非退出站点；
 *  分享视图（#share=）优先级不变，不参与 pushState / popstate；无路由库，维持轻定位。
 *  v1.2 M1：统一工作区（`?v2=1`）下由 studio/router 接管 history，本钩子整体停用。 */
function useHistorySync(enabled: boolean): void {
  const stage = useAuthStore((s) => s.stage)
  /* 首挂 / popstate 来源跳过 pushState（守卫：防 setStage ↔ popstate 互相触发死循环） */
  const skipPush = useRef(true)
  useEffect(() => {
    if (!enabled) return
    /* 刷新恢复（M5③）：replaceState 写入当前 stage，不产生多余历史记录 */
    window.history.replaceState({ stage: useAuthStore.getState().stage }, '')
    const onPop = (e: PopStateEvent) => {
      if (window.location.hash.startsWith('#share=')) return // 分享路由优先（M5②）
      const target = (e.state as { stage?: Stage } | null)?.stage ?? 'login'
      const cur = useAuthStore.getState().stage
      if (target === cur) return
      skipPush.current = true
      useAuthStore.getState().setStage(target, { fromPopstate: true })
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [enabled])
  /* 正向切换（M5①）：pushState 入栈；首挂与 popstate 来源不入栈 */
  useEffect(() => {
    if (!enabled) return
    if (skipPush.current) {
      skipPush.current = false
      return
    }
    window.history.pushState({ stage }, '')
  }, [stage, enabled])
}

/** v1.2 M1 统一壳：旧组件继续 setStage（简报/工作台/返回等），App 把它翻译成路由意图。
 *  route 是渲染事实源：挂载时的 stage（入口计划可能已把它设成 briefing）不产生跳转，
 *  深链已在 main 的 startStudioRouting 对齐；只有挂载后发生的 stage 变化才翻译。
 *  注意用「记录挂载 stage」而不是布尔 ref：React 18 dev StrictMode 会 mount→unmount→remount，
 *  布尔 ref 在二次 effect 时会误判为「挂载后变化」，把深链覆盖成 briefing。 */
function useStageRouteBridge(enabled: boolean): void {
  const stage = useAuthStore((s) => s.stage)
  const stageAtMount = useRef(stage)
  useEffect(() => {
    if (!enabled) {
      stageAtMount.current = useAuthStore.getState().stage
      return
    }
    if (stage === stageAtMount.current) return
    stageAtMount.current = stage
    /* v1.2 M4：默认期 teacher 登录后不再落简报，而是战情台（R-1；简报降为发现区）。
       仅当当前 URL 没有显式视图（深链）且启动页设置为 auto/inbox 时改写。 */
    if (stage === 'briefing') {
      const landing = useSettingsStore.getState().studio.landing
      const hasView = new URLSearchParams(window.location.search).has('view')
      if (!hasView && (landing === 'auto' || landing === 'inbox')) {
        goRoute({ workspace: 'director', directorView: 'inbox' }, { replace: true })
        return
      }
    }
    applyStageRouteIntent(stage)
  }, [enabled, stage])
}

/** 懒加载占位：与品牌一致的柔和呼吸点，避免白闪（v1.2 M0 起简报/分享/总指挥共用） */
function LazyFallback() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-bg">
      <div className="flex items-center gap-2" aria-hidden>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary/50"
            style={{ animationDelay: `${i * 0.12}s`, animationDuration: '1.2s' }}
          />
        ))}
      </div>
      <span className="sr-only" role="status">
        加载中
      </span>
    </div>
  )
}

/** 阶段状态机：login → briefing → workbench；v1.0 追加 command（总指挥模式，可直达） */
export default function App() {
  const isShare = useShareRoute()
  const stage = useAuthStore((s) => s.stage)
  const role = useAuthStore((s) => s.role)
  /* v1.2 M1/M4：统一工作区判定（`?v2=` 显式 / `?legacy=` 回滚 / M4 起 teacher 默认）。
     M4 起不再在首渲染锁死：登录前 role=null 得到旧壳、登录后 teacher 需切到新壳（登录落点=战情台，R-1）；
     `?legacy=1` / `?stage=` / `?demo=1` 显式旧路径仍恒为旧壳，因此行为可控。 */
  const studioV2 = isStudioV2Enabled(
    window.location.search,
    role,
    useSettingsStore.getState().studio,
  )
  useHistorySync(!studioV2)
  useStageRouteBridge(studioV2)

  /* v1.2 M4：登录后进入默认期（或 `?v2=1` 直开）时初始化路由，并把「无显式视图」的冷启动落到战情台。
     深链（view/id/task/agent/tab）保持 URL 解析结果，不覆盖。 */
  useEffect(() => {
    if (!studioV2 || role !== 'teacher') return
    startStudioRouting()
    const params = new URLSearchParams(window.location.search)
    const hasExplicitRoute = ['view', 'id', 'task', 'agent', 'tab'].some((key) => params.has(key))
    if (hasExplicitRoute) return
    const landing = useSettingsStore.getState().studio.landing
    if (landing === 'briefing' || landing === 'workbench') return
    goRoute({ workspace: 'director', directorView: 'inbox' }, { replace: true })
  }, [studioV2, role])
  const [rendered, setRendered] = useState<Stage>(stage)
  const [leaving, setLeaving] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  /* 阶段切换：旧视图先退场（淡出上移），再挂载新视图入场（淡入上浮） */
  useEffect(() => {
    if (stage === rendered) return
    setLeaving(true)
    timer.current = window.setTimeout(() => {
      setRendered(stage)
      setLeaving(false)
    }, STAGE_EXIT_MS)
    return () => window.clearTimeout(timer.current)
  }, [stage, rendered])

  /* 分享视图优先：不参与阶段动画，直接整页渲染（v1.2 M0：独立 lazy chunk） */
  if (isShare) {
    return (
      <Suspense fallback={<LazyFallback />}>
        <ShareView />
      </Suspense>
    )
  }

  /* v1.2 M1：统一工作区（外壳 + 工作区切换 + 路由）；未登录先回登录页（登录后由 stage→route 桥进入） */
  if (studioV2) {
    return role ? <ShellLayout /> : <LoginScreen />
  }

  return (
    <div key={rendered} className={cn('h-full', leaving ? 'animate-stage-out' : 'animate-stage-in')}>
      {rendered === 'login' ? (
        <LoginScreen />
      ) : rendered === 'briefing' ? (
        <Suspense fallback={<LazyFallback />}>
          <BriefingPage />
        </Suspense>
      ) : rendered === 'command' ? (
        <Suspense fallback={<LazyFallback />}>
          <DirectorApp />
        </Suspense>
      ) : (
        <AppShell />
      )}
    </div>
  )
}
