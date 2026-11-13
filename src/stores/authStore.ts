import { create } from 'zustand'
import type { RoleId, Stage } from '../harness/types'
import { loadJSON, saveJSON } from '../lib/storage'

interface AuthState {
  role: RoleId | null
  stage: Stage
  login: (role: RoleId) => void
  /** setStage：opts.fromPopstate 标记浏览器返回键来源，App 层据此跳过 pushState（v0.9 M5① 守卫） */
  setStage: (stage: Stage, opts?: { fromPopstate?: boolean }) => void
  logout: () => void
}

interface PersistedAuth {
  role: RoleId | null
  stage: Stage
}

/** 可落盘阶段白名单：command 是预览入口的临时阶段，永不持久化（v1.2 M0 P0-1） */
const PERSISTED_STAGES: readonly Stage[] = ['login', 'briefing', 'workbench']

function isPersistedStage(stage: unknown): stage is Stage {
  return typeof stage === 'string' && (PERSISTED_STAGES as readonly string[]).includes(stage)
}

/**
 * 冷启动恢复归一（v1.2 M0 P0-1）：无角色一律回 login；
 * command / 非法值在有角色时回 briefing，避免访问一次 `?v1=1` 后默认入口被粘住。
 */
export function normalizeRestoredStage(role: RoleId | null, stage: unknown): Stage {
  if (!role) return 'login'
  return isPersistedStage(stage) ? stage : 'briefing'
}

const persisted = loadJSON<PersistedAuth | null>('auth', null)
const restoredRole = persisted?.role ?? null
const restoredStage = normalizeRestoredStage(restoredRole, persisted?.stage)

/** 盘上是否已有合法（非 command）阶段：command 不落盘时据此决定是否补默认值 */
function hasPersistedStage(): boolean {
  const raw = loadJSON<PersistedAuth | null>('auth', null)
  return !!raw && isPersistedStage(raw.stage)
}

export const useAuthStore = create<AuthState>((set, get) => ({
  role: restoredRole,
  stage: restoredStage,
  login: (role) => {
    set({ role, stage: 'briefing' })
    saveJSON('auth', { role, stage: get().stage })
  },
  setStage: (stage, opts) => {
    set({ stage })
    if (stage === 'command') {
      /* v1.2 M0 P0-1：只改内存；盘上保留上一次合法非 command 阶段，无合法值才补默认 */
      if (!hasPersistedStage()) {
        const role = get().role
        saveJSON('auth', { role, stage: role ? 'briefing' : 'login' })
      }
    } else {
      saveJSON('auth', { role: get().role, stage })
    }
    void opts
  },
  logout: () => {
    set({ role: null, stage: 'login' })
    saveJSON('auth', { role: null, stage: 'login' })
  },
}))
