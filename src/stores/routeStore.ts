/**
 * routeStore —— 路由渲染缓存（v1.2 M0，roadmap §2.4「路由/工作区」行）
 *
 * 边界：URL 是唯一事实源，store 只做渲染缓存（Navigator 写入、外壳读取）；不持久化。
 * 初始值用 contracts 的安全默认路由，模块导入不触碰 window（SSR/测试安全）。
 */
import { create } from 'zustand'
import { DEFAULT_ROUTE, type RouteState } from '../studio/contracts'
import { parseRoute } from '../studio/navigator'

export interface RouteStoreState {
  /** 当前渲染用路由（URL + history 为准） */
  route: RouteState
  /** Navigator 跳转后写入缓存（复制，避免外部对象被就地修改影响 store） */
  setRoute: (route: RouteState) => void
  /** 从当前 URL 重新解析（popstate / 冷启动 / 深链初始化时调用），返回解析结果 */
  syncFromUrl: () => RouteState
}

/** 当前 URL（SSR/无 window 环境回空串，parseRoute 会给出默认路由） */
function currentUrl(): string {
  return typeof window === 'undefined' ? '' : window.location.href
}

export const useRouteStore = create<RouteStoreState>((set) => ({
  route: { ...DEFAULT_ROUTE },

  setRoute: (route) => set({ route: { ...route } }),

  syncFromUrl: () => {
    const parsed = parseRoute(currentUrl())
    set({ route: parsed })
    return parsed
  },
}))
