import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import { useAuthStore } from './stores/authStore'
import LoginScreen from './shell/LoginScreen'
import AppShell from './shell/AppShell'
import { cn } from './lib/cn'
import type { Stage } from './harness/types'

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
 *  分享视图（#share=）优先级不变，不参与 pushState / popstate；无路由库，维持轻定位 */
function useHistorySync(): void {
  const stage = useAuthStore((s) => s.stage)
  /* 首挂 / popstate 来源跳过 pushState（守卫：防 setStage ↔ popstate 互相触发死循环） */
  const skipPush = useRef(true)
  useEffect(() => {
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
  }, [])
  /* 正向切换（M5①）：pushState 入栈；首挂与 popstate 来源不入栈 */
  useEffect(() => {
    if (skipPush.current) {
      skipPush.current = false
      return
    }
    window.history.pushState({ stage }, '')
  }, [stage])
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
  useHistorySync()
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
