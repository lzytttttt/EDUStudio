import { create } from 'zustand'
import type { RoleId, Stage } from '../harness/types'
import { loadJSON, saveJSON } from '../lib/storage'

interface AuthState {
  role: RoleId | null
  stage: Stage
  login: (role: RoleId) => void
  setStage: (stage: Stage) => void
  logout: () => void
}

interface PersistedAuth {
  role: RoleId | null
  stage: Stage
}

const persisted = loadJSON<PersistedAuth>('auth', { role: null, stage: 'login' })

export const useAuthStore = create<AuthState>((set, get) => ({
  role: persisted.role,
  stage: persisted.role ? persisted.stage : 'login',
  login: (role) => {
    set({ role, stage: 'briefing' })
    saveJSON('auth', { role, stage: get().stage })
  },
  setStage: (stage) => {
    set({ stage })
    saveJSON('auth', { role: get().role, stage })
  },
  logout: () => {
    set({ role: null, stage: 'login' })
    saveJSON('auth', { role: null, stage: 'login' })
  },
}))
