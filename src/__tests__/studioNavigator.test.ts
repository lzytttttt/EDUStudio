/**
 * v1.2 M0 · 深链协议与 Navigator 矩阵单测（roadmap §3.2）
 * 覆盖：v2/v1/legacy 工作区、view/id/task/agent/tab、非法参数回安全默认、
 * #share= 不参与路由、encode→parse 往返、push vs replace、back/canBack、open 目标映射。
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_ROUTE } from '../studio/contracts'
import { createNavigator, encodeRoute, parseRoute, type NavigatorEnv } from '../studio/navigator'

interface MemoryEnv extends NavigatorEnv {
  entries: { type: 'push' | 'replace' | 'back'; url: string }[]
  state: unknown
  location(): string
}

function createEnv(initialLocation = '/'): MemoryEnv {
  let location = initialLocation
  const env: MemoryEnv = {
    entries: [],
    state: null,
    location: () => location,
    getLocation: () => location,
    pushState(state, url) {
      env.state = state
      location = url
      env.entries.push({ type: 'push', url })
    },
    replaceState(state, url) {
      env.state = state
      location = url
      env.entries.push({ type: 'replace', url })
    },
    back() {
      env.entries.push({ type: 'back', url: location })
    },
  }
  return env
}

const pushes = (env: MemoryEnv) => env.entries.filter((entry) => entry.type === 'push')
/** tsconfig lib 为 ES2020：不用 Array.prototype.at，统一取末项 */
const last = <T>(list: T[]): T => list[list.length - 1]

describe('parseRoute · 深链工作区', () => {
  it('无参数 / 空串 → 默认路由（经典工作区 + 对话 + 文档栏）', () => {
    expect(parseRoute('')).toEqual(DEFAULT_ROUTE)
    expect(parseRoute('/')).toEqual(DEFAULT_ROUTE)
    expect(parseRoute('https://studio.local/?tour=0')).toEqual(DEFAULT_ROUTE)
  })

  it('?v2=1 → 总指挥工作区（影子期），无 target', () => {
    const route = parseRoute('?v2=1')
    expect(route.workspace).toBe('director')
    expect(route.directorView).toBe('inbox')
    expect(route.target).toBeNull()
  })

  it('?v1=1 兼容别名 → 总指挥工作区', () => {
    expect(parseRoute('?v1=1&tour=0').workspace).toBe('director')
    expect(parseRoute('?v1=true').workspace).toBe('director')
  })

  it('?legacy=1 强制经典工作区；与 v1=1 联用仍是经典（旧整屏由调用方判断）', () => {
    expect(parseRoute('?legacy=1').workspace).toBe('classic')
    const forced = parseRoute('?v1=1&legacy=1&view=mission')
    expect(forced.workspace).toBe('classic')
    expect(forced.target).toBeNull()
  })

  it('?v2=1 后接 view 深链：mission + id/task', () => {
    const route = parseRoute('?v2=1&view=mission&id=m-1&task=t-2')
    expect(route.workspace).toBe('director')
    expect(route.directorView).toBe('mission')
    expect(route.target).toEqual({ kind: 'mission', id: 'm-1', taskId: 't-2' })
  })

  it('?view=team&agent=analyst → 战队目标；无 agent 时只到战队视图', () => {
    expect(parseRoute('?v2=1&view=team&agent=analyst').target).toEqual({ kind: 'team', agentId: 'analyst' })
    expect(parseRoute('?v2=1&view=team').target).toEqual({ kind: 'team' })
  })

  it('?view=inbox → inbox 目标；带 ?id 时指向决策', () => {
    expect(parseRoute('?v2=1&view=inbox').target).toEqual({ kind: 'inbox' })
    expect(parseRoute('?v2=1&view=inbox&id=dec-1').target).toEqual({ kind: 'decision', id: 'dec-1' })
  })

  it('?view=chat / loom 总是经典工作区（即使带 ?v2=1），并保留 id', () => {
    const chat = parseRoute('?v2=1&view=chat')
    expect(chat.workspace).toBe('classic')
    expect(chat.classicView).toBe('chat')
    expect(chat.target).toEqual({ kind: 'chat' })
    expect(parseRoute('?v2=1&view=loom&id=n-1').target).toEqual({ kind: 'loom', id: 'n-1' })
  })

  it('?view=briefing → 经典工作区 + briefing 目标（cardId 来自 ?id）', () => {
    const route = parseRoute('?view=briefing&id=card-9')
    expect(route.workspace).toBe('classic')
    expect(route.target).toEqual({ kind: 'briefing', cardId: 'card-9' })
  })

  it('?tab 解析：合法进右栏，非法/缺省回 doc', () => {
    expect(parseRoute('?v2=1&tab=board').rightTab).toBe('board')
    expect(parseRoute('?v2=1&tab=flow').rightTab).toBe('flow')
    expect(parseRoute('?v2=1&tab=team').rightTab).toBe('team')
    expect(parseRoute('?v2=1&tab=bogus').rightTab).toBe('doc')
    expect(parseRoute('?v2=1').rightTab).toBe('doc')
  })

  it('非法 view：工作区按开关保留，directorView 回 inbox、target=null', () => {
    const route = parseRoute('?v2=1&view=bogus&id=x-1&task=t-1&agent=hacker')
    expect(route.workspace).toBe('director')
    expect(route.directorView).toBe('inbox')
    expect(route.target).toBeNull()
    // 无 v2 时非法 view 回完整默认安全值
    expect(parseRoute('?view=nope')).toEqual(DEFAULT_ROUTE)
  })

  it('非法 id / task / agent：整体丢弃 target（安全默认）', () => {
    expect(parseRoute('?v2=1&view=mission&id=').target).toBeNull()
    expect(parseRoute('?v2=1&view=mission&id=has%20space').target).toBeNull()
    expect(parseRoute('?v2=1&view=mission&task=').target).toBeNull()
    expect(parseRoute('?v2=1&view=team&agent=hacker').target).toBeNull()
    // view 本身仍合法，只丢 target
    expect(parseRoute('?v2=1&view=team&agent=hacker').directorView).toBe('team')
  })

  it('#share= 不参与路由：即使带 ?v2=1&view=mission 也返回默认经典路由', () => {
    const route = parseRoute('https://studio.local/?v2=1&view=mission&id=m-1#share=abc123')
    expect(route).toEqual(DEFAULT_ROUTE)
  })

  it('无 view 时 ?id 视为文档深链（encodeRoute 的规范形式）', () => {
    expect(parseRoute('?id=doc-1').target).toEqual({ kind: 'doc', id: 'doc-1' })
    expect(parseRoute('?id=doc-1').workspace).toBe('classic')
  })
})

