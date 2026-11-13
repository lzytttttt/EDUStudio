import { create } from 'zustand'
import type { ArtifactDoc, ArtifactKind, ArtifactProvenanceInfo, RoleId } from '../harness/types'
import { loadJSON, saveJSON } from '../lib/storage'
import { createDebouncedWriter } from '../lib/debouncedWrite'
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

/**
 * v1.2 M2 交付物发布入参（roadmap §3.5 deliverables 端口 / §4.5 发布链路）。
 *
 * 只新增这一个入口：正文仍以 `docs` 为唯一事实源，Director 侧只存 docId 引用，
 * 发布后复用旧的版本 / 导出 / 分享 / 自评能力（不复制第二套文档实体）。
 */
export interface PublishDeliverableInput {
  /** 稳定文档 id（可选；缺省按 provenance.missionId + 标题派生，保证重放幂等） */
  id?: string
  title: string
  kind: ArtifactKind
  role: RoleId
  /** 定稿正文（Markdown，可含 `{{值~来源}}` 溯源标记，渲染沿用旧渲染器） */
  markdown: string
  /** 交付物溯源（missionId / agentId / citations / createdAt 等） */
  provenance: ArtifactProvenanceInfo
  /** 中文交付物类型（展示用，如「讲稿」；缺省按 kind 映射） */
  docKindCn?: string
  /** 产出方（缺省 'mission'；旧文档的 source 语义不变） */
  source?: ArtifactDoc['source']
}

/** 稳定短 hash（派生交付物 docId 用；同一 mission 同一标题重放不新增文档） */
function stableTitleHash(title: string): string {
  let hash = 5381
  for (let i = 0; i < title.length; i += 1) hash = ((hash << 5) + hash + title.charCodeAt(i)) >>> 0
  return hash.toString(36)
}

