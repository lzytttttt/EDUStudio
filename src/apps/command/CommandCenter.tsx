/**
 * 总指挥工作区容器 CommandCenter（v1.2 M1-B，roadmap §2.2 / §3.3 / §5.1 影子期）
 *
 * 只由统一外壳 ShellLayout 在 `?v2=1` 下 lazy 加载（默认导出、无 props，主 chunk 不静态 import
 * 本文件）；旧 `?v1=1` 整屏 DirectorApp 一字不改，仍走自己的入口。
 *
 * 职责（四件事）：
 * 1. **视图注册**：模块加载即向主 chunk 的 SurfaceHost 注册 inbox/mission/team 三个视图，
 *    `load` 再懒一层 → 首屏只需要本容器 + 当前一个视图；
 * 2. **路由 ↔ 编排态同步**：URL（routeStore）是外壳导航的事实源，`directorStore.screen` 是
 *    三屏内部动作（openMission / 返回战情台 / 引导切屏）的落点；双向同步靠「幂等比较 + 回环
 *    ref」，任一侧变化只在两侧不一致时写另一侧，不会互相触发死循环；
 * 3. **一句话委托消费**：顶栏 IntentBar 在主 chunk，委托槽 `studio/intent` 只存一行文本；
 *    本容器挂载时补处理「未挂载时提交」的槽，挂载期间由 `intent.submitted` 事件即时处理
 *    （`consumePendingIntent` 消费式去重，一条意图只拆一次）；
 * 4. **复用 Director 演示行为**：`?tour` 引导、`?mission=exam_loop` 演示兜底、轻提示折叠、
 *    GuideBar / ArtifactSheet，全部直接复用旧模块，不复制实现。
 *
 * 边界：本文件只在 Director lazy chunk 内；可 import `apps/director/**`（不是主 chunk）；
 * 零新依赖；不修改任何既有文件。
 */
import { useEffect, useMemo, useRef } from 'react'
import type { DirectorScreen, ToastItem } from '../../harness/director/types'
import { hasSeenDirectorGuide, useDirectorStore } from '../../stores/directorStore'
import { useRouteStore } from '../../stores/routeStore'
import { studioBus } from '../../studio/bus'
import { consumePendingIntent } from '../../studio/intent'
import { navigateTo, studioRouter } from '../../studio/router'
import { registerSurface, SurfaceHost } from '../../shell/SurfaceHost'
import { cn } from '../../lib/cn'
import ArtifactSheet from '../director/ArtifactSheet'
import GuideBar from '../director/GuideBar'
import { TONE } from '../director/shared'
import CommandFallback from './CommandFallback'
import '../director/director.css'

/* ------------------------------------------------------------------ */
/* 1. 视图注册（模块加载时一次；同 id 幂等覆盖，chunk 重载不报错）        */
/* ------------------------------------------------------------------ */

registerSurface({ id: 'inbox', title: '战情台', load: () => import('./InboxView'), requires: 'director' })
registerSurface({ id: 'mission', title: '作战室', load: () => import('./MissionView'), requires: 'director' })
registerSurface({ id: 'team', title: '战队', load: () => import('./TeamView'), requires: 'director' })

/* ------------------------------------------------------------------ */
/* 2. 轻提示折叠：同文案合并 ×N，最多显示最近 2 条（与 DirectorApp V1 对齐） */
/* ------------------------------------------------------------------ */

function foldToasts(toasts: ToastItem[]): (ToastItem & { count: number })[] {
  const folded: (ToastItem & { count: number })[] = []
  for (const item of toasts) {
    const same = folded.find((t) => t.text === item.text)
    if (same) same.count += 1
    else folded.push({ ...item, count: 1 })
  }
  return folded.slice(-2)
}

/* ------------------------------------------------------------------ */
/* 3. 模块级引导开关：同一页面加载只自动开一次（工作区来回切换不重开）    */
/* ------------------------------------------------------------------ */

let tourBooted = false

/** 引导自动开：与 DirectorApp 一致 —— 进入 1100ms 后，未看过就播一段 */
const TOUR_DELAY_MS = 1100

/**
 * `?tour` 在 chunk **首次加载时**锁定一次：切到经典工作区会把 URL 规范成 `/`（丢掉查询参数），
 * 再切回来时若重新读 URL，`?tour=0`（截图 / 回归）会退化成「默认自动开引导」。锁定后语义稳定。
 */
const INITIAL_TOUR = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('tour')

/* ------------------------------------------------------------------ */
/* 4. 容器                                                            */
/* ------------------------------------------------------------------ */

