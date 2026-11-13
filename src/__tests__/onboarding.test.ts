/**
 * v1.2 M4 · 两段式引导合并纯函数单测（roadmap §5.2 / §5.3）
 *
 * 覆盖：坏值归一矩阵、合并（局部更新 / 显式复位 / 非布尔忽略）、阶段与下一站矩阵、
 * 升级提示打扰预算、旧数据迁移（settings.guideSeen / director.guideSeen / 已有 onboarding 优先）、
 * `?tour` / `?demo` URL 语义解析。
 */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_ONBOARDING,
  isOnboarded,
  mergeOnboarding,
  migrateLegacyOnboarding,
  nextStep,
  onboardingStage,
  resolveDemoEntry,
  resolveTourMode,
  shouldShowUpgradeNotice,
  type OnboardingProgress,
} from '../lib/onboarding'

const progress = (patch: Partial<OnboardingProgress>): OnboardingProgress => ({
  ...EMPTY_ONBOARDING,
  ...patch,
})

describe('mergeOnboarding：坏值归一与局部合并', () => {
  it('null / 非对象 / 数组 → 全 false（不抛错）', () => {
    expect(mergeOnboarding(null)).toEqual(EMPTY_ONBOARDING)
    expect(mergeOnboarding('bad')).toEqual(EMPTY_ONBOARDING)
    expect(mergeOnboarding(42)).toEqual(EMPTY_ONBOARDING)
    expect(mergeOnboarding([true, true, true])).toEqual(EMPTY_ONBOARDING)
    expect(mergeOnboarding(undefined, undefined)).toEqual(EMPTY_ONBOARDING)
  })

  it('只认严格 true：1 / "true" / "yes" 都不算已读', () => {
    const s = mergeOnboarding({ directorSeen: 1, classicSeen: 'true', noticeSeen: 'yes' })
    expect(s).toEqual(EMPTY_ONBOARDING)
  })

  it('缺字段按 false，其余 true 保留', () => {
    expect(mergeOnboarding({ directorSeen: true })).toEqual(progress({ directorSeen: true }))
    expect(mergeOnboarding({ classicSeen: true, noticeSeen: true })).toEqual(
      progress({ classicSeen: true, noticeSeen: true }),
    )
  })

  it('patch 局部合并：只改显式传入的字段', () => {
    const base = progress({ directorSeen: true, noticeSeen: true })
    expect(mergeOnboarding(base, { classicSeen: true })).toEqual(
      progress({ directorSeen: true, classicSeen: true, noticeSeen: true }),
    )
  })

  it('patch 显式 false 可复位（重看引导），非布尔脏值被忽略', () => {
    const base = progress({ directorSeen: true, classicSeen: true })
    expect(mergeOnboarding(base, { directorSeen: false })).toEqual(
      progress({ directorSeen: false, classicSeen: true }),
    )
    expect(mergeOnboarding(base, { directorSeen: 'x', classicSeen: 0 })).toEqual(base)
  })
})

describe('isOnboarded / onboardingStage / nextStep 矩阵', () => {
  it('isOnboarded 只在两段都完成时为 true', () => {
    expect(isOnboarded(progress({}))).toBe(false)
    expect(isOnboarded(progress({ directorSeen: true }))).toBe(false)
    expect(isOnboarded(progress({ classicSeen: true }))).toBe(false)
    expect(isOnboarded(progress({ directorSeen: true, classicSeen: true }))).toBe(true)
  })

  it('onboardingStage 四种取值全部可达', () => {
    expect(onboardingStage(progress({}))).toBe('not-seen')
    expect(onboardingStage(progress({ directorSeen: true }))).toBe('director')
    /* 老用户只完成经典段（顺序外）：阶段记为 classic，由 nextStep 拉回总指挥 */
    expect(onboardingStage(progress({ classicSeen: true }))).toBe('classic')
    expect(onboardingStage(progress({ directorSeen: true, classicSeen: true }))).toBe('done')
  })

  it('nextStep：总指挥优先，完成后转经典，都完成回 null', () => {
    expect(nextStep(progress({}))).toBe('director')
    expect(nextStep(progress({ classicSeen: true }))).toBe('director')
    expect(nextStep(progress({ directorSeen: true }))).toBe('classic')
    expect(nextStep(progress({ directorSeen: true, classicSeen: true }))).toBeNull()
  })
})

describe('shouldShowUpgradeNotice：老用户提示只打扰一次', () => {
  it('有旧数据且未关闭过 → 显示', () => {
    expect(shouldShowUpgradeNotice(progress({}), true)).toBe(true)
    expect(shouldShowUpgradeNotice(progress({ directorSeen: true, classicSeen: true }), true)).toBe(true)
  })

  it('已关闭提示 / 无旧数据 → 不显示', () => {
    expect(shouldShowUpgradeNotice(progress({ noticeSeen: true }), true)).toBe(false)
    expect(shouldShowUpgradeNotice(progress({}), false)).toBe(false)
    expect(shouldShowUpgradeNotice(progress({ directorSeen: true }), false)).toBe(false)
  })
})

