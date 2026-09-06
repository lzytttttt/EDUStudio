import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Sparkles, Loader2, Send } from 'lucide-react'
import ArtifactPanel from '../apps/artifacts/ArtifactPanel'
import { useAuthStore } from '../stores/authStore'
import { useQuizStore } from '../stores/quizStore'
import { useTaskFlowStore, flowsForRole } from '../stores/taskFlowStore'
import type { RoleId } from '../harness/types'
import { cn } from '../lib/cn'

/** 角色增强面板懒加载（v0.3 专项 ①：按需分包） */
const QuizEditor = lazy(() => import('../apps/workbench/QuizEditor'))
const AlertBoard = lazy(() => import('../apps/workbench/AlertBoard'))
const RegionBoard = lazy(() => import('../apps/workbench/RegionBoard'))
/** 下发任务链（v0.4 M2③：局→校→教师通知下发与回执跟踪） */
const TaskFlowBoard = lazy(() => import('../apps/workbench/TaskFlowBoard'))

const BOARD: Record<RoleId, { label: string; Comp: React.LazyExoticComponent<React.ComponentType> }> = {
  teacher: { label: '出题工作台', Comp: QuizEditor },
  schoolAdmin: { label: '校情驾驶舱', Comp: AlertBoard },
  bureau: { label: '区域看板', Comp: RegionBoard },
}

function BoardFallback() {
  return (
    <div className="flex flex-1 items-center justify-center text-ink-mute">
      <Loader2 size={18} className="animate-spin" />
    </div>
  )
}

/** 角色主工作台前置（v0.9.2 P0-B）：右栏默认 tab 按角色直达主工具，教师进工作台即见「出题工作台」 */
const DEFAULT_TAB: Record<RoleId, 'doc' | 'board' | 'flow'> = {
  teacher: 'board',
  schoolAdmin: 'board',
  bureau: 'flow',
}

/** 右栏：文档 + 角色增强面板 + 下发任务三 tab（桌面常驻 / 窄屏抽屉共用） */
export default function RightPanel() {
  const role = useAuthStore((s) => s.role)
  const quizItems = useQuizStore((s) => s.items)
  const [tab, setTab] = useState<'doc' | 'board' | 'flow'>(() => (role ? DEFAULT_TAB[role] : 'doc'))
  const prevQuizLen = useRef(quizItems.length)
  /* 下发待回执角标（v0.9.2 P2-A）：与 TaskFlowBoard 同口径统计 pending 回执 */
  const flows = useTaskFlowStore((s) => s.flows)
  const pendingReceipts = useMemo(() => {
    if (!role) return 0
    return flowsForRole(flows, role).reduce((n, f) => n + f.receipts.filter((r) => r.status === 'pending').length, 0)
  }, [flows, role])

  // Agent 命制新试题时自动切到出题工作台
  useEffect(() => {
    if (role === 'teacher' && quizItems.length > prevQuizLen.current) {
      setTab('board')
    }
    prevQuizLen.current = quizItems.length
  }, [quizItems.length, role])

  const board = role ? BOARD[role] : null
  const BoardComp = board?.Comp

  return (
    <div className="flex h-full w-full flex-col">
      {/* Tab 栏 */}
      <div className="flex shrink-0 gap-1 border-b border-line px-3 pt-2.5">
        <button
          onClick={() => setTab('doc')}
          data-testid="tab-doc"
          className={cn(
            'flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-xs font-medium transition-colors',
            tab === 'doc' ? 'border-b-2 border-primary text-primary' : 'text-ink-mute hover:text-ink-soft',
          )}
        >
          <FileText size={13} />
          文档
        </button>
        {board && BoardComp && (
          <button
            onClick={() => setTab('board')}
            data-testid="tab-board"
            className={cn(
              'flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-xs font-medium transition-colors',
              tab === 'board' ? 'border-b-2 border-primary text-primary' : 'text-ink-mute hover:text-ink-soft',
            )}
          >
            <Sparkles size={13} />
            {board.label}
          </button>
        )}
        <button
          onClick={() => setTab('flow')}
          data-testid="tab-flow"
          className={cn(
            'relative flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-xs font-medium transition-colors',
            tab === 'flow' ? 'border-b-2 border-primary text-primary' : 'text-ink-mute hover:text-ink-soft',
          )}
        >
          <Send size={13} />
          下发
          {/* 待回执角标（v0.9.2 P2-A）：局/校下发的任务有未处理回执时提醒；进入 tab 后隐藏（面板内已有「N 待处理」徽标） */}
          {pendingReceipts > 0 && tab !== 'flow' && (
            <span className="absolute -top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-coral px-1 text-[0.5625rem] font-bold text-white">
              {pendingReceipts > 9 ? '9+' : pendingReceipts}
            </span>
          )}
        </button>
      </div>

      {/* 内容 */}
      <div className="flex min-h-0 flex-1 flex-col">
        {tab === 'doc' ? (
          <ArtifactPanel />
        ) : tab === 'flow' ? (
          <Suspense fallback={<BoardFallback />}>
            <TaskFlowBoard />
          </Suspense>
        ) : (
          <Suspense fallback={<BoardFallback />}>{BoardComp && <BoardComp />}</Suspense>
        )}
      </div>
    </div>
  )
}
