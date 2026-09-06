import { create } from 'zustand'
import { LLMError, type AgentTraceEvent, type ChatMessage, type RoleId } from '../harness/types'
import { getProviders } from '../harness/providerRegistry'
import { useAuthStore } from './authStore'
import { useArtifactStore } from './artifactStore'
import { useSettingsStore } from './settingsStore'
import { loadJSON, saveJSON } from '../lib/storage'
import { typewriter } from '../lib/typewriter'

export interface ChatEntry {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** assistant 条目的执行轨迹（Plan/Tool/Reflect 条） */
  trace: AgentTraceEvent[]
  streaming?: boolean
  /** 触发本条 assistant 的用户目标（v0.4 M1④：失败重试用） */
  goal?: string
  /** 执行失败信息（非空时展示重试按钮） */
  error?: string
}

export interface ChatSession {
  id: string
  title: string
  role: RoleId
  entries: ChatEntry[]
  createdAt: number
  updatedAt: number
  /** 来源简报卡 id（一卡一任务）：采纳产生的任务与卡片一一对应，缺省 = 手动新建的任务 */
  cardId?: string
}

/** sendMessage 可选参数（一卡一任务）：显式指定落点会话与标题 */
export interface SendMessageOptions {
  /** 指定写入的会话（后台任务按卡执行时用），不存在时回退到 ensureSession */
  sessionId?: string
  /** 归属简报卡 id：已存在该卡任务时复用，避免拖回重批后重复采纳产生重复任务 */
  cardId?: string
  /** 任务标题（缺省取目标前 18 字） */
  title?: string
}

