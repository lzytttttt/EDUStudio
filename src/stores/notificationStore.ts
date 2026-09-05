/**
 * 通知中心（v0.5 M2④）
 *
 * 统一收纳三类事件：评审批注回传（annotation）、任务链回执（receipt）、
 * 任务下发提醒（task）。侧栏铃铛 + 会话页顶部条双入口，点击可跳转对应文档/看板。
 * 本地持久化（上限 50 条），跨角色共享同一浏览器存储。
 */
import { create } from 'zustand'
import { loadJSON, saveJSON } from '../lib/storage'

export type NotificationKind = 'annotation' | 'receipt' | 'task' | 'system'

export interface NotifItem {
  id: string
  kind: NotificationKind
  title: string
  body: string
  createdAt: number
  read: boolean
  /** 关联文档 id（批注类通知点击跳转文档工作区） */
  docId?: string
  /** 关联任务链 id（回执类通知点击跳转看板） */
  flowId?: string
}

interface NotificationState {
  items: NotifItem[]
  panelOpen: boolean
  push: (n: Omit<NotifItem, 'id' | 'createdAt' | 'read'> & { id?: string }) => void
  markRead: (id: string) => void
  markAllRead: () => void
  clear: () => void
  openPanel: () => void
  closePanel: () => void
}

const MAX_ITEMS = 50

const persisted = loadJSON<NotifItem[]>('notifications', [])

function persist(items: NotifItem[]): void {
  saveJSON('notifications', items)
}

function genId(): string {
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: persisted,
  panelOpen: false,

  push: (n) => {
    const item: NotifItem = {
      id: n.id ?? genId(),
      kind: n.kind,
      title: n.title,
      body: n.body,
      createdAt: Date.now(),
      read: false,
      docId: n.docId,
      flowId: n.flowId,
    }
    const items = [item, ...get().items].slice(0, MAX_ITEMS)
    set({ items })
    persist(items)
  },

  markRead: (id) => {
    const items = get().items.map((i) => (i.id === id ? { ...i, read: true } : i))
    set({ items })
    persist(items)
  },

  markAllRead: () => {
    const items = get().items.map((i) => (i.read ? i : { ...i, read: true }))
    set({ items })
    persist(items)
  },

  clear: () => {
    set({ items: [] })
    persist([])
  },

  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
}))

/** 未读数（侧栏角标 / 会话条共用） */
export function unreadCount(items: NotifItem[]): number {
  return items.filter((i) => !i.read).length
}
