/**
 * v1.2 M1 · 路由运行时 / 旧 stage 桥 / 委托槽 / 视图注册表 单测（§3.2 / §3.3 / §3.4 / §3.9）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ROUTE, type RouteState } from '../studio/contracts'
import {
  applyStageRouteIntent,
  createStudioRouter,
  goRoute,
  navigateTo,
  stageRouteIntent,
  studioRouter,
} from '../studio/router'
import {
  clearPendingIntent,
  consumePendingIntent,
  peekPendingIntent,
  submitIntent,
} from '../studio/intent'
import { studioBus } from '../studio/bus'
import { useRouteStore } from '../stores/routeStore'
import { planEntry } from '../lib/entryPlan'
import { isLegacyRequested, isStudioV2Enabled } from '../lib/studioEntry'
import {
  getSurfaceDef,
  listSurfaces,
  registerSurface,
  resetSurfaces,
  unregisterSurface,
  type SurfaceProps,
} from '../shell/SurfaceHost'

function fakeRouter(location: string) {
  const calls: { type: 'push' | 'replace' | 'back'; url: string }[] = []
  let current = location
  const router = createStudioRouter({
    getLocation: () => current,
    pushState: (_state: unknown, url: string) => {
      calls.push({ type: 'push', url })
      current = url
    },
    replaceState: (_state: unknown, url: string) => {
      calls.push({ type: 'replace', url })
      current = url
    },
    back: () => calls.push({ type: 'back', url: current }),
  })
  return { router, calls, getLocation: () => current }
}

describe('stage → route 桥（旧组件 setStage 不改，统一壳按 route 渲染）', () => {
  it('command / briefing / workbench / login 的意图矩阵', () => {
    expect(stageRouteIntent('command')).toEqual({ kind: 'open', target: { kind: 'inbox' } })
    expect(stageRouteIntent('briefing')).toEqual({ kind: 'open', target: { kind: 'briefing' } })
    expect(stageRouteIntent('workbench')).toEqual({
      kind: 'go',
      route: { workspace: 'classic', classicView: 'chat', rightTab: 'doc', target: null },
    })
    expect(stageRouteIntent('login')).toBeNull()
  })

  it('applyStageRouteIntent 真正写入 URL 与 routeStore（briefing → 经典工作区发现区）', () => {
    window.history.replaceState({}, '', '/')
    applyStageRouteIntent('briefing')
    expect(useRouteStore.getState().route.workspace).toBe('classic')
    expect(useRouteStore.getState().route.target).toEqual({ kind: 'briefing' })
    expect(window.location.search).toContain('view=briefing')
  })
})

describe('路由运行时（createStudioRouter / 单例导航）', () => {
  beforeEach(() => {
    useRouteStore.getState().setRoute({ ...DEFAULT_ROUTE })
    window.history.replaceState({}, '', '/')
  })

  it('syncFromUrl：冷启动深链解析进 routeStore', () => {
    const { router } = fakeRouter('https://edu.local/?v2=1&view=mission&id=m-1&task=t-2&tab=doc')
    const route = router.syncFromUrl()
    expect(route.workspace).toBe('director')
    expect(route.directorView).toBe('mission')
    expect(route.target).toEqual({ kind: 'mission', id: 'm-1', taskId: 't-2' })
    expect(useRouteStore.getState().route.target).toEqual({ kind: 'mission', id: 'm-1', taskId: 't-2' })
  })

  it('navigateTo：pushState 且 URL/store 同步（用户主动跳转）', () => {
    navigateTo({ kind: 'team', agentId: 'analyst' })
    const route = useRouteStore.getState().route
    expect(route.workspace).toBe('director')
    expect(route.directorView).toBe('team')
    expect(route.target).toEqual({ kind: 'team', agentId: 'analyst' })
    expect(window.location.search).toContain('v2=1')
    expect(window.location.search).toContain('view=team')
    expect(window.location.search).toContain('agent=analyst')
  })

  it('goRoute：局部合并后 URL 规范化（清 target；统一壳保留 v2+view，刷新仍经典）', () => {
    navigateTo({ kind: 'inbox' })
    goRoute({ workspace: 'classic', classicView: 'chat', target: null })
    const route = useRouteStore.getState().route
    expect(route.workspace).toBe('classic')
    expect(route.classicView).toBe('chat')
    expect(route.target).toBeNull()
    expect(window.location.search).toContain('v2=1')
    expect(window.location.search).toContain('view=chat')
  })

  it('start() 后 popstate 回灌：URL 变化 → navigator 内部 current 与 store 对齐', () => {
    const { router } = fakeRouter('https://edu.local/?v2=1&view=inbox')
    router.start()
    expect(useRouteStore.getState().route.directorView).toBe('inbox')
    // 模拟浏览器返回：URL 变成上一页（mitm't 由真实 history 负责，这里只测回灌口径）
    window.history.replaceState({}, '', '/?v2=1&view=inbox')
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(useRouteStore.getState().route.directorView).toBe('inbox')
  })

  it('单例 navigator 的 open/system 语义：system 用 replace、其余 push', () => {
    const { router, calls } = fakeRouter('https://edu.local/?v2=1')
    router.navigator.open({ kind: 'mission' })
    router.navigator.open({ kind: 'inbox' }, { source: 'system' })
    expect(calls.map((c) => c.type)).toEqual(['push', 'replace'])
    expect(calls[0].url).toContain('view=mission')
    expect(calls[1].url).toContain('view=inbox')
  })

  it('navigator.syncFromLocation：popstate 后 current 对齐 URL 且 depth 递减不为负', () => {
    const { router, calls } = fakeRouter('https://edu.local/?v2=1')
    router.navigator.open({ kind: 'mission' })
    const depthBefore = router.navigator.depth?.() ?? 0
    router.navigator.syncFromLocation?.()
    expect(router.navigator.depth?.()).toBe(Math.max(0, depthBefore - 1))
    expect(calls.length).toBeGreaterThan(0)
  })

  it('非路由参数在跳转后保留（?tour/?exec/?mission 等，避免引导重弹/演示参数丢失）', () => {
    const { router, calls } = fakeRouter('https://edu.local/?v2=1&tour=0&exec=mock&mission=exam_loop')
    router.navigator.open({ kind: 'mission' })
    router.navigator.go({ workspace: 'classic', classicView: 'chat', target: null })
    expect(calls[0].url).toContain('tour=0')
    expect(calls[0].url).toContain('exec=mock')
    expect(calls[1].url).toContain('tour=0')
    expect(calls[1].url).toContain('mission=exam_loop')
    /* 统一工作区模式跨工作区保留：切经典后仍带 v2=1 + view=chat，刷新不会掉回旧壳 */
    expect(calls[1].url).toContain('v2=1')
    expect(calls[1].url).toContain('view=chat')
  })
})

