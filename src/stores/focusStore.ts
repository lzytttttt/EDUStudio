/**
 * focusStore —— 专注模式后台任务队列（v0.7）
 *
 * 采纳的简报不再立即跳工作台，而是入队后台顺序执行：
 * chatStore.sendMessage 有单飞约束（streaming 标志），因此用泵逐个 await，
 * 完成后按条目 error 判定 done / failed。内存态即可（chat 会话本身已持久化）。
 */
import { create } from 'zustand'
import type { BriefingCard } from '../harness/types'
import { useChatStore, type ChatEntry } from './chatStore'

export type BackgroundTaskStatus = 'queued' | 'running' | 'done' | 'failed'

export interface BackgroundTask {
  id: string
  /** 来源简报卡 id */
  cardId: string
  title: string
  goal: string
  /** chatStore 条目 id，供总结层实时展示执行状态 */
  entryId: string | null
  status: BackgroundTaskStatus
}

interface FocusState {
  tasks: BackgroundTask[]
  /** 采纳入队并触发泵（幂等：泵已在跑则仅入队） */
  acceptTask: (card: BriefingCard, goal: string) => void
  /** 清空任务（重新过一遍简报时调用） */
  clearTasks: () => void
}

let seq = 0
let pumping = false

function findEntry(entryId: string | null): ChatEntry | null {
  if (!entryId) return null
  for (const s of useChatStore.getState().sessions) {
    const entry = s.entries.find((x) => x.id === entryId)
    if (entry) return entry
  }
  return null
}

/** 泵：顺序消费队列（单飞约束下逐个执行），无任务后退出；下次入队重新触发 */
async function pump(): Promise<void> {
  if (pumping) return
  pumping = true
  try {
    for (;;) {
      const next = useFocusStore.getState().tasks.find((t) => t.status === 'queued')
      if (!next) break
      useFocusStore.setState((s) => ({
        tasks: s.tasks.map((t) => (t.id === next.id ? { ...t, status: 'running' } : t)),
      }))
      const entryId = await useChatStore.getState().sendMessage(next.goal)
      if (entryId === null) {
        // 单飞被占用（用户正在工作台手动执行任务）：回队等待，本轮泵退出避免忙等
        useFocusStore.setState((s) => ({
          tasks: s.tasks.map((t) => (t.id === next.id ? { ...t, status: 'queued' } : t)),
        }))
        break
      }
      const failed = findEntry(entryId)?.error != null
      useFocusStore.setState((s) => ({
        tasks: s.tasks.map((t) => (t.id === next.id ? { ...t, entryId, status: failed ? 'failed' : 'done' } : t)),
      }))
    }
  } finally {
    pumping = false
  }
}

export const useFocusStore = create<FocusState>((set, get) => ({
  tasks: [],
  acceptTask: (card, goal) => {
    seq += 1
    const task: BackgroundTask = {
      id: `bg-${Date.now().toString(36)}-${seq}`,
      cardId: card.id,
      title: card.title,
      goal,
      entryId: null,
      status: 'queued',
    }
    set({ tasks: [...get().tasks, task] })
    void pump()
  },
  clearTasks: () => set({ tasks: [] }),
}))
