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

/** 阶段状态机：login → briefing → workbench（无路由库，轻量分流 + 双向过渡动画） */
export default function App() {
  const isShare = useShareRoute()
  const stage = useAuthStore((s) => s.stage)
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
