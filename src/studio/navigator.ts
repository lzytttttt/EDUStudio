/**
 * v1.2 M0 · URL ↔ RouteState 编解码与 Navigator（主 chunk，无 React / 无 store 依赖）
 *
 * 深链协议（doc/v1.2-roadmap.md §3.2，不新增路由库）：
 * - `?v2=1`（影子期）/ `?v1=1`（兼容）→ 总指挥工作区；`?legacy=1` → 经典工作区（强制）
 * - `?view=inbox|mission|team|chat|loom|briefing`；`?id` / `?task` / `?agent`
 * - `?tab=doc|board|flow|team`（右栏）
 * - `#share=` 不参与路由：命中即返回默认路由，调用方必须先判断分享优先
 * - 非法 view / tab / id / agent 一律回安全默认（directorView=inbox、tab=doc、target=null）
 *
 * encodeRoute 只写非默认值，输出 `?a=b` 形式；DEFAULT_ROUTE 编码为 `''`。
 * Navigator 语义：source!=='system' 且非 replace 时 pushState（内存栈 depth +1）；
 * source==='system' 或 replace 时 replaceState（不污染返回栈）；state 形如 `{ route }`。
 */

import type { ClassicView, DirectorView, Navigator, RightTab, RouteState, WorkTarget } from './contracts'
import { DEFAULT_ROUTE, DIRECTOR_AGENT_IDS } from './contracts'

export { DEFAULT_ROUTE } from './contracts'

const URL_BASE = 'http://studio.local'
/** 目标实体 id 的安全上限：超长 / 含空白视为非法（回 target=null） */
const MAX_ID_LENGTH = 128

const DIRECTOR_VIEWS: readonly DirectorView[] = ['inbox', 'mission', 'team']
const CLASSIC_VIEWS: readonly ClassicView[] = ['chat', 'loom']
const RIGHT_TABS: readonly RightTab[] = ['doc', 'board', 'flow', 'team']
const VIEW_NAMES: readonly (DirectorView | ClassicView | 'briefing')[] = [...DIRECTOR_VIEWS, ...CLASSIC_VIEWS, 'briefing']
/** v1.2 M1：跳转时需要保留的非路由查询参数（引导 / 彩排 / 演示），不参与 RouteState 编解码 */
const PRESERVED_PARAMS: readonly string[] = ['tour', 'exec', 'llm', 'mission', 'demo']

function parseUrl(url: string): URL {
  try {
    return new URL(url, URL_BASE)
  } catch {
    return new URL(URL_BASE)
  }
}

/** 开关型参数：`1` / `true` 为开（与 `lib/directorEntry.isDirectorEntry` 兼容） */
function isSwitchOn(value: string | null): boolean {
  return value === '1' || value === 'true'
}

function pickOption<T extends string>(options: readonly T[], raw: string | null): T | null {
  if (raw === null) return null
  return (options as readonly string[]).includes(raw) ? (raw as T) : null
}

function safeId(raw: string | null): string | null {
  if (raw === null) return null
  const value = raw.trim()
  if (!value || value.length > MAX_ID_LENGTH || /\s/.test(value)) return null
  return value
}

/** 参数出现过但解析失败：按「非法目标参数」整体丢弃 target（安全默认） */
function isInvalidParam(raw: string | null, parsed: string | null): boolean {
  return raw !== null && parsed === null
}

/**
 * URL → RouteState（纯函数，每次返回新对象）。
 * 入参可以是完整 href、`?a=b` 查询串或 `''`（SSR / 测试默认路由）。
 */
