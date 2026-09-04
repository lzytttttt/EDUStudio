import { create } from 'zustand'
import type { AgentTraceEvent, ChatMessage, RoleId } from '../harness/types'
import { getProviders } from '../harness/providerRegistry'
import { useAuthStore } from './authStore'
import { useArtifactStore } from './artifactStore'
import { loadJSON, saveJSON } from '../lib/storage'
import { typewriter } from '../lib/typewriter'

export interface ChatEntry {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** assistant 条目的执行轨迹（Plan/Tool/Reflect 条） */
  trace: AgentTraceEvent[]
  streaming?: boolean
}

export interface ChatSession {
  id: string
  title: string
  role: RoleId
  entries: ChatEntry[]
  createdAt: number
  updatedAt: number
}

interface ChatState {
  sessions: ChatSession[]
  activeId: string | null
  streaming: boolean
  ensureSession: (role: RoleId, title?: string) => string
  setActive: (id: string) => void
  newSession: (role: RoleId, title?: string) => string
  removeSession: (id: string) => void
  sendMessage: (goal: string) => Promise<void>
  abort: () => void
}

let seq = 0
function nextId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq}`
}

function persist(sessions: ChatSession[]) {
  saveJSON('chat', sessions)
}

const persistedSessions = loadJSON<ChatSession[]>('chat', [])

export const useChatStore = create<ChatState>((set, get) => {
  let controller: AbortController | null = null

  const patchEntry = (sessionId: string, entryId: string, patch: Partial<ChatEntry>) => {
    set({
      sessions: get().sessions.map((s) =>
        s.id !== sessionId
          ? s
          : {
              ...s,
              updatedAt: Date.now(),
              entries: s.entries.map((e) => (e.id === entryId ? { ...e, ...patch } : e)),
            },
      ),
    })
  }

  return {
    sessions: persistedSessions,
    activeId: persistedSessions[0]?.id ?? null,
    streaming: false,

    ensureSession: (role, title) => {
      const active = get().sessions.find((s) => s.id === get().activeId)
      if (active && active.role === role) return active.id
      return get().newSession(role, title)
    },

    setActive: (id) => set({ activeId: id }),

    newSession: (role, title) => {
      const id = nextId('sess')
      const session: ChatSession = {
        id,
        title: title ?? '新任务',
        role,
        entries: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      set({ sessions: [session, ...get().sessions], activeId: id })
      persist(get().sessions)
      return id
    },

    removeSession: (id) => {
      const sessions = get().sessions.filter((s) => s.id !== id)
      set({
        sessions,
        activeId: get().activeId === id ? (sessions[0]?.id ?? null) : get().activeId,
      })
      persist(sessions)
    },

    abort: () => {
      controller?.abort()
      controller = null
    },

    sendMessage: async (goal) => {
      const role = useAuthStore.getState().role
      if (!role || get().streaming) return
      const trimmed = goal.trim()
      if (!trimmed) return

      const sessionId = get().ensureSession(role, trimmed.slice(0, 18))
      const entryId = nextId('asst')
      const userEntry: ChatEntry = { id: nextId('user'), role: 'user', content: trimmed, trace: [] }
      const asstEntry: ChatEntry = { id: entryId, role: 'assistant', content: '', trace: [], streaming: true }

      set({
        streaming: true,
        sessions: get().sessions.map((s) =>
          s.id === sessionId
            ? { ...s, title: s.entries.length === 0 ? trimmed.slice(0, 18) : s.title, entries: [...s.entries, userEntry, asstEntry], updatedAt: Date.now() }
            : s,
        ),
      })
      persist(get().sessions)

      controller = new AbortController()
      const signal = controller.signal
      const artifactStore = useArtifactStore.getState()

      /** 事件顺序队列：允许 emit 回调内做异步打字机，保证渲染顺序 */
      let queue: Promise<void> = Promise.resolve()
      const enqueue = (fn: () => Promise<void>) => {
        queue = queue.then(fn).catch((err) => console.error('[chat] event failed:', err))
      }

      const handleEvent = async (e: AgentTraceEvent) => {
        switch (e.kind) {
          case 'plan':
          case 'tool_call':
          case 'tool_result':
          case 'reflect': {
            const entry = get().sessions.find((s) => s.id === sessionId)?.entries.find((x) => x.id === entryId)
            patchEntry(sessionId, entryId, { trace: [...(entry?.trace ?? []), e] })
            return
          }
          case 'text':
          case 'done': {
            for await (const chunk of typewriter(e.text, { signal })) {
              const cur = get().sessions.find((s) => s.id === sessionId)?.entries.find((x) => x.id === entryId)
              patchEntry(sessionId, entryId, { content: (cur?.content ?? '') + chunk })
            }
            return
          }
          case 'artifact_meta': {
            artifactStore.createPlaceholder(e.artifactId, e.title, e.docKind as never, role, 'agent')
            return
          }
          case 'artifact_chunk': {
            artifactStore.appendChunk(e.artifactId, e.chunk)
            return
          }
          case 'artifact_done': {
            artifactStore.finalize(e.artifactId, e.title, e.docKind as never)
            return
          }
        }
      }

      const history: ChatMessage[] = (get().sessions.find((s) => s.id === sessionId)?.entries ?? [])
        .filter((x) => x.content)
        .slice(-8)
        .map((x) => ({ role: x.role === 'user' ? 'user' : 'assistant', content: x.content }))

      try {
        await getProviders().agent.runTask({ role, goal: trimmed, history, signal }, (e) => enqueue(() => handleEvent(e)))
        await queue
      } catch (err) {
        console.error('[chat] runTask failed:', err)
        // 连续失败达上限（FallbackAgent 抛出）：向用户给出可感知的错误反馈
        const cur = get().sessions.find((s) => s.id === sessionId)?.entries.find((x) => x.id === entryId)
        if (!cur?.content) {
          patchEntry(sessionId, entryId, {
            content: `任务执行失败：${((err as Error)?.message ?? '未知错误').slice(0, 120)}。请检查设置页的模型配置后重试，或切换 Mock 模式。`,
          })
        }
      } finally {
        patchEntry(sessionId, entryId, { streaming: false })
        set({ streaming: false })
        controller = null
        persist(get().sessions)
      }
    },
  }
})
