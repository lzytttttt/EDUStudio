/**
 * v1.2 M0 · 功能开关解析单测（roadmap §3.9）
 * 覆盖：5 个 flag × 四层优先级（URL > settings > 角色默认 > 构建默认）、
 * ?legacy=1 强制全 off、?exec=real/mock、非法值穿透、teacher 影子期/默认期。
 */
import { describe, expect, it } from 'vitest'
import type { RoleId } from '../harness/types'
import type { FlagContext, FlagName, StudioSettings } from '../studio/contracts'
import { resolveFlag } from '../studio/flags'

const ALL_FLAGS: FlagName[] = ['studioV2', 'derivedInbox', 'unifiedDeliverables', 'realExecution', 'agentMemory']

const ctx = (over: Partial<FlagContext> = {}): FlagContext => ({ search: '', ...over })
const flag = (name: FlagName, role: RoleId | null = null, over: Partial<FlagContext> = {}) =>
  resolveFlag(name, role, ctx(over))

/** 构造 settings.studio 段（只填测试关心的字段） */
const studio = (over: Partial<StudioSettings> = {}): Partial<StudioSettings> => ({
  landing: 'auto',
  execution: 'auto',
  onboarded: false,
  digest: { pendingDecisions: 0, runningMissions: 0, runningTasks: 0, unreadDocs: 0, updatedAt: 0 },
  ...over,
})

describe('resolveFlag · URL 层（最高优先）', () => {
  it('?v2=1 → studioV2 与三个派生能力子开关全开（source=url）', () => {
    for (const name of ['studioV2', 'derivedInbox', 'unifiedDeliverables', 'agentMemory'] as FlagName[]) {
      expect(flag(name, null, { search: '?v2=1' })).toEqual({ value: true, source: 'url' })
    }
  })

  it('?v2=0 → studioV2 与三个派生能力子开关全关（source=url）', () => {
    for (const name of ['studioV2', 'derivedInbox', 'unifiedDeliverables', 'agentMemory'] as FlagName[]) {
      expect(flag(name, null, { search: '?v2=0' })).toEqual({ value: false, source: 'url' })
    }
  })

  it('?v2=true / ?v2=false 与 1/0 等价', () => {
    expect(flag('studioV2', null, { search: '?v2=true' })).toEqual({ value: true, source: 'url' })
    expect(flag('studioV2', null, { search: '?v2=false' })).toEqual({ value: false, source: 'url' })
  })

  it('?exec=real / ?exec=mock 只表达 realExecution', () => {
    expect(flag('realExecution', null, { search: '?exec=real' })).toEqual({ value: true, source: 'url' })
    expect(flag('realExecution', null, { search: '?exec=mock' })).toEqual({ value: false, source: 'url' })
    // ?v2=1 不承诺真执行：realExecution 交给下一层（无其它层时默认 false）
    expect(flag('realExecution', null, { search: '?v2=1' })).toEqual({ value: false, source: 'build' })
    expect(flag('studioV2', null, { search: '?exec=real' })).toEqual({ value: false, source: 'build' })
  })

  it('?legacy=1 强制全 off（即使同时带 ?v2=1 / ?exec=real）', () => {
    for (const name of ALL_FLAGS) {
      expect(flag(name, 'teacher', { search: '?legacy=1&v2=1&exec=real' })).toEqual({ value: false, source: 'url' })
    }
  })

  it('非法 URL 值（?v2=maybe&exec=fast）视为本层无意见，穿透到构建默认', () => {
    expect(flag('studioV2', null, { search: '?v2=maybe', buildDefault: { studioV2: true } })).toEqual({
      value: true,
      source: 'build',
    })
    expect(flag('realExecution', null, { search: '?exec=fast', buildDefault: { realExecution: true } })).toEqual({
      value: true,
      source: 'build',
    })
  })
})

