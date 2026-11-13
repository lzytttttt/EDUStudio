/**
 * v1.2 M0 入口计划（P0-1/P0-2/P0-3）：
 * 把「URL + 当前角色 → 入口副作用计划」抽成纯函数，main.tsx 只负责应用；
 * 优先级：分享路由（#share=）> `?v1=1`（总指挥预览）> `?demo=1`（旧简报演示）> 无。
 */
import type { RoleId, Stage } from '../harness/types'
import { isDemoEntry } from './demoEntry'
import { isDirectorEntry } from './directorEntry'

/** 入口附带的可见提示（P0-3：非教师身份尝试 `?v1=1`） */
export interface EntryNotice {
  title: string
  body: string
}

export interface EntryPlan {
  kind: 'none' | 'director' | 'directorDenied' | 'demo'
  /** 需要补登录时的角色；null 表示已有会话或无需登录 */
  loginRole: RoleId | null
  /** 是否写旧引导已读位：仅 `?demo=1` 保留旧行为，`?v1=1` 不得污染（P0-2） */
  markGuideSeen: boolean
  notice?: EntryNotice
  /** 入口要求的阶段：director 为 'command'，其余不指定 */
  stage?: Stage
}

/** 非教师身份进入总指挥工作区的提示文案（P0-3） */
export const DIRECTOR_DENIED_NOTICE: EntryNotice = {
  title: '需要教师身份',
  body: '总指挥工作区仅对教师开放，已返回当前工作区。',
}

export function planEntry(search: string, hash: string, role: RoleId | null): EntryPlan {
  /* 分享路由优先：不登录、不改阶段、不写引导位（v0.4 M2①） */
  if (hash.startsWith('#share=')) return { kind: 'none', loginRole: null, markGuideSeen: false }

  if (isDirectorEntry(search)) {
    /* P0-3：校/局身份不覆盖，留在当前阶段并给可见提示 */
    if (role === 'schoolAdmin' || role === 'bureau') {
      return {
        kind: 'directorDenied',
        loginRole: null,
        markGuideSeen: false,
        notice: { ...DIRECTOR_DENIED_NOTICE },
      }
    }
    /* P0-2：不写旧引导已读位；无角色时才补教师身份（P0-3） */
    return {
      kind: 'director',
      loginRole: role === 'teacher' ? null : 'teacher',
      markGuideSeen: false,
      stage: 'command',
    }
  }

  if (isDemoEntry(search)) {
    /* `?demo=1` 保持 v0.9.3 行为：跳过旧引导 + 未登录补教师 */
    return { kind: 'demo', loginRole: role ? null : 'teacher', markGuideSeen: true }
  }

  return { kind: 'none', loginRole: null, markGuideSeen: false }
}
