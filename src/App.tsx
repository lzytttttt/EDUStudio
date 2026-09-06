import { useEffect, useRef, useState } from 'react'
import { useAuthStore } from './stores/authStore'
import LoginScreen from './shell/LoginScreen'
import BriefingPage from './apps/briefing/BriefingPage'
import AppShell from './shell/AppShell'
import ShareView from './apps/share/ShareView'
import { cn } from './lib/cn'
import type { Stage } from './harness/types'

const STAGE_EXIT_MS = 200

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

/** 阶段状态机：login → briefing → workbench（无路由库，轻量分流 + 双向过渡动画） */
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

  /* 分享视图优先：不参与阶段动画，直接整页渲染 */
  if (isShare) return <ShareView />

  return (
    <div key={rendered} className={cn('h-full', leaving ? 'animate-stage-out' : 'animate-stage-in')}>
      {rendered === 'login' ? <LoginScreen /> : rendered === 'briefing' ? <BriefingPage /> : <AppShell />}
    </div>
  )
}
