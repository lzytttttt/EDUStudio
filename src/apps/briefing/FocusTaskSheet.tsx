import { CheckCircle2, ChevronRight, LayoutDashboard, Loader2, X } from 'lucide-react'
import type { BackgroundTask } from '../../stores/focusStore'
import { STATUS_META, StatusIcon } from './FocusSummary'
import { cn } from '../../lib/cn'

interface FocusTaskSheetProps {
  tasks: BackgroundTask[]
  onClose: () => void
  onEnterWorkbench: () => void
  /** 点击任务直达对应任务会话（一卡一任务） */
  onSelectTask?: (task: BackgroundTask) => void
}

/** 后台任务浮层（v0.8.1 专注模式移动端优化）：批示过程中点击指示器随时查看任务明细与状态 */
export default function FocusTaskSheet({ tasks, onClose, onEnterWorkbench, onSelectTask }: FocusTaskSheetProps) {
  const active = tasks.filter((t) => t.status === 'queued' || t.status === 'running').length
  const done = tasks.filter((t) => t.status === 'done').length
  return (
    <div
      className="absolute inset-0 z-30 flex items-end justify-center bg-ink/30 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="animate-fade-up w-full max-w-sm rounded-3xl border border-line bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Loader2 size={14} className={cn('text-primary', active > 0 && 'animate-spin')} />
            后台任务（{tasks.length}）
          </h3>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink"
            aria-label="关闭"
          >
            <X size={14} />
          </button>
        </div>
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-mute">
          {active > 0 ? (
            <>{active} 个任务执行中，生成的文档会自动进入工作台文档区</>
          ) : (
            <>
              <CheckCircle2 size={13} className="text-mint" />
              全部执行完毕（{done}/{tasks.length}），可进入工作台统一处理
            </>
          )}
        </p>

        <ul className="mt-3 max-h-56 space-y-1.5 overflow-y-auto" data-testid="focus-sheet-task-list">
          {tasks.map((t) => {
            const row = (
              <>
                <StatusIcon status={t.status} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{t.title}</p>
                  <p className="truncate text-[0.625rem] text-ink-mute">{t.goal}</p>
                </div>
                <span className={cn('shrink-0 text-[0.625rem] font-medium', STATUS_META[t.status].cls)}>
                  {STATUS_META[t.status].label}
                </span>
              </>
            )
            /* 一卡一任务：任务行可点击，直达本卡专属任务会话 */
            return (
              <li key={t.id}>
                {onSelectTask && t.sessionId ? (
                  <button
                    onClick={() => onSelectTask(t)}
                    data-testid="focus-sheet-task-item"
                    className="flex w-full items-center gap-3 rounded-2xl border border-line px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary-soft/40"
                  >
                    {row}
                    <ChevronRight size={12} className="shrink-0 text-ink-mute" />
                  </button>
                ) : (
                  <div className="flex items-center gap-3 rounded-2xl border border-line px-3 py-2.5">{row}</div>
                )}
              </li>
            )
          })}
        </ul>

        <button
          onClick={() => {
            onEnterWorkbench()
            onClose()
          }}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-2.5 text-xs font-medium text-white shadow-soft transition-all hover:bg-primary-deep active:scale-[0.98]"
        >
          <LayoutDashboard size={14} />
          进入工作台查看
        </button>
      </div>
    </div>
  )
}
