/**
 * v1.2 M1 · 浏览器路由运行时（主 chunk，薄适配层）
 *
 * 职责（roadmap §3.2 / §5.1）：
 * - URL 是唯一事实源：`start()` 把 URL 解析进 `routeStore`，并监听 popstate 回灌；
 * - 所有跨工作区跳转统一经 `navigateTo` / `goRoute`（Navigator），旧页面不用知道路由细节；
 * - `?v1=1` 旧整屏仍由 App 的 stage 状态机承担，本模块只在 `?v2=1` 统一壳下启用（影子期）。
 *
 * 边界：主 chunk，不 import 任何 Director 模块/旧 store（仅 routeStore，主 chunk 渲染缓存）。
 */
import type { Navigator, RouteState, WorkTarget } from './contracts'
import { createNavigator, parseRoute, type NavigatorEnv } from './navigator'
import { useRouteStore } from '../stores/routeStore'
import type { Stage } from '../harness/types'

export interface StudioRouter {
  navigator: Navigator
  /** 把当前 URL 解析进 routeStore（冷启动 / popstate / history 外部变更后） */
  syncFromUrl(): RouteState
  /** 幂等启动：初始同步 + popstate 订阅；返回停止函数 */
  start(): () => void
}

function browserEnv(): NavigatorEnv {
  return {
    getLocation: () => (typeof window === 'undefined' ? '' : window.location.href),
    pushState: (state, url) => window.history.pushState(state, '', url),
    replaceState: (state, url) => window.history.replaceState(state, '', url),
    back: () => window.history.back(),
  }
}

export function createStudioRouter(env: NavigatorEnv = browserEnv()): StudioRouter {
  const navigator = createNavigator(env)
  let listening = false

  const syncFromUrl = (): RouteState => {
    const route = parseRoute(env.getLocation())
    useRouteStore.getState().setRoute(route)
    return route
  }

  return {
    navigator,
    syncFromUrl,
    start(): () => void {
      if (listening) return () => {}
      listening = true
      syncFromUrl()
      const onPop = (): void => {
        navigator.syncFromLocation?.()
        syncFromUrl()
      }
      if (typeof window !== 'undefined') window.addEventListener('popstate', onPop)
      return () => {
        listening = false
        if (typeof window !== 'undefined') window.removeEventListener('popstate', onPop)
      }
    },
  }
}

/** 单例：外壳 / 端口 / 旧页面跳转统一走它（§3.2「所有跳转必须经它」） */
export const studioRouter = createStudioRouter()

let routingStarted = false
/** 幂等启动（main.tsx 在 `?v2=1` 入口调用；重复调用无副作用） */
export function startStudioRouting(): () => void {
  if (routingStarted) return () => {}
  routingStarted = true
  const stop = studioRouter.start()
  return () => {
    routingStarted = false
    stop()
  }
}

/** 跳转后把 routeStore 对齐到「刚 commit 的 RouteState」（URL 是规范化形态，回读会丢 canonical 差异） */
function commitToStore(): void {
  const route = studioRouter.navigator.currentRoute?.()
  if (route) useRouteStore.getState().setRoute(route)
  else studioRouter.syncFromUrl()
}

/** 打开目标（用户主动跳转 → pushState；system → replaceState） */
export function navigateTo(
  target: WorkTarget,
  opts?: { replace?: boolean; source?: 'user' | 'system' | 'deep-link' },
): void {
  studioRouter.navigator.open(target, opts)
  commitToStore()
}

/** 局部改路由（如工作区切换、右栏 tab） */
export function goRoute(partial: Partial<RouteState>, opts?: { replace?: boolean }): void {
  studioRouter.navigator.go(partial, opts)
  commitToStore()
}

/** 旧 stage 状态机 → 新路由的意图（M1 桥：旧组件继续 setStage，统一壳按 route 渲染） */
export type StageRouteIntent =
  | { kind: 'open'; target: WorkTarget }
  | { kind: 'go'; route: Partial<RouteState> }
  | null

export function stageRouteIntent(stage: Stage): StageRouteIntent {
  switch (stage) {
    case 'command':
      // 兼容旧 ?v1=1 语义：总指挥落战情台（M4 前该路径只会在 legacy 壳里出现）
      return { kind: 'open', target: { kind: 'inbox' } }
    case 'briefing':
      return { kind: 'open', target: { kind: 'briefing' } }
    case 'workbench':
      return { kind: 'go', route: { workspace: 'classic', classicView: 'chat', rightTab: 'doc', target: null } }
    default:
      // login：统一壳由 App 按 role 渲染登录页，不产生路由跳转
      return null
  }
}

/** 应用旧 stage 意图（App 的 stage→route 桥使用） */
export function applyStageRouteIntent(stage: Stage): void {
  const intent = stageRouteIntent(stage)
  if (!intent) return
  if (intent.kind === 'open') navigateTo(intent.target)
  else goRoute(intent.route)
}