interface ChatState {
  sessions: ChatSession[]
  activeId: string | null
  streaming: boolean
  ensureSession: (role: RoleId, title?: string, cardId?: string) => string
  /** 按简报卡取/建任务会话（一卡一任务）：已存在则复用，避免拖回重批后重复采纳产生重复任务 */
  ensureCardSession: (role: RoleId, cardId: string, title?: string, opts?: { focus?: boolean }) => string
  setActive: (id: string) => void
  newSession: (role: RoleId, title?: string, cardId?: string) => string
  removeSession: (id: string) => void
  /** 发送任务：返回 assistant 条目 id（v0.7 专注模式追踪用；单飞占用/参数非法时返回 null） */
  sendMessage: (goal: string, opts?: SendMessageOptions) => Promise<string | null>
  /** 失败重试（v0.4 M1④）：清空失败条目并按原目标重新执行 */
  retry: (entryId: string) => Promise<void>
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

/** 当前执行中的 AbortController（sendMessage / retry 共用） */
let activeController: AbortController | null = null

export const useChatStore = create<ChatState>((set, get) => {
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

    ensureSession: (role, title, cardId) => {
      /* 一卡一任务：带 cardId 时按卡片归属复用，不再无脑追加进当前会话 */
      if (cardId) return get().ensureCardSession(role, cardId, title)
      const active = get().sessions.find((s) => s.id === get().activeId)
      if (active && active.role === role) return active.id
      return get().newSession(role, title)
    },

    ensureCardSession: (role, cardId, title, opts) => {
      const owned = get().sessions.find((s) => s.cardId === cardId && s.role === role)
      if (owned) {
        if (opts?.focus !== false && get().activeId !== owned.id) set({ activeId: owned.id })
        return owned.id
      }
      /* 后台执行（focus=false）不抢焦点：保留用户当前浏览的任务 */
      if (opts?.focus === false) {
        const prevActive = get().activeId
        const id = get().newSession(role, title, cardId)
        set({ activeId: prevActive })
        return id
      }
      return get().newSession(role, title, cardId)
    },

    setActive: (id) => set({ activeId: id }),

    newSession: (role, title, cardId) => {
      const id = nextId('sess')
      const session: ChatSession = {
        id,
        title: title ?? '新任务',
        role,
        entries: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...(cardId ? { cardId } : {}),
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
      activeController?.abort()
      activeController = null
    },

    sendMessage: async (goal, opts) => {
      const role = useAuthStore.getState().role
      if (!role || get().streaming) return null
      const trimmed = goal.trim()
      if (!trimmed) return null

      const title = opts?.title ?? trimmed.slice(0, 18)
      /* 显式 sessionId 优先（专注模式后台任务按卡落点）；会话可能已被删除，存在性校验后回退 */
      const sessionId =
        opts?.sessionId && get().sessions.some((s) => s.id === opts.sessionId)
          ? opts.sessionId
          : get().ensureSession(role, title, opts?.cardId)
      const entryId = nextId('asst')
      const userEntry: ChatEntry = { id: nextId('user'), role: 'user', content: trimmed, trace: [] }
      const asstEntry: ChatEntry = { id: entryId, role: 'assistant', content: '', trace: [], streaming: true, goal: trimmed }

      set({
        streaming: true,
        sessions: get().sessions.map((s) =>
          s.id === sessionId
            ? { ...s, title: s.entries.length === 0 ? title : s.title, entries: [...s.entries, userEntry, asstEntry], updatedAt: Date.now() }
            : s,
        ),
      })
      persist(get().sessions)

      await runAgentTask(set, get, patchEntry, sessionId, entryId, trimmed)
      return entryId
    },

    retry: async (entryId) => {
      const state = get()
      if (state.streaming) return
      const session = state.sessions.find((s) => s.id === state.activeId)
      const entry = session?.entries.find((x) => x.id === entryId)
      const goal = entry?.goal?.trim()
      if (!session || !goal) return

      // 断点重试（v0.4 M1④）：原位重建条目（清空内容/轨迹/错误），按原目标重新执行
      const newEntryId = nextId('asst')
      set({
        streaming: true,
        sessions: state.sessions.map((s) =>
          s.id !== session.id
            ? s
            : {
                ...s,
                updatedAt: Date.now(),
                entries: s.entries.flatMap((x) =>
                  x.id === entryId
                    ? [{ ...x, id: newEntryId, content: '', trace: [], streaming: true, error: undefined }]
                    : [x],
                ),
              },
        ),
      })
      persist(get().sessions)

      await runAgentTask(set, get, patchEntry, session.id, newEntryId, goal)
    },
  }
})

/**
 * 执行 Agent 任务并回写条目（sendMessage 与 retry 共用，v0.4 M1④ 抽取）。
 * set/get 由 store 闭包传入，避免模块级循环依赖。
 */
async function runAgentTask(
  set: (partial: Partial<ChatState>) => void,
  get: () => ChatState,
  patchEntry: (sessionId: string, entryId: string, patch: Partial<ChatEntry>) => void,
  sessionId: string,
  entryId: string,
  goal: string,
): Promise<void> {
  const role = useAuthStore.getState().role
  if (!role) {
    set({ streaming: false })
    return
  }

  const controller = new AbortController()
  activeController = controller
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
      case 'reflect':
      case 'skill_hit':
      case 'skill_learned': {
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
    .filter((x) => x.content && x.id !== entryId)
    .slice(-8)
    .map((x) => ({ role: x.role === 'user' ? 'user' : 'assistant', content: x.content }))

  try {
    await getProviders().agent.runTask({ role, goal, history, signal }, (e) => enqueue(() => handleEvent(e)))
    await queue
  } catch (err) {
    console.error('[chat] runTask failed:', err)
    // v0.5 M5②：Key 失效（401/403）自动清空，避免反复失败；提示用户重新填写
    if (err instanceof LLMError && (err.status === 401 || err.status === 403)) {
      useSettingsStore.getState().update({ apiKey: '' })
    }
    // 连续失败达上限（FallbackAgent 抛出）：记录错误并给出可感知的反馈（重试按钮见 ChatPanel）
    const cur = get().sessions.find((s) => s.id === sessionId)?.entries.find((x) => x.id === entryId)
    const keyCleared = err instanceof LLMError && (err.status === 401 || err.status === 403)
    const msg = `任务执行失败：${((err as Error)?.message ?? '未知错误').slice(0, 120)}。${keyCleared ? '检测到 Key 无效（401），已自动清空，请重新填写。' : '请检查设置页的模型配置后重试，或切换 Mock 模式。'}`
    if (!cur?.content) {
      patchEntry(sessionId, entryId, { content: msg, error: msg })
    } else {
      patchEntry(sessionId, entryId, { error: msg })
    }
  } finally {
    patchEntry(sessionId, entryId, { streaming: false })
    set({ streaming: false })
    activeController = null
    persist(get().sessions)
  }
}
