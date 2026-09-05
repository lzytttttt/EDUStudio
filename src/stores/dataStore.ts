import { create } from 'zustand'
import type { ClassLearning } from '../data/seed'
import { loadJSON, saveJSON } from '../lib/storage'

/**
 * 导入数据仓（v0.5 M1②）：CSV 成绩导入后的班级学情数据。
 * 作为 SourceProvider 的「本地真实数据」层：导入后简报/工具/看板优先消费，
 * 未导入时回落静态 seed。持久化到 LocalStorage（edustudio:importedData）。
 */

/** 导入的班级学情（在 ClassLearning 上补充来源信息） */
export interface ImportedProfile extends ClassLearning {
  /** 导入时间（ms），即数据时间戳 */
  importedAt: number
  /** 来源文件名 */
  fileName: string
  /** 学生人数（CSV 数据行数） */
  studentCount: number
}

interface DataState {
  profiles: ImportedProfile[]
  /** 导入/覆盖一个班级的学情（同班覆盖，保留最新） */
  upsert: (profile: ImportedProfile) => void
  remove: (classId: string) => void
  clear: () => void
}

const persisted = loadJSON<ImportedProfile[]>('importedData', [])

function persist(profiles: ImportedProfile[]): void {
  saveJSON('importedData', profiles)
}

export const useDataStore = create<DataState>((set, get) => ({
  profiles: persisted,

  upsert: (profile) => {
    const rest = get().profiles.filter((p) => p.classId !== profile.classId)
    const next = [profile, ...rest].slice(0, 50)
    set({ profiles: next })
    persist(next)
  },

  remove: (classId) => {
    const next = get().profiles.filter((p) => p.classId !== classId)
    set({ profiles: next })
    persist(next)
  },

  clear: () => {
    set({ profiles: [] })
    persist([])
  },
}))

/** 按关键词（班级名/id）查找导入的学情；keyword 为空时返回最新一条 */
export function findImportedProfile(keyword?: string): ImportedProfile | undefined {
  const profiles = useDataStore.getState().profiles
  if (!keyword) return profiles[0]
  const kw = keyword.trim()
  return profiles.find((p) => p.className.includes(kw) || p.classId === kw)
}