describe('migrateLegacyOnboarding：首次加载迁移合并', () => {
  it('无旧数据 → 空进度', () => {
    expect(migrateLegacyOnboarding({})).toEqual(EMPTY_ONBOARDING)
    expect(migrateLegacyOnboarding({ settingsGuideSeen: false, directorGuideSeen: false })).toEqual(
      EMPTY_ONBOARDING,
    )
  })

  it('旧 settings.guideSeen=true → classicSeen；director 键 guideSeen=true → directorSeen', () => {
    expect(migrateLegacyOnboarding({ settingsGuideSeen: true })).toEqual(progress({ classicSeen: true }))
    expect(migrateLegacyOnboarding({ directorGuideSeen: true })).toEqual(progress({ directorSeen: true }))
    expect(migrateLegacyOnboarding({ settingsGuideSeen: true, directorGuideSeen: true })).toEqual(
      progress({ directorSeen: true, classicSeen: true }),
    )
  })

  it('老用户两套都看过 → onboarded（派生）为 true', () => {
    const migrated = migrateLegacyOnboarding({ settingsGuideSeen: true, directorGuideSeen: true })
    expect(isOnboarded(migrated)).toBe(true)
    expect(onboardingStage(migrated)).toBe('done')
    expect(nextStep(migrated)).toBeNull()
  })

  it('只有 Director 看过（v1.1 只玩过 ?v1=1）→ 下一站补经典，不重复总指挥引导', () => {
    const migrated = migrateLegacyOnboarding({ directorGuideSeen: true })
    expect(isOnboarded(migrated)).toBe(false)
    expect(nextStep(migrated)).toBe('classic')
  })

  it('已有 M4 onboarding 时以它为准，旧 guideSeen 不得覆盖（清空工作区数据后不回滚）', () => {
    const current = progress({ directorSeen: false, classicSeen: false, noticeSeen: true })
    expect(
      migrateLegacyOnboarding({ current, settingsGuideSeen: true, directorGuideSeen: true }),
    ).toEqual(current)
    /* 已有对象即使字段全 false 也算「已迁移」，不会被旧值再次拉成 true */
    expect(isOnboarded(migrateLegacyOnboarding({ current: {}, settingsGuideSeen: true }))).toBe(false)
  })

  it('坏 current（字符串 / 数组）视作未迁移，回落到旧值推导', () => {
    expect(migrateLegacyOnboarding({ current: 'bad', directorGuideSeen: true })).toEqual(
      progress({ directorSeen: true }),
    )
    expect(migrateLegacyOnboarding({ current: [1], settingsGuideSeen: true })).toEqual(
      progress({ classicSeen: true }),
    )
  })
})

describe('?tour / ?demo 解析（页面加载锁存的口径）', () => {
  it('tour：0/false 关闭，1/true 强制，其余自动', () => {
    expect(resolveTourMode('')).toBe('auto')
    expect(resolveTourMode('?v2=1')).toBe('auto')
    expect(resolveTourMode('?tour=0')).toBe('off')
    expect(resolveTourMode('?tour=false')).toBe('off')
    expect(resolveTourMode('?tour=1')).toBe('force')
    expect(resolveTourMode('?tour=true')).toBe('force')
    expect(resolveTourMode('?tour=2')).toBe('auto')
    expect(resolveTourMode('?v2=1&view=team&tour=0')).toBe('off')
  })

  it('demo：只有 ?demo=1/true 算演示入口', () => {
    expect(resolveDemoEntry('')).toBe(false)
    expect(resolveDemoEntry('?v2=1')).toBe(false)
    expect(resolveDemoEntry('?demo=1')).toBe(true)
    expect(resolveDemoEntry('?demo=true')).toBe(true)
    expect(resolveDemoEntry('?demo=0')).toBe(false)
  })
})

describe('端到端纯函数流程：新用户两段式走完', () => {
  it('not-seen → 总指挥完成 → 经典完成 → done，onboarded 只在最后为 true', () => {
    let p = migrateLegacyOnboarding({})
    expect(onboardingStage(p)).toBe('not-seen')
    expect(nextStep(p)).toBe('director')
    expect(isOnboarded(p)).toBe(false)

    p = mergeOnboarding(p, { directorSeen: true })
    expect(onboardingStage(p)).toBe('director')
    expect(nextStep(p)).toBe('classic')
    expect(isOnboarded(p)).toBe(false)

    p = mergeOnboarding(p, { classicSeen: true, noticeSeen: true })
    expect(onboardingStage(p)).toBe('done')
    expect(nextStep(p)).toBeNull()
    expect(isOnboarded(p)).toBe(true)
  })
})
