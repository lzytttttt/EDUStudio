import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DIRECTOR_DENIED_NOTICE, planEntry } from '../lib/entryPlan'
import type { RoleId, Stage } from '../harness/types'

/**
 * v1.2 M0 P0-1/P0-2/P0-3 入口回归：
 * ①「URL + 当前角色 → 入口计划」纯函数矩阵；
 * ② authStore 冷启动归一 + `command` 永不落盘（一次 `?v1=1` 后无参数冷启动不粘入口）。
 * authStore 在模块加载时读 localStorage，故用 vi.resetModules + 动态 import 复现冷启动。
 */

const AUTH_KEY = 'edustudio:auth'

interface PersistedAuth {
  role: RoleId | null
  stage: Stage
}

function seedAuth(value: unknown): void {
  localStorage.setItem(AUTH_KEY, JSON.stringify(value))
}

function readAuth(): PersistedAuth | null {
  const raw = localStorage.getItem(AUTH_KEY)
  return raw ? (JSON.parse(raw) as PersistedAuth) : null
}

describe('planEntry（URL + 角色 → 入口计划）', () => {
  it('教师 + ?v1=1 → director，且不 markGuideSeen（P0-2）', () => {
    expect(planEntry('?v1=1', '', 'teacher')).toEqual({
      kind: 'director',
      loginRole: null,
      markGuideSeen: false,
      stage: 'command',
    })
  })

  it('无角色 + ?v1=1 → 先补教师登录再进 director（P0-3）', () => {
    const plan = planEntry('?v1=1', '', null)
    expect(plan.kind).toBe('director')
    expect(plan.loginRole).toBe('teacher')
    expect(plan.stage).toBe('command')
    expect(plan.markGuideSeen).toBe(false)
  })

  it('schoolAdmin + ?v1=1 → directorDenied：不登录、不指定阶段、带可见提示（P0-3）', () => {
    const plan = planEntry('?v1=1', '', 'schoolAdmin')
    expect(plan.kind).toBe('directorDenied')
    expect(plan.loginRole).toBeNull()
    expect(plan.stage).toBeUndefined()
    expect(plan.markGuideSeen).toBe(false)
    expect(plan.notice).toEqual(DIRECTOR_DENIED_NOTICE)
  })

  it('bureau + ?v1=1 → directorDenied（不覆盖身份）', () => {
    const plan = planEntry('?v1=1', '', 'bureau')
    expect(plan.kind).toBe('directorDenied')
    expect(plan.notice?.title).toBe('需要教师身份')
    expect(plan.notice?.body).toBe('总指挥工作区仅对教师开放，已返回当前工作区。')
  })

  it('无角色 + ?demo=1 → demo + 补教师 + 保留 markGuideSeen（旧行为不变）', () => {
    const plan = planEntry('?demo=1', '', null)
    expect(plan).toEqual({ kind: 'demo', loginRole: 'teacher', markGuideSeen: true })
  })

  it('已有身份 + ?demo=1 → demo 不覆盖身份、不重复登录', () => {
    expect(planEntry('?demo=1', '', 'schoolAdmin')).toEqual({
      kind: 'demo',
      loginRole: null,
      markGuideSeen: true,
    })
  })

  it('#share=... 优先于 ?v1=1 / ?demo=1：none 且无任何副作用', () => {
    const none = { kind: 'none', loginRole: null, markGuideSeen: false }
    expect(planEntry('?v1=1', '#share=abc', 'teacher')).toEqual(none)
    expect(planEntry('?demo=1', '#share=abc', null)).toEqual(none)
  })

  it('?v1=1&demo=1 → director 优先', () => {
    expect(planEntry('?v1=1&demo=1', '', null).kind).toBe('director')
  })

  it('无参数 + 已登录 → none，入口阶段由 auth 恢复决定', () => {
    expect(planEntry('', '', 'teacher')).toEqual({ kind: 'none', loginRole: null, markGuideSeen: false })
    expect(planEntry('', '', null)).toEqual({ kind: 'none', loginRole: null, markGuideSeen: false })
  })

  it('布尔串兼容：?v1=true / ?demo=true 与 =1 等价', () => {
    expect(planEntry('?v1=true', '', 'teacher').kind).toBe('director')
    expect(planEntry('?demo=true', '', null).kind).toBe('demo')
  })
})

