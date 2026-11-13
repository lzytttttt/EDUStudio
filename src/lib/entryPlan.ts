/**
 * v1.2 入口计划（M0：P0-1/P0-2/P0-3；M1：`?v2=1` 统一壳入口；M4：教师默认战情台 + 回滚口径）：
 * 把「URL + 当前角色 + 设置 → 入口副作用计划」抽成纯函数，main.tsx 只负责应用。
 *
 * 优先级（roadmap §5.1 / §5.3 / §5.4 / R-7 / R-8）：
 * 1. `#share=`（分享短链，不参与路由/登录/引导）；
 * 2. `?v2=1` 显式统一壳（demo/legacy 组合时 v2 优先，排障与演示可控）；
 * 3. `?legacy=1` 回滚 → 旧壳/旧整屏（由后续参数决定阶段）；
 * 4. `?stage=login|briefing|workbench` 旧阶段机显式入口（旧 E2E/视觉回归专用）；
 * 5. `?v1=1`：M4 起**重定向到新战情台**；`?v1=1&legacy=1` 保留旧整屏只读（R-7）；
 * 6. `?demo=1`：行为不变（旧简报演示 + 跳过引导）；
 * 7. 无参数：teacher → 统一壳战情台（M4 默认，R-1）；settings.studio.landing 可改回简报/工作台（R-1 回滚）；
 *    校/局保持原有旧壳（D14：总指挥只对 teacher 开放）。
 */
import type { RoleId, Stage } from '../harness/types'
import type { StudioSettings } from '../studio/contracts'
import { isDemoEntry } from './demoEntry'
import { isDirectorEntry } from './directorEntry'
import {
  explicitStudioV2,
  isDemoRequested,
  isLegacyRequested,
  isStudioV2Enabled,
  requestedLegacyStage,
} from './studioEntry'

/** 入口附带的可见提示（P0-3：非教师身份尝试 `?v1=1`） */
export interface EntryNotice {
  title: string
  body: string
}

export type EntryKind =
  | 'none'
  /** v1.2 M0/M1：旧整屏（`?v1=1&legacy=1`，M4 起只读保留） */
  | 'director'
  | 'directorDenied'
  /** v1.2 M4：`?v1=1` 无 legacy → 重定向到新战情台（R-7） */
  | 'directorRedirect'
  | 'demo'
  /** v1.2 M1/M4：统一壳（默认战情台；settings.studio.landing 决定落点） */
  | 'studio'
  /** 旧阶段机显式入口（`?stage=` / settings.landing=briefing|workbench / `?legacy=1` 冷启动） */
  | 'legacyStage'

export interface EntryPlan {
  kind: EntryKind
  /** 需要补登录时的角色；null 表示已有会话或无需登录 */
  loginRole: RoleId | null
  /** 是否写旧引导已读位：仅 `?demo=1` 保留旧行为，`?v1=1` / `?v2=1` 不得污染（P0-2） */
  markGuideSeen: boolean
  notice?: EntryNotice
  /** legacyStage 要求的阶段；director 恒为 'command'；studio 不写阶段（路由为准） */
  stage?: Stage
  /** v1.2 M4：统一壳首落点（inbox=战情台默认；briefing/workbench 仅在 settings.landing 回滚时出现） */
  studioLanding?: 'inbox' | 'briefing' | 'workbench'
}

/** 非教师身份进入总指挥工作区的提示文案（P0-3） */
export const DIRECTOR_DENIED_NOTICE: EntryNotice = {
  title: '需要教师身份',
  body: '总指挥工作区仅对教师开放，已返回当前工作区。',
}

export function planEntry(
  search: string,
  hash: string,
  role: RoleId | null,
  studio?: Partial<StudioSettings>,
): EntryPlan {
  /* 分享路由优先：不登录、不改阶段、不写引导位（v0.4 M2①） */
  if (hash.startsWith('#share=')) return { kind: 'none', loginRole: null, markGuideSeen: false }

  const explicitV2 = explicitStudioV2(search)
  const legacy = isLegacyRequested(search)

  /* ② `?v2=1` 显式统一壳：未登录补教师以支持深链演示；校/局保留身份，由外壳强制经典工作区（D14） */
  if (explicitV2 === true && !legacy) {
    return {
      kind: 'studio',
      loginRole: role ? null : 'teacher',
      markGuideSeen: false,
      studioLanding: 'inbox',
    }
  }

  /* ③ M4：无显式参数时，teacher 默认进统一壳（settings.landing=inbox/auto；briefing/workbench 走旧壳回滚） */
  const landing = studio?.landing ?? 'auto'
  if (!legacy && !requestedLegacyStage(search) && !isDemoRequested(search)) {
    if (isStudioV2Enabled(search, role, studio) && !isDirectorEntry(search)) {
      return {
        kind: 'studio',
        loginRole: role ? null : 'teacher',
        markGuideSeen: false,
        studioLanding: landing === 'briefing' || landing === 'workbench' ? landing : 'inbox',
      }
    }
    if (landing === 'briefing' || landing === 'workbench') {
      return {
        kind: 'legacyStage',
        loginRole: role ? null : 'teacher',
        markGuideSeen: false,
        stage: landing === 'briefing' ? 'briefing' : 'workbench',
      }
    }
  }

  /* ④ `?stage=` 显式旧阶段机（旧 E2E/视觉回归专用） */
  const requestedStage = requestedLegacyStage(search)
  if (requestedStage) {
    if (requestedStage === 'command' && (role === 'schoolAdmin' || role === 'bureau')) {
      return { kind: 'directorDenied', loginRole: null, markGuideSeen: false, notice: { ...DIRECTOR_DENIED_NOTICE } }
    }
    return {
      kind: 'legacyStage',
      loginRole: role ? null : 'teacher',
      markGuideSeen: false,
      stage: requestedStage === 'login' ? 'login' : requestedStage,
    }
  }

  /* ⑤ `?v1=1`：M4 起无 legacy 重定向新战情台；`?v1=1&legacy=1` 保留旧整屏只读（R-7） */
  if (isDirectorEntry(search)) {
    if (role === 'schoolAdmin' || role === 'bureau') {
      return {
        kind: 'directorDenied',
        loginRole: null,
        markGuideSeen: false,
        notice: { ...DIRECTOR_DENIED_NOTICE },
      }
    }
    if (!legacy) {
      return { kind: 'directorRedirect', loginRole: role === 'teacher' ? null : 'teacher', markGuideSeen: false }
    }
    return {
      kind: 'director',
      loginRole: role === 'teacher' ? null : 'teacher',
      markGuideSeen: false,
      stage: 'command',
    }
  }

  /* ⑥ `?demo=1` 保持 v0.9.3 行为：跳过旧引导 + 未登录补教师 + 简报直达（旧壳） */
  if (isDemoEntry(search)) {
    return { kind: 'demo', loginRole: role ? null : 'teacher', markGuideSeen: true }
  }

  return { kind: 'none', loginRole: null, markGuideSeen: false }
}
