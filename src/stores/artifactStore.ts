import { create } from 'zustand'
import type { ArtifactDoc, ArtifactKind, RoleId } from '../harness/types'
import { loadJSON, saveJSON } from '../lib/storage'

interface ArtifactState {
  docs: ArtifactDoc[]
  activeId: string | null
  createPlaceholder: (id: string, title: string, kind: ArtifactKind, role: RoleId, source: ArtifactDoc['source']) => void
  appendChunk: (id: string, chunk: string) => void
  finalize: (id: string, title: string, kind: ArtifactKind) => void
  updateContent: (id: string, content: string) => void
  rename: (id: string, title: string) => void
  setActive: (id: string | null) => void
  remove: (id: string) => void
  createManual: (role: RoleId) => string
}

function persist(docs: ArtifactDoc[]) {
  saveJSON('artifacts', docs)
}

const persistedDocs = loadJSON<ArtifactDoc[]>('artifacts', [])

export const useArtifactStore = create<ArtifactState>((set, get) => ({
  docs: persistedDocs,
  activeId: persistedDocs[0]?.id ?? null,
  createPlaceholder: (id, title, kind, role, source) => {
    const doc: ArtifactDoc = { id, title, kind, role, content: '', createdAt: Date.now(), source }
    set({ docs: [doc, ...get().docs], activeId: id })
    persist(get().docs)
  },
  appendChunk: (id, chunk) => {
    set({
      docs: get().docs.map((d) => (d.id === id ? { ...d, content: d.content + chunk } : d)),
    })
  },
  finalize: (id, title, kind) => {
    set({
      docs: get().docs.map((d) => (d.id === id ? { ...d, title, kind } : d)),
    })
    persist(get().docs)
  },
  updateContent: (id, content) => {
    set({ docs: get().docs.map((d) => (d.id === id ? { ...d, content } : d)) })
    persist(get().docs)
  },
  rename: (id, title) => {
    set({ docs: get().docs.map((d) => (d.id === id ? { ...d, title } : d)) })
    persist(get().docs)
  },
  setActive: (id) => set({ activeId: id }),
  remove: (id) => {
    const docs = get().docs.filter((d) => d.id !== id)
    set({ docs, activeId: get().activeId === id ? (docs[0]?.id ?? null) : get().activeId })
    persist(docs)
  },
  createManual: (role) => {
    const id = `art-manual-${Date.now().toString(36)}`
    const doc: ArtifactDoc = {
      id,
      title: '新建文档',
      kind: 'generic',
      role,
      content: '# 新建文档\n\n开始输入内容…',
      createdAt: Date.now(),
      source: 'manual',
    }
    set({ docs: [doc, ...get().docs], activeId: id })
    persist(get().docs)
    return id
  },
}))