describe('authStore 恢复归一与 command 不落盘（P0-1）', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('normalizeRestoredStage 矩阵：无角色→login；command/坏值→briefing；其余原样', async () => {
    const { normalizeRestoredStage } = await import('../stores/authStore')
    expect(normalizeRestoredStage(null, 'command')).toBe('login')
    expect(normalizeRestoredStage(null, 'briefing')).toBe('login')
    expect(normalizeRestoredStage('teacher', 'command')).toBe('briefing')
    expect(normalizeRestoredStage('schoolAdmin', 'bogus')).toBe('briefing')
    expect(normalizeRestoredStage('teacher', undefined)).toBe('briefing')
    expect(normalizeRestoredStage('teacher', 'workbench')).toBe('workbench')
    expect(normalizeRestoredStage('bureau', 'login')).toBe('login')
  })

  it('盘上 {role:teacher, stage:command} → 内存归一 briefing', async () => {
    seedAuth({ role: 'teacher', stage: 'command' })
    const { useAuthStore } = await import('../stores/authStore')
    expect(useAuthStore.getState().role).toBe('teacher')
    expect(useAuthStore.getState().stage).toBe('briefing')
  })

  it('盘上 {role:null, stage:command} → 归一 login', async () => {
    seedAuth({ role: null, stage: 'command' })
    const { useAuthStore } = await import('../stores/authStore')
    expect(useAuthStore.getState().role).toBeNull()
    expect(useAuthStore.getState().stage).toBe('login')
  })

  it('坏 stage 白名单回退：有角色 → briefing；合法非 command 值原样恢复', async () => {
    seedAuth({ role: 'teacher', stage: 'bogus' })
    let mod = await import('../stores/authStore')
    expect(mod.useAuthStore.getState().stage).toBe('briefing')

    localStorage.clear()
    vi.resetModules()
    seedAuth({ role: 'teacher', stage: 'workbench' })
    mod = await import('../stores/authStore')
    expect(mod.useAuthStore.getState().stage).toBe('workbench')
  })

  it("setStage('command') 只改内存：盘上保留之前的非 command stage", async () => {
    seedAuth({ role: 'teacher', stage: 'workbench' })
    const { useAuthStore } = await import('../stores/authStore')

    useAuthStore.getState().setStage('command')
    expect(useAuthStore.getState().stage).toBe('command')
    expect(readAuth()).toEqual({ role: 'teacher', stage: 'workbench' })
  })

  it('从未有合法值 + 无角色：setStage(command) 才补写 login', async () => {
    const { useAuthStore } = await import('../stores/authStore')

    useAuthStore.getState().setStage('command')
    expect(useAuthStore.getState().stage).toBe('command')
    expect(readAuth()).toEqual({ role: null, stage: 'login' })
  })

  it('从未有合法值 + 有角色：setStage(command) 补写 briefing（视 role 而定）', async () => {
    const { useAuthStore } = await import('../stores/authStore')
    useAuthStore.setState({ role: 'teacher' })

    useAuthStore.getState().setStage('command')
    expect(readAuth()).toEqual({ role: 'teacher', stage: 'briefing' })
  })

  it('login 写 briefing 后 setStage(command) 不覆盖落盘值', async () => {
    const { useAuthStore } = await import('../stores/authStore')

    useAuthStore.getState().login('teacher')
    expect(readAuth()).toEqual({ role: 'teacher', stage: 'briefing' })

    useAuthStore.getState().setStage('command')
    expect(useAuthStore.getState().stage).toBe('command')
    expect(readAuth()).toEqual({ role: 'teacher', stage: 'briefing' })
  })

  it('login/logout 非 command 语义不变（落盘与内存一致）', async () => {
    const { useAuthStore } = await import('../stores/authStore')

    useAuthStore.getState().login('schoolAdmin')
    expect(useAuthStore.getState()).toMatchObject({ role: 'schoolAdmin', stage: 'briefing' })
    expect(readAuth()).toEqual({ role: 'schoolAdmin', stage: 'briefing' })

    useAuthStore.getState().setStage('workbench')
    expect(readAuth()).toEqual({ role: 'schoolAdmin', stage: 'workbench' })

    useAuthStore.getState().logout()
    expect(useAuthStore.getState()).toMatchObject({ role: null, stage: 'login' })
    expect(readAuth()).toEqual({ role: null, stage: 'login' })
  })

  it('模拟 ?v1=1 冷启动后无参数重开：不会粘在 command（P0-1 端到端回归）', async () => {
    const { useAuthStore } = await import('../stores/authStore')

    /* ① `?v1=1` 冷启动：无角色 → 补教师 → 临时 command */
    const plan = planEntry('?v1=1', '', useAuthStore.getState().role)
    expect(plan.loginRole).toBe('teacher')
    useAuthStore.getState().login(plan.loginRole!)
    useAuthStore.getState().setStage(plan.stage!)
    expect(useAuthStore.getState().stage).toBe('command')
    expect(readAuth()).toEqual({ role: 'teacher', stage: 'briefing' })

    /* ② 重新加载模块模拟无参数冷启动：恢复到 briefing，不再进 Director */
    vi.resetModules()
    const reopened = await import('../stores/authStore')
    expect(reopened.useAuthStore.getState().stage).toBe('briefing')
    expect(planEntry('', '', reopened.useAuthStore.getState().role).kind).toBe('none')
  })
})
