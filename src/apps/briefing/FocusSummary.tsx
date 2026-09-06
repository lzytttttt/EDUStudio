import { Check, ChevronRight, CircleAlert, Clock, LayoutDashboard, Loader2, RotateCcw, Star, X } from 'lucide-react'
import type { BackgroundTask, BackgroundTaskStatus } from '../../stores/focusStore'
import { cn } from '../../lib/cn'

interface FocusSummaryProps {
  tasks: BackgroundTask[]
  stats: { accept: number; fav: number; skip: number }
  onEnterWorkbench: () => void
  onReplay: () => void
  /** 点击任务直达对应任务会话（一卡一任务） */
  onSelectTask?: (task: BackgroundTask) => void
}

export const STATUS_META: Record<BackgroundTaskStatus, { label: string; cls: string }> = {
  queued: { label: '排队中', cls: 'text-ink-mute' },
  running: { label: '执行中', cls: 'text-primary' },
  done: { label: '已完成', cls: 'text-mint' },
  failed: { label: '执行失败', cls: 'text-coral' },
}

export function StatusIcon({ status }: { status: BackgroundTaskStatus }) {
  if (status === 'running')
    return <Loader2 size={16} className="shrink-0 animate-spin text-primary" />
  if (status === 'done') return <Check size={16} className="shrink-0 text-mint" />
  if (status === 'failed') return <CircleAlert size={16} className="shrink-0 text-coral" />
  return <Clock size={16} className="shrink-0 text-ink-mute" />
}

/** 批示完成总结层（v0.7 专注模式）：决策统计 + 后台任务实时状态 + 统一处理入口 */
export default function FocusSummary({ tasks, stats, onEnterWorkbench, onReplay, onSelectTask }: FocusSummaryProps) {
  const pending = tasks.filter((t) => t.status === 'queued' || t.status === 'running').length
  const failed = tasks.filter((t) => t.status === 'failed').length
  return (
    <div className="animate-fade-up w-full max-w-[460px] px-4">
      <div className="rounded-[28px] border border-line bg-surface p-6 shadow-card">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <Check size={26} />
          </div>
          <h2 className="mt-4 text-xl font-bold">批示完成</h2>
          <p className="mt-1.5 text-sm text-ink-soft">
            {pending > 0
              ? `${pending} 个任务正在后台执行，完成后可统一处理`
              : failed > 0
                ? '任务已执行完毕，部分失败可在工作台重试'
                : '所有采纳任务已执行完毕'}
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary">
              <Check size={11} /> 采纳 {stats.accept}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-soft px-3 py-1 text-xs font-semibold text-amber">
              <Star size={11} /> 收藏 {stats.fav}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-coral-soft px-3 py-1 text-xs font-semibold text-coral">
              <X size={11} /> 跳过 {stats.skip}
            </span>
          </div>
        </div>

        <div className="mt-5 max-h-[224px] space-y-2 overflow-y-auto" data-testid="focus-task-list">
          {tasks.map((t) => {
            const row = (
              <>
                <StatusIcon status={t.status} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.title}</p>
                  <p className="truncate text-xs text-ink-mute">{t.goal}</p>
                </div>
                <span className={cn('shrink-0 text-[0.6875rem] font-medium', STATUS_META[t.status].cls)}>
                  {STATUS_META[t.status].label}
                </span>
              </>
            )
            /* 一卡一任务：任务行可点击，直达本卡专属任务会话 */
            return onSelectTask && t.sessionId ? (
              <button
                key={t.id}
                onClick={() => onSelectTask(t)}
                data-testid="focus-task-item"
                className="flex w-full items-center gap-3 rounded-2xl border border-line px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary-soft/40"
              >
                {row}
                <ChevronRight size={13} className="shrink-0 text-ink-mute" />
              </button>
            ) : (
              <div key={t.id} className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3">
                {row}
              </div>
            )
          })}
        </div>

        {/* 移动端纵向堆叠（v0.8.1）：小屏两按钮并排易溢出 */}
        <div className="mt-5 flex flex-col-reverse items-stretch gap-2.5 sm:flex-row sm:items-center sm:justify-center sm:gap-3">
          <button
            onClick={onEnterWorkbench}
            data-testid="focus-enter-workbench"
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-white shadow-soft transition-all hover:bg-primary-deep hover:shadow-pop sm:w-auto"
          >
            <LayoutDashboard size={15} />
            统一处理，进入工作台
          </button>
          <button
            onClick={onReplay}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-line bg-surface px-5 py-2.5 text-sm font-medium text-ink-soft transition-colors hover:border-primary/50 hover:text-primary sm:w-auto"
          >
            <RotateCcw size={14} />
            重新过一遍
          </button>
        </div>
      </div>
    </div>
  )
}