describe('一句话委托待消费槽（主 chunk → Director chunk）', () => {
  beforeEach(() => clearPendingIntent())

  it('submitIntent 去空白、写槽、同步广播 intent.submitted', () => {
    const seen: string[] = []
    const off = studioBus.on('intent.submitted', (e) => seen.push(e.intent))
    submitIntent('  下周三家长会  ', 'inbox')
    expect(seen).toEqual(['下周三家长会'])
    expect(peekPendingIntent()?.intent).toBe('下周三家长会')
    expect(peekPendingIntent()?.source).toBe('inbox')
    off()
  })

  it('consumePendingIntent 只消费一次；空文本忽略', () => {
    submitIntent('   ', 'chat')
    expect(peekPendingIntent()).toBeNull()
    submitIntent('出一份分层练习单', 'chat')
    expect(consumePendingIntent()?.intent).toBe('出一份分层练习单')
    expect(consumePendingIntent()).toBeNull()
  })
})

describe('SurfaceHost 注册表（视图级懒加载）', () => {
  const load = async (): Promise<{ default: (props: SurfaceProps) => JSX.Element }> => ({
    default: () => ({}) as JSX.Element,
  })

  beforeEach(() => resetSurfaces())

  it('register / get / list / unregister / 同 id 幂等覆盖', () => {
    registerSurface({ id: 'inbox', title: '战情台', load })
    registerSurface({ id: 'mission', title: '作战室', load })
    expect(getSurfaceDef('inbox')?.title).toBe('战情台')
    expect(listSurfaces().map((d) => d.id).sort()).toEqual(['inbox', 'mission'])
    registerSurface({ id: 'inbox', title: '战情台 v2', load })
    expect(getSurfaceDef('inbox')?.title).toBe('战情台 v2')
    unregisterSurface('mission')
    expect(getSurfaceDef('mission')).toBeUndefined()
  })

  it('requires 字段保留工作区约束（team 需要 director）', () => {
    registerSurface({ id: 'team', title: '战队', load, requires: 'director' })
    expect(getSurfaceDef('team')?.requires).toBe('director')
  })
})

describe('入口开关：M4 默认期 / ?legacy=1 回滚', () => {
  it('isStudioV2Enabled：v2 开关、legacy 强制回滚、M4 无参数 teacher 默认 on', () => {
    expect(isStudioV2Enabled('?v2=1', 'teacher')).toBe(true)
    expect(isStudioV2Enabled('?v2=0', 'teacher')).toBe(false)
    expect(isStudioV2Enabled('?v2=1&legacy=1', 'teacher')).toBe(false)
    /* M4：?v1=1 由入口计划重定向到新壳（isStudioV2Enabled 在 URL 规范化后为 true）；无参数 teacher 默认开 */
    expect(isStudioV2Enabled('?v1=1', 'teacher')).toBe(true)
    expect(isStudioV2Enabled('', 'teacher')).toBe(true)
    expect(isStudioV2Enabled('', 'schoolAdmin')).toBe(false)
  })

  it('isLegacyRequested 只认 1/true', () => {
    expect(isLegacyRequested('?legacy=1')).toBe(true)
    expect(isLegacyRequested('?legacy=true')).toBe(true)
    expect(isLegacyRequested('?legacy=0')).toBe(false)
    expect(isLegacyRequested('')).toBe(false)
  })

  it('planEntry：?v2=1 进统一壳，未登录补教师、不写旧引导位；v2 优先于 v1/demo', () => {
    expect(planEntry('?v2=1', '', null)).toMatchObject({
      kind: 'studio',
      loginRole: 'teacher',
      markGuideSeen: false,
    })
    expect(planEntry('?v2=1', '', 'teacher')).toMatchObject({ kind: 'studio', loginRole: null })
    expect(planEntry('?v2=1&v1=1&demo=1', '', 'teacher').kind).toBe('studio')
    expect(planEntry('?v2=1&legacy=1', '', 'teacher').kind).toBe('none')
    expect(planEntry('?v2=1', '#share=abc', null).kind).toBe('none')
  })
})