describe('resolveFlag · settings.studio 层', () => {
  it('settings.flags 显式 on/off 覆盖（source=settings）', () => {
    expect(flag('derivedInbox', null, { settings: studio({ flags: { derivedInbox: 'on' } }) })).toEqual({
      value: true,
      source: 'settings',
    })
    expect(flag('agentMemory', null, { settings: studio({ flags: { agentMemory: 'off' } }), buildDefault: { agentMemory: true } })).toEqual({
      value: false,
      source: 'settings',
    })
  })

  it('settings.landing：选战情台 → studioV2 on；选简报/工作台 → off；auto 无意见', () => {
    expect(flag('studioV2', null, { settings: studio({ landing: 'inbox' }) })).toEqual({ value: true, source: 'settings' })
    expect(flag('studioV2', null, { settings: studio({ landing: 'briefing' }) })).toEqual({ value: false, source: 'settings' })
    expect(flag('studioV2', null, { settings: studio({ landing: 'workbench' }) })).toEqual({ value: false, source: 'settings' })
    expect(flag('studioV2', null, { settings: studio({ landing: 'auto' }), buildDefault: { studioV2: true } })).toEqual({
      value: true,
      source: 'build',
    })
  })

  it('settings.execution：real / mock 表达 realExecution，auto 无意见', () => {
    expect(flag('realExecution', null, { settings: studio({ execution: 'real' }) })).toEqual({ value: true, source: 'settings' })
    expect(flag('realExecution', null, { settings: studio({ execution: 'mock' }) })).toEqual({ value: false, source: 'settings' })
    expect(flag('realExecution', null, { settings: studio({ execution: 'auto' }) })).toEqual({ value: false, source: 'build' })
  })

  it('URL 覆盖 settings（?v2=0 + settings 开）', () => {
    expect(
      flag('studioV2', null, { search: '?v2=0', settings: studio({ landing: 'inbox', flags: { studioV2: 'on' } }) }),
    ).toEqual({ value: false, source: 'url' })
  })
})

describe('resolveFlag · 角色默认层（teacher 影子期 / M4 默认期）', () => {
  it('影子期（defaultMode 缺省）teacher 全 off（source=roleDefault）', () => {
    for (const name of ALL_FLAGS) {
      expect(flag(name, 'teacher')).toEqual({ value: false, source: 'roleDefault' })
    }
  })

  it('M4 默认期（defaultMode=default）teacher 全 on（source=roleDefault）', () => {
    for (const name of ALL_FLAGS) {
      expect(flag(name, 'teacher', { defaultMode: 'default' })).toEqual({ value: true, source: 'roleDefault' })
    }
  })

  it('settings 覆盖角色默认（teacher 默认期 + execution=mock）', () => {
    expect(
      flag('realExecution', 'teacher', { defaultMode: 'default', settings: studio({ execution: 'mock' }) }),
    ).toEqual({ value: false, source: 'settings' })
  })

  it('teacher 默认期仍可被 ?legacy=1 全关（回滚优先）', () => {
    for (const name of ALL_FLAGS) {
      expect(flag(name, 'teacher', { defaultMode: 'default', search: '?legacy=1' })).toEqual({
        value: false,
        source: 'url',
      })
    }
  })
})

describe('resolveFlag · 非 teacher 与构建默认层', () => {
  it('未登录（role=null）→ 构建默认（缺省 false）', () => {
    for (const name of ALL_FLAGS) {
      expect(flag(name, null)).toEqual({ value: false, source: 'build' })
    }
  })

  it('校/局角色不给角色默认（D14），交给构建默认', () => {
    expect(flag('studioV2', 'bureau')).toEqual({ value: false, source: 'build' })
    expect(flag('studioV2', 'schoolAdmin', { defaultMode: 'default' })).toEqual({ value: false, source: 'build' })
    expect(flag('derivedInbox', 'bureau', { buildDefault: { derivedInbox: true } })).toEqual({
      value: true,
      source: 'build',
    })
  })

  it('构建默认可为每个 flag 单独给值（缺省 false）', () => {
    const buildDefault: Partial<Record<FlagName, boolean>> = { agentMemory: true, studioV2: true }
    expect(flag('agentMemory', null, { buildDefault })).toEqual({ value: true, source: 'build' })
    expect(flag('studioV2', null, { buildDefault })).toEqual({ value: true, source: 'build' })
    expect(flag('unifiedDeliverables', null, { buildDefault })).toEqual({ value: false, source: 'build' })
  })

  it('legacy 同时压过 settings 与构建默认', () => {
    for (const name of ALL_FLAGS) {
      expect(
        flag(name, 'teacher', {
          search: '?legacy=1',
          settings: studio({ flags: { [name]: 'on' } }),
          buildDefault: { [name]: true },
        }),
      ).toEqual({ value: false, source: 'url' })
    }
  })
})