export default function CommandCenter(): JSX.Element {
  const route = useRouteStore((s) => s.route)
  const toasts = useDirectorStore((s) => s.toasts)
  const setScreen = useDirectorStore((s) => s.setScreen)
  const visibleToasts = useMemo(() => foldToasts(toasts), [toasts])

  /** 本容器刚从 store.screen 推向路由的视图：路由回流时跳过，避免回环（§3.2 幂等纪律） */
  const pushedViewRef = useRef<DirectorScreen | null>(null)

  /* ---------------- ① route → store：URL / 外壳导航 / 返回键是事实源 ---------------- */
  useEffect(() => {
    if (route.workspace !== 'director') return
    const view = route.directorView
    const current = useDirectorStore.getState().screen
    /* Navigator 契约里 RouteState 不携带 source，无法按「user 来源」判定；改用幂等比较：
       两侧已一致（含本容器刚推出去的回流）就什么都不写，回环在第一次比较即被切断。 */
    if (view === current) {
      pushedViewRef.current = null
      return
    }
    if (pushedViewRef.current === view) {
      /* 这一步路由是 ② 刚从 store.screen 推出去的：不回写 store（否则会覆盖用户后续动作） */
      pushedViewRef.current = null
      return
    }
    setScreen(view)
  }, [route.workspace, route.directorView, setScreen])

  /* ---------------- ② store → route：屏内动作推动 URL（openMission / 返回 / 引导切屏） ---------------- */
  useEffect(() => {
    const unsubscribe = useDirectorStore.subscribe((state, prev) => {
      if (state.screen === prev.screen) return
      /* 只在总指挥工作区推动导航：经典工作区下的屏幕变化不污染 URL（工作区由外壳决定） */
      const currentRoute = useRouteStore.getState().route
      if (currentRoute.workspace !== 'director') return
      if (currentRoute.directorView === state.screen) return
      pushedViewRef.current = state.screen
      navigateTo({ kind: state.screen })
    })
    return unsubscribe
  }, [])

  /* ---------------- ③ 一句话委托：挂载补取槽 + 事件即时消费（消费式去重） ---------------- */
  useEffect(() => {
    const runPendingIntent = (): void => {
      try {
        const pending = consumePendingIntent()
        if (!pending) return
        /* planMission 是异步的：拆解完成后 store 自己会把 screen 切到 mission（再经 ② 同步 URL）；
           这里先导航一次给即时反馈，拆解失败也停在作战室（旧整屏同语义）。 */
        void useDirectorStore
          .getState()
          .planMission(pending.intent)
          .catch((error: unknown) => {
            console.error('[CommandCenter] 一句话委托拆解失败:', error)
          })
        navigateTo({ kind: 'mission' })
      } catch (error) {
        /* 委托失败绝不阻塞渲染：记录后继续（用户可重试或手动开任务） */
        console.error('[CommandCenter] 一句话委托处理异常:', error)
      }
    }
    runPendingIntent()
    return studioBus.on('intent.submitted', runPendingIntent)
  }, [])

  /* ---------------- ④ 引导：?tour=0 关 / ?tour=1 强制 / 否则首次自动 ---------------- */
  useEffect(() => {
    if (tourBooted) return
    if (INITIAL_TOUR === '0') return
    const force = INITIAL_TOUR === '1'
    const timer = window.setTimeout(() => {
      tourBooted = true
      if (force || !hasSeenDirectorGuide()) useDirectorStore.getState().startGuide(force)
    }, TOUR_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [])

  /* ---------------- ⑤ ?mission=exam_loop 演示兜底：只种一次并摘掉参数 ---------------- */
  const missionBootRef = useRef(false)
  useEffect(() => {
    if (missionBootRef.current) return
    missionBootRef.current = true
    const url = new URL(window.location.href)
    if (url.searchParams.get('mission') !== 'exam_loop') return
    try {
      /* 与 DirectorApp 一致：只种计划、不跳屏；种完立刻 replaceState 摘参数，
         否则刷新会再次 startMission 覆盖持久化恢复出来的 paused / 进度。 */
      useDirectorStore.getState().startMission('exam_loop')
      url.searchParams.delete('mission')
      const search = url.searchParams.toString()
      window.history.replaceState(
        window.history.state,
        '',
        `${url.pathname}${search ? `?${search}` : ''}${url.hash}`,
      )
    } catch (error) {
      console.error('[CommandCenter] ?mission= 演示计划种入失败:', error)
    }
  }, [])

  return (
    <div data-testid="command-center" className="d-root relative flex h-full flex-col overflow-hidden">
      {/* 主内容：当前一级视图（SurfaceHost 内部 Suspense + 视图级懒加载） */}
      <main className="relative z-10 min-h-0 flex-1">
        <div key={route.directorView} className="d-fade h-full">
          <SurfaceHost
            surface={route.directorView}
            target={route.target}
            navigate={studioRouter.navigator}
            fallback={<CommandFallback />}
          />
        </div>
      </main>

      {/* 引导条 / 交付物预览：复用旧组件，位置由组件自身 fixed 定位 */}
      <GuideBar />
      <ArtifactSheet />

      {/* 轻提示：只给结果不打断；top-[4.75rem] 避开外壳顶栏与标题，role=status 供读屏播报 */}
      <div
        data-testid="command-toasts"
        role="status"
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 top-[4.75rem] z-40 flex flex-col items-center gap-2 px-4"
      >
        {visibleToasts.map((t) => (
          <div
            key={t.id}
            className="d-toast pointer-events-auto flex items-center gap-2 rounded-full border border-line bg-surface/95 px-4 py-2 text-[0.75rem] font-medium text-ink shadow-card backdrop-blur"
          >
            <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', TONE[t.tone].dot)} />
            {t.text}
            {t.count > 1 && <span className="text-[0.6875rem] text-ink-soft">×{t.count}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
