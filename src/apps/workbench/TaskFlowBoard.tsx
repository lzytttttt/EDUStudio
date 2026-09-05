import { useEffect, useMemo, useState } from 'react'
import {
  Send, ChevronDown, ChevronRight, Clock, CheckCircle2, Inbox, FileCheck, Trash2, X, Users, Plus, RefreshCw,
} from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useTaskFlowStore, flowsForRole, myReceipt } from '../../stores/taskFlowStore'
import { TASK_FLOW_STATUS_LABEL, type TaskFlow, type TaskFlowStatus } from '../../data/taskFlow'
import { CLASSES, SCHOOLS } from '../../data/seed'
import { t } from '../../lib/i18n'
import { cn } from '../../lib/cn'

/** 同步状态徽标（v0.5 M2③，文案走 i18n v0.5 M4③） */
const SYNC_STYLE = {
  local: 'bg-surface-2 text-ink-mute',
  syncing: 'bg-surface-2 text-ink-mute',
  remote: 'bg-mint-soft text-mint',
  degraded: 'bg-amber-soft text-amber-600',
} as const

const STATUS_STYLE: Record<TaskFlowStatus, string> = {
  pending: 'bg-amber-soft text-amber-600',
  acknowledged: 'bg-primary-soft text-primary',
  submitted: 'bg-mint-soft text-mint',
}

const STATUS_ICON: Record<TaskFlowStatus, typeof Clock> = {
  pending: Clock,
  acknowledged: Inbox,
  submitted: FileCheck,
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 可选接收方：局→学校；校→本校班主任（Mock：取种子班级班主任去重） */
function targetOptions(role: 'bureau' | 'schoolAdmin'): { name: string; role: 'schoolAdmin' | 'teacher' }[] {
  if (role === 'bureau') return SCHOOLS.map((s) => ({ name: s.name, role: 'schoolAdmin' as const }))
  const seen = new Set<string>()
  const out: { name: string; role: 'teacher' }[] = []
  for (const c of CLASSES) {
    if (!seen.has(c.headTeacher)) {
      seen.add(c.headTeacher)
      out.push({ name: c.headTeacher, role: 'teacher' })
    }
  }
  return out
}

export default function TaskFlowBoard() {
  const role = useAuthStore((s) => s.role)
  const { flows, syncState, refresh, issue, acknowledge, submit, remove } = useTaskFlowStore()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  // 远端同步（v0.5 M2③）：挂载即拉取 + 15s 轮询，回执变化自动进通知中心
  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 15000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const visible = useMemo(() => (role ? flowsForRole(flows, role) : []), [flows, role])
  const canIssue = role === 'bureau' || role === 'schoolAdmin'
  const pendingCount = visible.reduce(
    (n, f) => n + f.receipts.filter((r) => r.status === 'pending').length,
    0,
  )

  if (!role) return null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 头部 */}
      <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Send size={15} className="text-ink-mute" />
          <h2 className="text-sm font-semibold">下发任务</h2>
          {pendingCount > 0 && (
            <span className="rounded-full bg-amber-soft px-2 py-0.5 text-[0.625rem] font-medium text-amber-600">
              {pendingCount} 待处理
            </span>
          )}
          <span
            className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.625rem] font-medium', SYNC_STYLE[syncState])}
            title="任务链跨端同步状态（v0.5 M2③）"
          >
            <RefreshCw size={9} className={cn(syncState === 'syncing' && 'animate-spin')} />
            {t(`flow.sync.${syncState}` as const)}
          </span>
        </div>
        {canIssue && (
          <button
            onClick={() => setFormOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-primary-deep active:scale-95"
          >
            <Plus size={13} />
            下发任务
          </button>
        )}
      </header>

      {/* 任务列表 */}
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
        {visible.length === 0 && (
          <p className="px-2 py-8 text-center text-xs leading-relaxed text-ink-mute">
            暂无下发任务
            <br />
            {canIssue ? '点击「下发任务」创建第一条通知' : '收到上级下发后会出现在这里'}
          </p>
        )}
        {visible.map((flow) => (
          <FlowCard
            key={flow.id}
            flow={flow}
            role={role}
            expanded={expandedId === flow.id}
            onToggle={() => setExpandedId(expandedId === flow.id ? null : flow.id)}
            onAcknowledge={(rid) => acknowledge(flow.id, rid)}
            onSubmit={(rid, note) => submit(flow.id, rid, note)}
            onRemove={() => remove(flow.id)}
          />
        ))}
      </div>

      {/* 下发表单 */}
      {formOpen && canIssue && (
        <IssueForm
          role={role}
          onClose={() => setFormOpen(false)}
          onSubmit={(input) => {
            issue(input)
            setFormOpen(false)
          }}
        />
      )}
    </div>
  )
}

/* ---------- 单条任务卡片 ---------- */