export function parseRoute(url: string): RouteState {
  const parsed = parseUrl(url)
  // 分享短链最高优先：不处理 hash，直接回默认路由（调用方先判断 #share=）
  if (parsed.hash.startsWith('#share=')) return { ...DEFAULT_ROUTE }

  const params = parsed.searchParams
  const legacy = isSwitchOn(params.get('legacy'))
  const wantsDirector = !legacy && (isSwitchOn(params.get('v2')) || isSwitchOn(params.get('v1')))

  const rawView = params.get('view')
  const view = pickOption(VIEW_NAMES, rawView)
  const rawTab = params.get('tab')
  const rightTab = pickOption(RIGHT_TABS, rawTab)

  const rawId = params.get('id')
  const rawTask = params.get('task')
  const rawAgent = params.get('agent')
  const id = safeId(rawId)
  const task = safeId(rawTask)
  const agent = pickOption(DIRECTOR_AGENT_IDS, rawAgent)

  const route: RouteState = {
    workspace: legacy || !wantsDirector ? 'classic' : 'director',
    directorView: 'inbox',
    classicView: 'chat',
    rightTab: rightTab ?? 'doc',
    target: null,
  }

  // 非法 view：工作区仍按开关决定，其余回默认安全值（directorView=inbox / target=null）
  if (rawView !== null && view === null) return route

  if (view === 'briefing') {
    route.workspace = 'classic'
    if (isInvalidParam(rawId, id)) return route
    route.target = id ? { kind: 'briefing', cardId: id } : { kind: 'briefing' }
    return route
  }

  if (view === 'chat' || view === 'loom') {
    // view 决定工作区：聊天 / 空间任务台总是经典工作区（即使带了 ?v2=1）
    route.workspace = 'classic'
    route.classicView = view
    if (isInvalidParam(rawId, id)) return route
    route.target = id ? { kind: view, id } : { kind: view }
    return route
  }

  if (view === null) {
    // 无 view：`?id` 视为文档深链（encodeRoute 对 {kind:'doc'} 的规范形式）
    if (rawId !== null) {
      if (id === null) return route
      route.target = { kind: 'doc', id }
    }
    return route
  }

  // 剩余 = Director 三屏；legacy 强制经典工作区，忽略 Director 视图
  if (legacy) return route
  route.workspace = 'director'
  route.directorView = view

  if (view === 'team') {
    if (isInvalidParam(rawAgent, agent)) return route
    route.target = agent ? { kind: 'team', agentId: agent } : { kind: 'team' }
    return route
  }

  if (view === 'inbox') {
    // 收件箱上的 `?id` 指向某条决策（WorkTarget.decision），无 id 则只到工作区
    if (isInvalidParam(rawId, id)) return route
    route.target = id ? { kind: 'decision', id } : { kind: 'inbox' }
    return route
  }

  // view === 'mission'：`?id` = missionId，`?task` = taskId
  if (isInvalidParam(rawId, id) || isInvalidParam(rawTask, task)) return route
  route.target = {
    kind: 'mission',
    ...(id ? { id } : {}),
    ...(task ? { taskId: task } : {}),
  }
  return route
}

/**
 * RouteState → 查询串（只写非默认值；默认路由返回 `''`）。
 * 无法用协议表达的 WorkTarget（board 的 role、decision 的 id 语义）按最接近的规范形式落 URL。
 */
export function encodeRoute(route: RouteState): string {
  const params = new URLSearchParams()
  // 经典工作区是默认，只有总指挥工作区需要参数
  if (route.workspace === 'director') params.set('v2', '1')

  let view: string | null = null
  let id: string | undefined
  let taskId: string | undefined
  let agentId: string | undefined
  let tab: RightTab | null = null

  const target = route.target
  if (target) {
    switch (target.kind) {
      case 'inbox':
        view = 'inbox'
        break
      case 'mission':
        view = 'mission'
        id = target.id
        taskId = target.taskId
        break
      case 'team':
        view = 'team'
        agentId = target.agentId
        break
      case 'chat':
        view = 'chat'
        id = target.id
        break
      case 'loom':
        view = 'loom'
        id = target.id
        break
      case 'briefing':
        view = 'briefing'
        id = target.cardId
        break
      case 'decision':
        // 决策深链落在收件箱：view=inbox + id
        view = 'inbox'
        id = target.id
        break
      case 'doc':
        // 文档深链：无 view，`?id` 即文档 id，右栏固定 doc
        id = target.id
        tab = 'doc'
        break
      case 'board':
        // 看板深链：role 由当前身份决定，不进 URL（target 在刷新后由外壳补全）
        tab = 'board'
        break
    }
  } else if (route.workspace === 'director' && route.directorView !== 'inbox') {
    // 无 target 时把当前视图写进 URL，保证刷新后视图不丢
    view = route.directorView
  } else if (route.workspace === 'classic' && route.classicView !== 'chat') {
    view = route.classicView
  }

  if (view) params.set('view', view)
  if (id) params.set('id', id)
  if (taskId) params.set('task', taskId)
  if (agentId) params.set('agent', agentId)
  const rightTab = tab ?? route.rightTab
  if (rightTab !== 'doc') params.set('tab', rightTab)

  const query = params.toString()
  return query ? `?${query}` : ''
}

/** 导航环境注入（单测用内存实现；生产由 routeStore / M1 外壳传 window.history 包装） */
export interface NavigatorEnv {
  getLocation(): string
  pushState(state: unknown, url: string): void
  replaceState(state: unknown, url: string): void
  back(): void
}