describe('encodeRoute · 编解码往返', () => {
  it('默认路由编码为空串（只写非默认值）', () => {
    expect(encodeRoute(DEFAULT_ROUTE)).toBe('')
  })

  it('总指挥工作区写 ?v2=1，经典工作区不写工作区参数', () => {
    expect(encodeRoute({ ...DEFAULT_ROUTE, workspace: 'director' })).toBe('?v2=1')
    expect(encodeRoute({ ...DEFAULT_ROUTE, classicView: 'loom' })).toBe('?view=loom')
  })

  it('encode → parse 往返：mission / team / 决策 / 文档', () => {
    const cases = [
      { ...DEFAULT_ROUTE, workspace: 'director' as const, directorView: 'mission' as const, target: { kind: 'mission' as const, id: 'm-1', taskId: 't-2' } },
      { ...DEFAULT_ROUTE, workspace: 'director' as const, directorView: 'team' as const, target: { kind: 'team' as const, agentId: 'assessor' as const } },
      { ...DEFAULT_ROUTE, workspace: 'director' as const, directorView: 'inbox' as const, target: { kind: 'decision' as const, id: 'dec-1' } },
      { ...DEFAULT_ROUTE, target: { kind: 'doc' as const, id: 'doc-1' } },
      { ...DEFAULT_ROUTE, target: { kind: 'briefing' as const, cardId: 'card-1' } },
    ]
    for (const route of cases) {
      expect(parseRoute(encodeRoute(route))).toEqual(route)
    }
  })

  it('板单目标只能表达右栏（role 由身份决定，不进 URL）', () => {
    const encoded = encodeRoute({ ...DEFAULT_ROUTE, rightTab: 'board', target: { kind: 'board', role: 'teacher' } })
    expect(encoded).toBe('?tab=board')
    expect(parseRoute(encoded).rightTab).toBe('board')
  })

  it('parse → encode → parse 幂等（复杂深链）', () => {
    const route = parseRoute('?v2=1&view=mission&id=m-9&task=t-3&tab=flow')
    const encoded = encodeRoute(route)
    expect(parseRoute(encoded)).toEqual(route)
    expect(encodeRoute(parseRoute(encoded))).toBe(encoded)
  })
})

