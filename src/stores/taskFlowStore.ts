import { create } from 'zustand'
import type { RoleId } from '../harness/types'
import { loadJSON, saveJSON } from '../lib/storage'
import { useAuthStore } from './authStore'
import { SEED_TASK_FLOWS, type TaskFlow, type TaskFlowReceipt } from '../data/taskFlow'

interface IssueInput {
  title: string
  content: string
  deadline: string
  targets: { name: string; role: 'schoolAdmin' | 'teacher' }[]
}

interface TaskFlowState {
  flows: TaskFlow[]
  /** 下发任务（局→校 / 校→教师） */
  issue: (input: IssueInput) => void
  /** 接收方回执：确认接收 */
  acknowledge: (flowId: string, receiptId: string) => void
  /** 接收方提交成果 */
  submit: (flowId: string, receiptId: string, note?: string) => void
  remove: (flowId: string) => void
}

const persisted = loadJSON<TaskFlow[]>('taskFlows', SEED_TASK_FLOWS)

function persist(flows: TaskFlow[]): void {
  saveJSON('taskFlows', flows)
}

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export const useTaskFlowStore = create<TaskFlowState>((set, get) => ({
  flows: persisted,

  issue: ({ title, content, deadline, targets }) => {
    const role = useAuthStore.getState().role ?? 'teacher'
    const from = role === 'bureau' ? '区教育局' : '实验一中'
    const flow: TaskFlow = {
      id: genId('tf'),
      title: title.trim() || '未命名任务',
      content: content.trim(),
      from,
      fromRole: role,
      issuedAt: Date.now(),
      deadline: deadline.trim() || '尽快完成',
      receipts: targets.map((t) => ({
        id: genId('r'),
        target: t.name,
        targetRole: t.role,
        status: 'pending' as const,
      })),
    }
    set({ flows: [flow, ...get().flows] })
    persist(get().flows)
  },

  acknowledge: (flowId, receiptId) => {
    set({
      flows: get().flows.map((f) =>
        f.id !== flowId
          ? f
          : {
              ...f,
              receipts: f.receipts.map((r) =>
                r.id === receiptId && r.status === 'pending' ? { ...r, status: 'acknowledged', updatedAt: Date.now() } : r,
              ),
            },
      ),
    })
    persist(get().flows)
  },

  submit: (flowId, receiptId, note) => {
    set({
      flows: get().flows.map((f) =>
        f.id !== flowId
          ? f
          : {
              ...f,
              receipts: f.receipts.map((r) =>
                r.id === receiptId && r.status !== 'submitted'
                  ? { ...r, status: 'submitted', updatedAt: Date.now(), note: note?.trim() || undefined }
                  : r,
              ),
            },
      ),
    })
    persist(get().flows)
  },

  remove: (flowId) => {
    const flows = get().flows.filter((f) => f.id !== flowId)
    set({ flows })
    persist(flows)
  },
}))

/** 视图过滤：当前角色可见的下发任务（v0.4 M2③） */
export function flowsForRole(flows: TaskFlow[], role: RoleId): TaskFlow[] {
  if (role === 'bureau') {
    // 局：看自己下发的
    return flows.filter((f) => f.fromRole === 'bureau')
  }
  if (role === 'schoolAdmin') {
    // 校：看局下发给自己的 + 自己下发给教师的
    return flows.filter(
      (f) =>
        (f.fromRole === 'bureau' && f.receipts.some((r) => r.targetRole === 'schoolAdmin')) ||
        f.fromRole === 'schoolAdmin',
    )
  }
  // 教师：看下发给教师的
  return flows.filter((f) => f.receipts.some((r) => r.targetRole === 'teacher'))
}

/** 当前角色在某个 flow 中的回执（接收方视角；教师取第一条教师回执，校长同理） */
export function myReceipt(flow: TaskFlow, role: RoleId): TaskFlowReceipt | null {
  if (role !== 'schoolAdmin' && role !== 'teacher') return null
  return flow.receipts.find((r) => r.targetRole === role) ?? null
}