function FlowCard({
  flow, role, expanded, onToggle, onAcknowledge, onSubmit, onRemove,
}: {
  flow: TaskFlow
  role: 'bureau' | 'schoolAdmin' | 'teacher'
  expanded: boolean
  onToggle: () => void
  onAcknowledge: (receiptId: string) => void
  onSubmit: (receiptId: string, note?: string) => void
  onRemove: () => void
}) {
  const isIssuer = flow.fromRole === role
  const mine = myReceipt(flow, role)
  const done = flow.receipts.filter((r) => r.status !== 'pending').length

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <button onClick={onToggle} className="flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors hover:bg-surface-2">
        <ChevronRight size={14} className={cn('mt-0.5 shrink-0 text-ink-mute transition-transform', expanded && 'rotate-90')} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.8125rem] font-semibold leading-tight text-ink">{flow.title}</p>
          <p className="minor-info mt-1 text-[0.625rem] text-ink-mute">
            {flow.from} · {fmtTime(flow.issuedAt)} 发出 · 截止 {flow.deadline}
          </p>
          {/* 回执进度 */}
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-mint transition-all"
                style={{ width: `${flow.receipts.length ? (done / flow.receipts.length) * 100 : 0}%` }}
              />
            </div>
            <span className="minor-info text-[0.625rem] text-ink-mute">
              {done}/{flow.receipts.length} 已回执
            </span>
            {mine && (
              <span className={cn('rounded-full px-1.5 py-0.5 text-[0.5625rem] font-medium', STATUS_STYLE[mine.status])}>
                我的：{TASK_FLOW_STATUS_LABEL[mine.status]}
              </span>
            )}
          </div>
        </div>
        {isIssuer && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            onKeyDown={(e) => e.key === 'Enter' && onRemove()}
            className="shrink-0 rounded-lg p-1 text-ink-mute transition-colors hover:bg-danger/10 hover:text-danger"
            aria-label="删除任务"
          >
            <Trash2 size={13} />
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-line bg-surface-2/50 px-4 py-3">
          <p className="text-xs leading-relaxed text-ink-soft">{flow.content}</p>
          <ul className="mt-3 space-y-1.5">
            {flow.receipts.map((r) => {
              const Icon = STATUS_ICON[r.status]
              const isMine = mine?.id === r.id
              return (
                <li key={r.id} className="flex items-center gap-2.5 rounded-xl bg-surface px-3 py-2">
                  <Icon size={13} className={cn('shrink-0', r.status === 'pending' ? 'text-amber-600' : r.status === 'acknowledged' ? 'text-primary' : 'text-mint')} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-ink">
                      {r.target}
                      {isMine && <span className="rounded bg-primary-soft px-1 py-0.5 text-[0.5625rem] text-primary">我</span>}
                    </p>
                    {r.note && <p className="minor-info mt-0.5 truncate text-[0.625rem] text-ink-mute">{r.note}</p>}
                  </div>
                  <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[0.625rem] font-medium', STATUS_STYLE[r.status])}>
                    {TASK_FLOW_STATUS_LABEL[r.status]}
                  </span>
                  {/* 接收方操作 */}
                  {isMine && r.status === 'pending' && (
                    <button
                      onClick={() => onAcknowledge(r.id)}
                      className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-[0.625rem] font-medium text-white transition-all hover:bg-primary-deep active:scale-95"
                    >
                      确认接收
                    </button>
                  )}
                  {isMine && r.status === 'acknowledged' && (
                    <button
                      onClick={() => {
                        const note = window.prompt('成果说明（可选）：') ?? undefined
                        onSubmit(r.id, note)
                      }}
                      className="shrink-0 rounded-full bg-mint px-2.5 py-1 text-[0.625rem] font-medium text-white transition-all hover:opacity-90 active:scale-95"
                    >
                      提交成果
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

/* ---------- 下发表单 ---------- */

function IssueForm({
  role, onClose, onSubmit,
}: {
  role: 'bureau' | 'schoolAdmin'
  onClose: () => void
  onSubmit: (input: { title: string; content: string; deadline: string; targets: { name: string; role: 'schoolAdmin' | 'teacher' }[] }) => void
}) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [deadline, setDeadline] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const options = useMemo(() => targetOptions(role), [role])

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="animate-fade-up flex max-h-[85%] w-full max-w-sm flex-col rounded-3xl border border-line bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Send size={14} className="text-primary" />
            下发任务
          </h3>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink"
            aria-label="关闭"
          >
            <X size={14} />
          </button>
        </div>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="任务标题，如：关于开展期中质量分析的通知"
          className="mt-3 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs outline-none transition-colors focus:border-primary/50"
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="任务要求与说明…"
          rows={3}
          className="mt-2 w-full resize-none rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs leading-relaxed outline-none transition-colors focus:border-primary/50"
        />
        <input
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          placeholder="截止时间，如：本周五 17:00"
          className="mt-2 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs outline-none transition-colors focus:border-primary/50"
        />

        <p className="mt-3 flex items-center gap-1.5 text-[0.6875rem] font-medium text-ink-soft">
          <Users size={12} />
          选择接收方（{role === 'bureau' ? '学校' : '教师'}）
        </p>
        <div className="mt-1.5 min-h-0 flex-1 space-y-1 overflow-y-auto">
          {options.map((o) => (
            <button
              key={o.name}
              onClick={() => toggle(o.name)}
              className={cn(
                'flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-xs transition-colors',
                selected.has(o.name) ? 'border-primary/50 bg-primary-soft text-primary' : 'border-line bg-surface-2 text-ink-soft hover:border-primary/30',
              )}
            >
              <span className="font-medium">{o.name}</span>
              {selected.has(o.name) && <CheckCircle2 size={13} />}
            </button>
          ))}
        </div>

        <button
          onClick={() => onSubmit({ title, content, deadline, targets: options.filter((o) => selected.has(o.name)) })}
          disabled={!title.trim() || selected.size === 0}
          className="mt-3 shrink-0 rounded-full bg-primary py-2.5 text-xs font-medium text-white transition-all hover:bg-primary-deep active:scale-[0.98] disabled:opacity-40"
        >
          发送（已选 {selected.size} 个接收方）
        </button>
      </div>
    </div>
  )
}
