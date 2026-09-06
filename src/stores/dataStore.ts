import { create } from 'zustand'
import type { ClassLearning } from '../data/seed'
import type { RoleId } from '../harness/types'
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

/**
 * 导入文档（v0.9 M6②）：文本类文档原文作为 LLM 附件材料直通上下文（API 模式）。
 * 不再做结构化解析——「理解文档」交给模型；Mock 模式不消费附件（沿用剧本）。
 */
export interface ImportedDoc {
  id: string
  /** 来源文件名 */
  fileName: string
  /** 文档原文（超长已截断至 IMPORTED_DOC_MAX_CHARS） */
  content: string
  /** 用户填写的用途与指令（留空回退角色默认说明） */
  prompt: string
  /** 导入时间（ms） */
  importedAt: number
  /** 是否因超限被截断（UI 明示） */
  truncated: boolean
}

/** 附件长度上限（字符）：超限截断并在 UI 明示，避免上下文膨胀与成本失控（v0.9 风险对策） */
export const IMPORTED_DOC_MAX_CHARS = 12000

/** prompt 留空时的角色默认说明（v0.9 M6③） */
const ROLE_DOC_HINT: Record<RoleId, string> = {
  teacher: '班级学情与教学材料，供教学决策参考',
  schoolAdmin: '校情汇总材料，供学校治理决策参考',
  bureau: '区县汇总文档，供区域教育决策参考',
}

interface DataState {
  profiles: ImportedProfile[]
  docs: ImportedDoc[]
  /** 导入/覆盖一个班级的学情（同班覆盖，保留最新） */
  upsert: (profile: ImportedProfile) => void
  remove: (classId: string) => void
  clear: () => void
  /** 新增导入文档（v0.9 M6②） */
  addDoc: (doc: ImportedDoc) => void
  removeDoc: (id: string) => void
}

const persisted = loadJSON<ImportedProfile[]>('importedData', [])
const persistedDocs = loadJSON<ImportedDoc[]>('importedDocs', [])

function persist(profiles: ImportedProfile[]): void {
  saveJSON('importedData', profiles)
}

function persistDocs(docs: ImportedDoc[]): void {
  saveJSON('importedDocs', docs)
}

export const useDataStore = create<DataState>((set, get) => ({
  profiles: persisted,
  docs: persistedDocs,

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

  addDoc: (doc) => {
    const next = [doc, ...get().docs].slice(0, 20)
    set({ docs: next })
    persistDocs(next)
  },

  removeDoc: (id) => {
    const next = get().docs.filter((d) => d.id !== id)
    set({ docs: next })
    persistDocs(next)
  },
}))

/** 按关键词（班级名/id）查找导入的学情；keyword 为空时返回最新一条 */
export function findImportedProfile(keyword?: string): ImportedProfile | undefined {
  const profiles = useDataStore.getState().profiles
  if (!keyword) return profiles[0]
  const kw = keyword.trim()
  return profiles.find((p) => p.className.includes(kw) || p.classId === kw)
}

/**
 * 组装附件材料段（v0.9 M6②）：导入文档原文 + 用途说明，注入 LLM 上下文。
 * 仅 API 模式调用方使用（Orchestrator 会话 / ApiBriefingProvider 简报生成）；
 * Mock 模式不消费附件（沿用剧本），无隐性消耗。
 */
export function buildDocAttachments(role?: RoleId): string {
  const docs = useDataStore.getState().docs
  if (!docs.length) return ''
  const fallback = role ? (ROLE_DOC_HINT[role] ?? '请按文档内容自行理解') : '请按文档内容自行理解'
  return docs
    .map((d) => {
      const desc = d.prompt.trim() || fallback
      return `《${d.fileName}》${d.truncated ? '（原文超长，已截断）' : ''}\n用途与指令：${desc}\n---\n${d.content}`
    })
    .join('\n\n')
}