/** WorkTarget → 工作区 / 视图 / 右栏（open 的映射表，见任务说明与 §3.2） */
function applyTarget(route: RouteState, target: WorkTarget): RouteState {
  const next: RouteState = { ...route, target }
  switch (target.kind) {
    case 'inbox':
      return { ...next, workspace: 'director', directorView: 'inbox' }
    case 'mission':
      return { ...next, workspace: 'director', directorView: 'mission' }
    case 'team':
      return { ...next, workspace: 'director', directorView: 'team' }
    case 'chat':
      return { ...next, workspace: 'classic', classicView: 'chat' }
    case 'loom':
      return { ...next, workspace: 'classic', classicView: 'loom' }
    case 'doc':
      return { ...next, workspace: 'classic', rightTab: 'doc' }
    case 'decision':
      return { ...next, workspace: 'director', directorView: 'inbox' }
    case 'briefing':
      return { ...next, workspace: 'classic' }
    case 'board':
      return { ...next, workspace: 'classic', rightTab: 'board' }
  }
}

/** 目标 URL：保留当前 path，清掉不参与路由的 hash；并保留只读查询参数（M1 §3.2） */
function buildUrl(location: string, route: RouteState): string {
  const parsed = parseUrl(location)
  const encoded = encodeRoute(route)
  const params = new URLSearchParams(encoded.startsWith('?') ? encoded.slice(1) : encoded)
  /* 统一工作区（`?v2=1` 影子期）：一旦进入新壳，跨工作区跳转必须保留 v2 开关——
     否则「总指挥 → 经典」后 URL 退回无参、刷新会掉回旧壳。经典工作区额外补 view=chat|loom，
     保证刷新后仍解析为经典工作区（`?v2=1` 单独出现默认是总指挥战情台）。 */
  const studioShell = isSwitchOn(parsed.searchParams.get('v2')) || route.workspace === 'director'
  if (studioShell) {
    if (!params.has('v2')) params.set('v2', '1')
    if (route.workspace === 'classic' && !params.has('view')) params.set('view', route.classicView)
  }
  /* 非路由参数在跳转后不能丢：`?tour=`（引导）、`?exec=` / `?llm=`（执行/拆解彩排）、
     `?mission=`（演示兜底种计划）、`?demo=`（演示标识）。路由参数以 RouteState 为准。 */
  for (const key of PRESERVED_PARAMS) {
    if (params.has(key)) continue
    const value = parsed.searchParams.get(key)
    if (value !== null) params.set(key, value)
  }
  /* 固定输出顺序（v2 → view → id → task → agent → tab → 保留参数），避免 URL 噪音与断言漂移 */
  const ordered = new URLSearchParams()
  const put = (key: string): void => {
    const value = params.get(key)
    if (value !== null) ordered.set(key, value)
  }
  ;['v2', 'view', 'id', 'task', 'agent', 'tab'].forEach(put)
  for (const key of PRESERVED_PARAMS) put(key)
  const query = ordered.toString()
  return `${parsed.pathname}${query ? `?${query}` : ''}`
}

/**
 * 创建 Navigator（内存栈长度维护 canBack；真实 popstate 回灌由 M1 外壳消费 state.route）。
 * - open：按目标映射工作区/视图/右栏后跳转；
 * - go：局部合并 RouteState 后跳转；
 * - system 来源或 opts.replace 走 replaceState，其余 pushState（栈 depth +1）。
 */
export function createNavigator(env: NavigatorEnv): Navigator {
  let current = parseRoute(env.getLocation())
  let depth = 0

  const commit = (next: RouteState, opts?: { replace?: boolean; source?: 'user' | 'system' | 'deep-link' }): void => {
    const replace = opts?.replace === true || opts?.source === 'system'
    const url = buildUrl(env.getLocation(), next)
    const state = { route: next }
    if (replace) {
      env.replaceState(state, url)
    } else {
      env.pushState(state, url)
      depth += 1
    }
    current = next
  }

  return {
    open(target: WorkTarget, opts?: { replace?: boolean; source?: 'user' | 'system' | 'deep-link' }): void {
      commit(applyTarget(current, target), opts)
    },
    go(partial: Partial<RouteState>, opts?: { replace?: boolean }): void {
      commit({ ...current, ...partial }, opts)
    },
    back(): void {
      if (depth <= 0) return
      depth -= 1
      env.back()
    },
    canBack(): boolean {
      return depth > 0
    },
    /** v1.2 M1：popstate 后与 URL 对齐（浏览器返回栈已由真实 history 变化，depth 同步减一） */
    syncFromLocation(): RouteState {
      current = parseRoute(env.getLocation())
      depth = Math.max(0, depth - 1)
      return current
    },
    depth(): number {
      return depth
    },
    currentRoute(): RouteState {
      return current
    },
  }
}
