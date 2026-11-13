/**
 * v1.2 M2 · settings.studio（工作区设置）单测（roadmap §3.9 / §6 M2）
 * 覆盖：读回归一矩阵、更新与持久化、引导重置、开关解析（URL > settings > 角色默认 > build）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_STUDIO_SETTINGS,
  flushSettingsPersist,
  normalizeStudioSettings,
  useSettingsStore,
} from '../stores/settingsStore'
import { isLegacyRequested, isStudioV2Enabled } from '../lib/studioEntry'
import { resolveFlag } from '../studio/flags'

function clearSettings(): void {
  window.localStorage.removeItem('edustudio:settings')
  useSettingsStore.getState().updateStudio(DEFAULT_STUDIO_SETTINGS)
  useSettingsStore.getState().updateStudioDigest(DEFAULT_STUDIO_SETTINGS.digest)
  flushSettingsPersist()
}

describe('normalizeStudioSettings（损坏/旧值读回归一）', () => {
  it('null / 非对象 → 全默认', () => {
    expect(normalizeStudioSettings(null)).toEqual(DEFAULT_STUDIO_SETTINGS)
    expect(normalizeStudioSettings('bad')).toEqual(DEFAULT_STUDIO_SETTINGS)
    expect(normalizeStudioSettings(42)).toEqual(DEFAULT_STUDIO_SETTINGS)
  })

  it('非法 landing / execution → auto；onboarded 仅 true 生效', () => {
    const s = normalizeStudioSettings({ landing: 'nope', execution: 'bad', onboarded: 'yes' })
    expect(s.landing).toBe('auto')
    expect(s.execution).toBe('auto')
    expect(s.onboarded).toBe(false)
    expect(normalizeStudioSettings({ onboarded: true }).onboarded).toBe(true)
  })

  it('digest 字段逐个归一，缺省 0，可保留 activeMission/team', () => {
    const s = normalizeStudioSettings({
      digest: {
        pendingDecisions: 2,
        runningMissions: 'x',
        unreadNotices: 3,
        updatedAt: 9,
        activeMission: { id: 'm-1', title: '家长会筹备', progress: 50, status: 'running' },
        team: { agents: [{ id: 'chief', status: 'running' }], pendingApprovals: 1 },
      },
    })
    expect(s.digest.pendingDecisions).toBe(2)
    expect(s.digest.runningMissions).toBe(0)
    expect(s.digest.unreadNotices).toBe(3)
    expect(s.digest.activeMission?.id).toBe('m-1')
    expect(s.digest.team?.pendingApprovals).toBe(1)
  })

  it('flags 透传，其它未知字段丢弃', () => {
    const s = normalizeStudioSettings({ flags: { studioV2: 'on' }, extra: 1 } as never)
    expect(s.flags).toEqual({ studioV2: 'on' })
    expect((s as unknown as Record<string, unknown>).extra).toBeUndefined()
  })
})

describe('settings.studio 更新与持久化', () => {
  beforeEach(clearSettings)

  it('updateStudio 局部更新并持久化（flush 后读回）', () => {
    useSettingsStore.getState().updateStudio({ landing: 'inbox', execution: 'mock' })
    flushSettingsPersist()
    const raw = window.localStorage.getItem('edustudio:settings') ?? ''
    expect(raw).toContain('"landing":"inbox"')
    expect(raw).toContain('"execution":"mock"')
  })

  it('updateStudioDigest 只更新 digest，不影响 landing', () => {
    useSettingsStore.getState().updateStudio({ landing: 'briefing' })
    useSettingsStore.getState().updateStudioDigest({ ...DEFAULT_STUDIO_SETTINGS.digest, pendingDecisions: 4 })
    const s = useSettingsStore.getState().studio
    expect(s.landing).toBe('briefing')
    expect(s.digest.pendingDecisions).toBe(4)
  })

  it('resetStudioGuide：旧 guideSeen 与 onboarded 同时复位（单一事实源迁移期）', () => {
    useSettingsStore.getState().markGuideSeen()
    useSettingsStore.getState().updateStudio({ onboarded: true })
    useSettingsStore.getState().resetStudioGuide()
    expect(useSettingsStore.getState().guideSeen).toBe(false)
    expect(useSettingsStore.getState().studio.onboarded).toBe(false)
  })
})

describe('统一壳开关：URL > settings.studio > 角色默认 > build', () => {
  it('?v2=1 显式开；?v2=0 显式关；?legacy=1 强制关', () => {
    expect(isStudioV2Enabled('?v2=1', 'teacher', DEFAULT_STUDIO_SETTINGS)).toBe(true)
    expect(isStudioV2Enabled('?v2=0', 'teacher', DEFAULT_STUDIO_SETTINGS)).toBe(false)
    expect(isStudioV2Enabled('?v2=1&legacy=1', 'teacher', DEFAULT_STUDIO_SETTINGS)).toBe(false)
    expect(isLegacyRequested('?legacy=1')).toBe(true)
  })

  it('无 URL 参数时 settings.studio.landing=inbox 打开统一壳（影子期默认仍 off）', () => {
    expect(isStudioV2Enabled('', 'teacher', { ...DEFAULT_STUDIO_SETTINGS, landing: 'inbox' })).toBe(true)
    expect(isStudioV2Enabled('', 'teacher', DEFAULT_STUDIO_SETTINGS)).toBe(false)
    expect(isStudioV2Enabled('', 'schoolAdmin', { ...DEFAULT_STUDIO_SETTINGS, landing: 'inbox' })).toBe(true)
  })

  it('settings.flags 内部灰度覆盖优先于 landing', () => {
    expect(
      isStudioV2Enabled('', 'teacher', {
        ...DEFAULT_STUDIO_SETTINGS,
        landing: 'inbox',
        flags: { studioV2: 'off' },
      }),
    ).toBe(false)
  })

  it('resolveFlag：URL > settings > 角色默认（子能力开关同层解析）', () => {
    const settings = { ...DEFAULT_STUDIO_SETTINGS, flags: { derivedInbox: 'off' as const } }
    expect(resolveFlag('derivedInbox', 'teacher', { search: '?v2=1', settings })).toEqual({ value: true, source: 'url' })
    expect(resolveFlag('derivedInbox', 'teacher', { search: '', settings })).toEqual({ value: false, source: 'settings' })
    expect(resolveFlag('agentMemory', 'teacher', { search: '', settings: DEFAULT_STUDIO_SETTINGS })).toEqual({
      value: false,
      source: 'roleDefault',
    })
  })
})