/** 缺省 docId：有 missionId 时派生稳定值（重放幂等），否则一次性 id */
function deriveDeliverableId(provenance: ArtifactProvenanceInfo, title: string): string {
  if (provenance.missionId) return `doc-${provenance.missionId}-${stableTitleHash(title)}`
  return `doc-deliverable-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
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
  /** 批量追加（v0.9.3 P0-D②）：同帧多个 chunk 合并为一次 set，减少订阅者重渲染 */
  appendChunks: (items: { id: string; chunk: string }[]) => void
  finalize: (id: string, title: string, kind: ArtifactKind) => void
  /**
   * v1.2 M2：发布 mission 交付物（占位→内容→定稿的观感，但**不抢右栏焦点**、不进 generatingIds）。
   * 幂等：同一 id 重复发布只更新内容/标题，不新增重复文档；返回 docId。
   */
  publishDeliverable: (input: PublishDeliverableInput) => string
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

/**
 * 合并写盘（v0.9.3 P2-A②）：正文编辑逐字触发 updateContent，
 * 300ms trailing 窗口内的连续变更只落盘一次；关键节点（finalize / 切换文档 / 页面隐藏）强制 flush。
 */
const persistSoon = createDebouncedWriter(() => persist(useArtifactStore.getState()))

/** 立即写出待处理变更（main.tsx 在 visibilitychange / pagehide 兜底调用） */
export function flushArtifactPersist(): void {
  persistSoon.flush()
}

/** 立即全量落盘并撤销待合并写入（本节点已把最新 state 完整写出，避免窗口到期后重复写） */
function persistNow(): void {
  persistSoon.cancel()
  persist(useArtifactStore.getState())
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
    persistNow()
  },

  appendChunk: (id, chunk) => {
    get().appendChunks([{ id, chunk }])
  },

  appendChunks: (items) => {
    if (!items.length) return
    /* 按文档归并（v0.9.3 P0-D②）：同一帧内的多次 chunk 只产生一次 set / 一次订阅者通知 */
    const byId = new Map<string, string>()
    for (const it of items) byId.set(it.id, (byId.get(it.id) ?? '') + it.chunk)
    let matched = false
    const docs = get().docs.map((d) => {
      const add = byId.get(d.id)
      if (add === undefined) return d
      matched = true
      return { ...d, content: d.content + add }
    })
    /* 全是未知 id（文档已被删除 / 事件串台）时不产生通知 */
    if (!matched) return
    set({ docs })
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
    persistNow()
  },

  /**
   * v1.2 M2 交付物发布（roadmap §4.5）：直接把定稿正文写入 docs（占位→内容→定稿一次完成）。
   * 纪律（§3.5 deliverables 端口）：
   * - **不 requestDocFocus / 不切右栏 tab**（不抢焦点；仅无有效选中文档时才落 activeId）；
   * - 不进 generatingIds（交付物是一次性定稿，不是流式生成）；
   * - 完成后 unreadDocIds 置位（与旧「生成完成」未读口径一致）；
   * - 幂等：同 id 重复发布只更新内容/标题，不新增重复文档；
   * - 写「生成完成」revision 并立即持久化。
   */
  publishDeliverable: (input) => {
    const { title, kind, role, markdown, provenance, docKindCn } = input
    const source = input.source ?? 'mission'
    const id = input.id ?? deriveDeliverableId(provenance, title)
    const createdAt = provenance.createdAt || Date.now()
    const prev = get().docs.find((d) => d.id === id)
    const revisions = { ...get().revisions }

    if (!prev) {
      revisions[id] = pushRevision(revisions[id] ?? [], {
        id: genRevId(),
        label: '生成完成',
        content: markdown,
        createdAt,
      })
      const doc: ArtifactDoc = {
        id,
        title,
        kind,
        role,
        content: markdown,
        createdAt,
        source,
        provenance,
        docKindCn,
      }
      /* 视角纪律：只有当前没有可展示的选中文档时才落到新交付物，已有选中不打断 */
      const currentActive = get().activeId
      const keepActive = currentActive !== null && get().docs.some((d) => d.id === currentActive)
      set({
        docs: [doc, ...get().docs],
        revisions,
        activeId: keepActive ? currentActive : id,
        unreadDocIds: markdown ? [...without(get().unreadDocIds, id), id] : get().unreadDocIds,
      })
      persistNow()
      return id
    }

    /* 幂等更新：同一 id 不新增重复文档；内容有变才追加版本（旧内容按旧 store 先例自动快照） */
    if (prev.content !== markdown) {
      if (prev.content) {
        revisions[id] = pushRevision(revisions[id] ?? [], {
          id: genRevId(),
          label: '重新生成前自动保存',
          content: prev.content,
          createdAt,
        })
      }
      revisions[id] = pushRevision(revisions[id] ?? [], {
        id: genRevId(),
        label: '生成完成',
        content: markdown,
        createdAt,
      })
    }
    set({
      docs: get().docs.map((d) =>
        d.id === id ? { ...d, title, kind, role, content: markdown, source, provenance, docKindCn } : d,
      ),
      revisions,
      unreadDocIds: markdown ? [...without(get().unreadDocIds, id), id] : get().unreadDocIds,
    })
    persistNow()
    return id
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
    /* 逐字编辑最高频：合并写盘，停手 300ms 后才全量落盘（v0.9.3 P2-A②） */
    persistSoon.schedule()
  },

  rename: (id, title) => {
    set({ docs: get().docs.map((d) => (d.id === id ? { ...d, title } : d)) })
    persistNow()
  },

  /* 切换文档为关键节点（v0.9.3 P2-A②）：先把待合并的编辑落盘，再切换 */
  setActive: (id) => {
    persistSoon.flush()
    set({ activeId: id })
  },

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
    persistNow()
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
    persistNow()
    return id
  },

  setTemplate: (role, templateId) => {
    set({ lastTemplate: { ...get().lastTemplate, [role]: templateId } })
    persistNow()
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
    persistNow()
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
    persistNow()
  },

  removeRevision: (id, revisionId) => {
    const revisions = { ...get().revisions }
    revisions[id] = (revisions[id] ?? []).filter((r) => r.id !== revisionId)
    set({ revisions })
    persistNow()
  },

  setShareRef: (id, ref) => {
    set({ shareRefs: { ...get().shareRefs, [id]: ref } })
    persistNow()
  },

  /** 进入文档 tab 即视为已查看（v0.9.3 P0-A ②） */
  markDocsRead: () => {
    if (get().unreadDocIds.length) set({ unreadDocIds: [] })
  },
}))
