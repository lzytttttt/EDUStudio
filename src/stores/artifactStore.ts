import { create } from 'zustand'
import type { ArtifactDoc, ArtifactKind, RoleId } from '../harness/types'
import { loadJSON, saveJSON } from '../lib/storage'
import { getTemplateById } from '../harness/scripts/artifacts'
import { useUiStore } from './uiStore'

/** 文档版本快照（v0.3 专项 ②：版本历史） */
export interface ArtifactRevision {
  id: string
  /** 版本说明，如「生成完成」「手动保存」「恢复前自动保存」 */
  label: string
  content: string
  createdAt: number
}

/** 分享短链登记（v0.5 M2①）：文档 → 轻后端分享 id，用于批注回传拉取 */
export interface ShareRef {
  id: string
  apiBase: string
  sharedAt: number
  /** 作者端已读批注数（用于「新批注」提醒去重） */
  seenAnnotations?: number
}

export interface ArtifactState {
  docs: ArtifactDoc[]
  /** 每个文档的版本历史（新版本在后，上限 20 条） */
  revisions: Record<string, ArtifactRevision[]>
  /** 文档 → 分享短链登记（v0.5 M2①） */
  shareRefs: Record<string, ShareRef>
  activeId: string | null
  /** 每个角色最近一次使用的模板（用于「再次生成」） */
  lastTemplate: Partial<Record<RoleId, string>>
  createPlaceholder: (id: string, title: string, kind: ArtifactKind, role: RoleId, source: ArtifactDoc['source']) => void
  appendChunk: (id: string, chunk: string) => void
  finalize: (id: string, title: string, kind: ArtifactKind) => void
  updateContent: (id: string, content: string) => void
  rename: (id: string, title: string) => void
  setActive: (id: string | null) => void
  remove: (id: string) => void
  /** 手动新建：可指定模板（不传则用空白骨架） */
  createManual: (role: RoleId, templateId?: string) => string
  setTemplate: (role: RoleId, templateId: string) => void
  /** 手动保存版本 */
  saveRevision: (id: string, label?: string) => void
  /** 恢复到指定版本（恢复前自动快照当前内容，可再撤销回来） */
  restoreRevision: (id: string, revisionId: string) => void
  /** 删除某个版本 */
  removeRevision: (id: string, revisionId: string) => void
  /** 登记分享短链（v0.5 M2①） */
  setShareRef: (id: string, ref: ShareRef) => void
  /** 生成中标识（v0.9.3 P0-A ②）：agent 占位创建 → finalize / 非流式整体写入期间保持；仅内存态不落盘 */
  generatingIds: string[]
  /** 生成完成但尚未查看的文档 id（v0.9.3 P0-A ②：进入文档 tab 后清除）；仅内存态不落盘 */
  unreadDocIds: string[]
  /** 清空未查看标记（进入文档 tab 时调用） */
  markDocsRead: () => void
}

const MAX_REVISIONS = 20
/** 内容增量超过该阈值时自动快照（避免流式期间频繁写入） */
const AUTO_SNAPSHOT_DIFF = 50

interface Persisted {
  docs: ArtifactDoc[]
  revisions: Record<string, ArtifactRevision[]>
  lastTemplate: Partial<Record<RoleId, string>>
  shareRefs?: Record<string, ShareRef>
}

const persisted = loadJSON<Persisted>('artifacts', { docs: [], revisions: {}, lastTemplate: {} })

function persist(state: Pick<ArtifactState, 'docs' | 'revisions' | 'lastTemplate' | 'shareRefs'>): void {
  saveJSON('artifacts', {
    docs: state.docs,
    revisions: state.revisions,
    lastTemplate: state.lastTemplate,
    shareRefs: state.shareRefs,
  })
}

