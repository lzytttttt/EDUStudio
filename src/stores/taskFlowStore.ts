import { create } from 'zustand'
import type { RoleId } from '../harness/types'
import { loadJSON, saveJSON } from '../lib/storage'
import { getApiBase, apiJson } from '../lib/api'
import { useAuthStore } from './authStore'
import { useNotificationStore } from './notificationStore'
import { SEED_TASK_FLOWS, type TaskFlow, type TaskFlowReceipt } from '../data/taskFlow'

interface IssueInput {
  title: string
  content: string
  deadline: string
  targets: { name: string; role: 'schoolAdmin' | 'teacher' }[]
}

interface TaskFlowState {
  flows: TaskFlow[]
  /** 远端同步状态（v0.5 M2③）：local=未配置服务 syncing=同步中 remote=已连接 degraded=服务不可用（本地兜底） */
  syncState: 'local' | 'syncing' | 'remote' | 'degraded'
  /** 下发任务（局→校 / 校→教师） */
  issue: (input: IssueInput) => void
  /** 接收方回执：确认接收 */
  acknowledge: (flowId: string, receiptId: string) => void
  /** 接收方提交成果 */
  submit: (flowId: string, receiptId: string, note?: string) => void
  remove: (flowId: string) => void
  /** 从轻后端拉取任务链并合并（跨端可见，v0.5 M2③） */
  refresh: () => Promise<void>
  /** 新建任务链推送到服务端（内部） */
  pushCreate: (localId: string) => Promise<void>
  /** 回执状态推送到服务端（内部） */
  pushReceipt: (flowId: string, receiptId: string, action: 'acknowledge' | 'submit', note?: string) => Promise<void>
}

const persisted = loadJSON<TaskFlow[]>('taskFlows', SEED_TASK_FLOWS)

function persist(flows: TaskFlow[]): void {
  saveJSON('taskFlows', flows)
}

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/* ---------- 轻后端任务链同步（v0.5 M2③） ---------- */

/** 服务端任务链结构（与 proxy /v1/flows 对齐） */
export interface ServerFlow {
  id: string
  title: string
  content: string
  deadline: string
  from: string
  fromRole: string
  createdAt: number
  receipts: { id: string; name: string; role: string; status: string; note: string; updatedAt: number }[]
}

/** 服务端 → 本地结构映射 */
export function fromServerFlow(f: ServerFlow): TaskFlow {
  return {
    id: f.id,
    title: f.title,
    content: f.content,
    from: f.from,
    fromRole: (f.fromRole === 'bureau' ? 'bureau' : f.fromRole === 'schoolAdmin' ? 'schoolAdmin' : 'teacher') as RoleId,
    issuedAt: f.createdAt,
    deadline: f.deadline || '尽快完成',
    receipts: (f.receipts ?? []).map((r) => ({
      id: r.id,
      target: r.name,
      targetRole: r.role === 'teacher' ? ('teacher' as const) : ('schoolAdmin' as const),
      status: (r.status === 'submitted' ? 'submitted' : r.status === 'acknowledged' ? 'acknowledged' : 'pending') as TaskFlowReceipt['status'],
      updatedAt: r.updatedAt,
      note: r.note || undefined,
    })),
  }
}

/** 合并本地与远端任务链：远端为准，本地独有（离线创建）保留，按下发时间倒序 */
export function mergeFlows(local: TaskFlow[], remote: TaskFlow[]): TaskFlow[] {
  const byId = new Map<string, TaskFlow>()
  for (const f of local) byId.set(f.id, f)
  for (const f of remote) byId.set(f.id, f)
  return [...byId.values()].sort((a, b) => b.issuedAt - a.issuedAt)
}

export const useTaskFlowStore = create<TaskFlowState>((set, get) => ({
  flows: persisted,
  syncState: 'local',

  /* 新建任务链推送到服务端（v0.5 M2③）；失败降级为本地模式，不丢数据 */
  pushCreate: async (localId) => {
    const base = getApiBase()
    const flow = get().flows.find((f) => f.id === localId)
    if (!base || !flow) return
    set({ syncState: 'syncing' })
    try {
      const j = await apiJson<{ flow: ServerFlow }>(base, '/v1/flows', {
        method: 'POST',
        body: JSON.stringify({
          title: flow.title,
          content: flow.content,
          deadline: flow.deadline,
          from: flow.from,
          fromRole: flow.fromRole,
          targets: flow.receipts.map((r) => ({ name: r.target, role: r.targetRole })),
        }),
      })
      const remote = fromServerFlow(j.flow)
      set({ flows: get().flows.map((f) => (f.id === localId ? remote : f)), syncState: 'remote' })
      persist(get().flows)
    } catch {
      set({ syncState: 'degraded' })
    }
  },

  /* 回执状态推送到服务端（v0.5 M2③） */
  pushReceipt: async (flowId, receiptId, action, note) => {
    const base = getApiBase()
    if (!base) return
    try {
      const j = await apiJson<{ flow: ServerFlow }>(base, `/v1/flows/${encodeURIComponent(flowId)}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ receiptId, note }),
      })
      const remote = fromServerFlow(j.flow)
      set({ flows: get().flows.map((f) => (f.id === flowId ? remote : f)), syncState: 'remote' })
      persist(get().flows)
    } catch {
      set({ syncState: 'degraded' })
    }
  },

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
    void get().pushCreate(flow.id)
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
    void get().pushReceipt(flowId, receiptId, 'acknowledge')
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
    void get().pushReceipt(flowId, receiptId, 'submit', note?.trim() || undefined)
  },

  remove: (flowId) => {
    const flows = get().flows.filter((f) => f.id !== flowId)
    set({ flows })
    persist(flows)
  },

  /* 拉取远端任务链并合并（v0.5 M2③）：服务端为准，本地独有保留；回执变化/新任务进通知中心 */
  refresh: async () => {
    const base = getApiBase()
    if (!base) return
    set({ syncState: 'syncing' })
    try {
      const j = await apiJson<{ flows: ServerFlow[] }>(base, '/v1/flows')
      const remote = j.flows.map(fromServerFlow)
      const myRole = useAuthStore.getState().role
      const prevById = new Map(get().flows.map((f) => [f.id, f]))
      const notify = useNotificationStore.getState()
      for (const f of remote) {
        const prev = prevById.get(f.id)
        if (!prev) {
          // 新任务且与我相关 → 提醒
          if (myRole && f.receipts.some((r) => r.targetRole === myRole)) {
            notify.push({
              kind: 'task',
              title: `收到新任务：${f.title}`,
              body: `${f.from} · 截止 ${f.deadline}`,
              flowId: f.id,
            })
          }
          continue
        }
        for (const r of f.receipts) {
          const before = prev.receipts.find((x) => x.id === r.id)
          if (before && before.status !== r.status && r.status !== 'pending') {
            notify.push({
              kind: 'receipt',
              title: `「${f.title}」${r.target} 已${r.status === 'submitted' ? '提交成果' : '回执'}`,
              body: r.note ?? '',
              flowId: f.id,
            })
          }
        }
      }
      set({ flows: mergeFlows(get().flows, remote), syncState: 'remote' })
      persist(get().flows)
    } catch {
      set({ syncState: 'degraded' })
    }
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
