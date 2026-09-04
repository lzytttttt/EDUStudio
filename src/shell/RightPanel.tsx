import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { FileText, Sparkles, Loader2, Send } from 'lucide-react'
import ArtifactPanel from '../apps/artifacts/ArtifactPanel'
import { useAuthStore } from '../stores/authStore'
import { useQuizStore } from '../stores/quizStore'
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

/** 右栏：文档 + 角色增强面板 + 下发任务三 tab（桌面常驻 / 窄屏抽屉共用） */
export default function RightPanel() {
  const role = useAuthStore((s) => s.role)
  const quizItems = useQuizStore((s) => s.items)
  const [tab, setTab] = useState<'doc' | 'board' | 'flow'>('doc')
  const prevQuizLen = useRef(quizItems.length)

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
          className={cn(
            'flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-xs font-medium transition-colors',
            tab === 'flow' ? 'border-b-2 border-primary text-primary' : 'text-ink-mute hover:text-ink-soft',
          )}
        >
          <Send size={13} />
          下发
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