function genRevId(): string {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

/** 追加版本并裁剪到上限 */
function pushRevision(list: ArtifactRevision[], rev: ArtifactRevision): ArtifactRevision[] {
  const next = [...list, rev]
  return next.length > MAX_REVISIONS ? next.slice(next.length - MAX_REVISIONS) : next
}

/** 从 id 列表移除（不存在时返回原数组，避免无谓引用变更触发重渲染） */
function without(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : list
}

export const useArtifactStore = create<ArtifactState>((set, get) => ({
  docs: persisted.docs,
  revisions: persisted.revisions,
  shareRefs: persisted.shareRefs ?? {},
  activeId: persisted.docs[0]?.id ?? null,
  lastTemplate: persisted.lastTemplate,
  generatingIds: [],
  unreadDocIds: [],

  createPlaceholder: (id, title, kind, role, source) => {
    // 同角色同标题重建：先快照旧文档，避免覆盖丢失（v0.3-02 要求）
    const revisions = { ...get().revisions }
    const sameDoc = get().docs.find((d) => d.role === role && d.kind === kind && d.title === title && d.content)
    if (sameDoc) {
      revisions[sameDoc.id] = pushRevision(revisions[sameDoc.id] ?? [], {
        id: genRevId(),
        label: '重新生成前自动保存',
        content: sameDoc.content,
        createdAt: Date.now(),
      })
    }
    const doc: ArtifactDoc = { id, title, kind, role, content: '', createdAt: Date.now(), source }
    /* 生成中标识 + 占位即切「文档」（v0.9.3 P0-A ①②）：仅 agent 占位触发，
     * 手动创建（出题工作台「插入到文档」等）不夺走当前 tab，也不进入生成中态 */
    const generatingIds = source === 'manual' ? get().generatingIds : [...get().generatingIds, id]
    if (source !== 'manual') useUiStore.getState().requestDocFocus()
    set({ docs: [doc, ...get().docs], activeId: id, revisions, generatingIds })
    persist(get())
  },

  appendChunk: (id, chunk) => {
    set({
      docs: get().docs.map((d) => (d.id === id ? { ...d, content: d.content + chunk } : d)),
    })
  },

  finalize: (id, title, kind) => {
    const prev = get().docs.find((d) => d.id === id)
    const revisions = { ...get().revisions }
    // 生成完成时快照定稿
    if (prev?.content) {
      revisions[id] = pushRevision(revisions[id] ?? [], {
        id: genRevId(),
        label: '生成完成',
        content: prev.content,
        createdAt: Date.now(),
      })
    }
    /* 生成收敛（v0.9.3 P0-A ②）：清「生成中」；流式产出完成后留未读点（进入文档 tab 即清除） */
    const unreadDocIds =
      get().generatingIds.includes(id) && prev?.content ? [...without(get().unreadDocIds, id), id] : get().unreadDocIds
    set({
      docs: get().docs.map((d) => (d.id === id ? { ...d, title, kind } : d)),
      revisions,
      generatingIds: without(get().generatingIds, id),
      unreadDocIds,
    })
    persist(get())
  },

  updateContent: (id, content) => {
    const prev = get().docs.find((d) => d.id === id)
    if (!prev) return
    const revisions = { ...get().revisions }
    // 编辑增量超阈值时自动快照旧内容
    if (prev.content && content.length - prev.content.length > AUTO_SNAPSHOT_DIFF) {
      revisions[id] = pushRevision(revisions[id] ?? [], {
        id: genRevId(),
        label: '自动保存',
        content: prev.content,
        createdAt: Date.now(),
      })
    }
    set({
      docs: get().docs.map((d) => (d.id === id ? { ...d, content } : d)),
      revisions,
      /* 非流式整体写入（如文档合并工具）视为已产出（v0.9.3 P0-A ②） */
      generatingIds: without(get().generatingIds, id),
    })
    persist(get())
  },

  rename: (id, title) => {
    set({ docs: get().docs.map((d) => (d.id === id ? { ...d, title } : d)) })
    persist(get())
  },

  setActive: (id) => set({ activeId: id }),

  remove: (id) => {
    const docs = get().docs.filter((d) => d.id !== id)
    const revisions = { ...get().revisions }
    delete revisions[id]
    set({
      docs,
      revisions,
      activeId: get().activeId === id ? (docs[0]?.id ?? null) : get().activeId,
      generatingIds: without(get().generatingIds, id),
      unreadDocIds: without(get().unreadDocIds, id),
    })
    persist(get())
  },

  createManual: (role, templateId) => {
    const id = `art-manual-${Date.now().toString(36)}`
    const tpl = templateId ? getTemplateById(templateId) : null
    const doc: ArtifactDoc = {
      id,
      title: tpl ? `新建${tpl.name}` : '新建文档',
      kind: tpl?.kind ?? 'generic',
      role,
      content: tpl ? tpl.render(tpl.name) : '# 新建文档\n\n开始输入内容…',
      createdAt: Date.now(),
      source: 'manual',
    }
    set({ docs: [doc, ...get().docs], activeId: id })
    persist(get())
    return id
  },

  setTemplate: (role, templateId) => {
    set({ lastTemplate: { ...get().lastTemplate, [role]: templateId } })
    persist(get())
  },

  saveRevision: (id, label = '手动保存') => {
    const doc = get().docs.find((d) => d.id === id)
    if (!doc?.content) return
    const revisions = { ...get().revisions }
    revisions[id] = pushRevision(revisions[id] ?? [], {
      id: genRevId(),
      label,
      content: doc.content,
      createdAt: Date.now(),
    })
    set({ revisions })
    persist(get())
  },

  restoreRevision: (id, revisionId) => {
    const doc = get().docs.find((d) => d.id === id)
    const rev = get().revisions[id]?.find((r) => r.id === revisionId)
    if (!doc || !rev) return
    const revisions = { ...get().revisions }
    if (doc.content) {
      revisions[id] = pushRevision(revisions[id] ?? [], {
        id: genRevId(),
        label: '恢复前自动保存',
        content: doc.content,
        createdAt: Date.now(),
      })
    }
    set({
      docs: get().docs.map((d) => (d.id === id ? { ...d, content: rev.content } : d)),
      revisions,
    })
    persist(get())
  },

  removeRevision: (id, revisionId) => {
    const revisions = { ...get().revisions }
    revisions[id] = (revisions[id] ?? []).filter((r) => r.id !== revisionId)
    set({ revisions })
    persist(get())
  },

  setShareRef: (id, ref) => {
    set({ shareRefs: { ...get().shareRefs, [id]: ref } })
    persist(get())
  },

  /** 进入文档 tab 即视为已查看（v0.9.3 P0-A ②） */
  markDocsRead: () => {
    if (get().unreadDocIds.length) set({ unreadDocIds: [] })
  },
}))