describe('createNavigator · history 语义与目标映射', () => {
  it('open 按目标映射工作区/视图并 pushState（state 带 route）', () => {
    const env = createEnv('/')
    const nav = createNavigator(env)
    nav.open({ kind: 'mission', id: 'm-1' })
    expect(pushes(env)).toHaveLength(1)
    expect(pushes(env)[0].url).toBe('/?v2=1&view=mission&id=m-1')
    expect(env.state).toEqual({ route: parseRoute('/?v2=1&view=mission&id=m-1') })
  })

  it('open 目标映射表：doc → 经典 + 右栏文档；decision → 总指挥收件箱；briefing → 经典 + 简报', () => {
    const env = createEnv('/')
    const nav = createNavigator(env)

    nav.open({ kind: 'doc', id: 'doc-1' })
    expect(last(pushes(env)).url).toBe('/?id=doc-1')

    nav.open({ kind: 'decision', id: 'dec-1' })
    expect(last(pushes(env)).url).toBe('/?v2=1&view=inbox&id=dec-1')

    nav.open({ kind: 'briefing' })
    expect(last(pushes(env)).url).toBe('/?v2=1&view=briefing')

    nav.open({ kind: 'chat' })
    expect(last(pushes(env)).url).toBe('/?v2=1&view=chat')
    nav.open({ kind: 'loom', id: 'n-1' })
    expect(last(pushes(env)).url).toBe('/?v2=1&view=loom&id=n-1')

    nav.open({ kind: 'board', role: 'teacher' })
    expect(last(pushes(env)).url).toBe('/?v2=1&view=loom&tab=board')
  })

  it('默认 open（user）每次都 pushState；canBack 随栈增长', () => {
    const env = createEnv('/')
    const nav = createNavigator(env)
    expect(nav.canBack()).toBe(false)
    nav.open({ kind: 'inbox' })
    nav.open({ kind: 'team' })
    expect(nav.canBack()).toBe(true)
    expect(pushes(env)).toHaveLength(2)
  })

  it("source==='system' 走 replaceState，不增长返回栈", () => {
    const env = createEnv('/')
    const nav = createNavigator(env)
    nav.open({ kind: 'inbox' })
    expect(nav.canBack()).toBe(true)
    const depthBefore = pushes(env).length
    nav.open({ kind: 'mission' }, { source: 'system' })
    expect(last(env.entries).type).toBe('replace')
    expect(pushes(env)).toHaveLength(depthBefore)
    // 只有一次 push 的栈深：back 一次即到底
    nav.back()
    expect(nav.canBack()).toBe(false)
  })

  it('opts.replace 也走 replaceState', () => {
    const env = createEnv('/')
    const nav = createNavigator(env)
    nav.open({ kind: 'inbox' }, { replace: true })
    expect(env.entries).toHaveLength(1)
    expect(env.entries[0].type).toBe('replace')
    expect(nav.canBack()).toBe(false)
  })

  it('deep-link 来源按普通 push 处理', () => {
    const env = createEnv('/?v2=1')
    const nav = createNavigator(env)
    nav.open({ kind: 'mission' }, { source: 'deep-link' })
    expect(env.entries[0].type).toBe('push')
  })

  it('back / canBack：到底后重复 back 不再调用 env.back', () => {
    const env = createEnv('/')
    const nav = createNavigator(env)
    nav.open({ kind: 'inbox' })
    nav.open({ kind: 'team' })
    expect(nav.canBack()).toBe(true)
    nav.back()
    expect(last(env.entries).type).toBe('back')
    expect(nav.canBack()).toBe(true)
    nav.back()
    expect(nav.canBack()).toBe(false)
    const backCalls = env.entries.filter((entry) => entry.type === 'back').length
    nav.back()
    expect(env.entries.filter((entry) => entry.type === 'back')).toHaveLength(backCalls)
  })

  it('go 局部合并 RouteState 后 push（保留 target）', () => {
    const env = createEnv('/?v2=1&view=mission&id=m-1')
    const nav = createNavigator(env)
    nav.go({ rightTab: 'flow' })
    expect(pushes(env)[0].url).toBe('/?v2=1&view=mission&id=m-1&tab=flow')
    expect(env.state).toMatchObject({ route: { target: { kind: 'mission', id: 'm-1' } } })
  })
})
