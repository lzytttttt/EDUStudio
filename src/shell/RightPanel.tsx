import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Sparkles, Loader2, Send } from 'lucide-react'
import ArtifactPanel from '../apps/artifacts/ArtifactPanel'
import { useAuthStore } from '../stores/authStore'
import { useQuizStore } from '../stores/quizStore'
import { useArtifactStore } from '../stores/artifactStore'
import { useUiStore } from '../stores/uiStore'
import { useTaskFlowStore, flowsForRole } from '../stores/taskFlowStore'
import { BOARD_LABEL } from '../lib/rightPanel'
import type { RoleId } from '../harness/types'
import { cn } from '../lib/cn'

/** 角色增强面板懒加载（v0.3 专项 ①：按需分包） */
const QuizEditor = lazy(() => import('../apps/workbench/QuizEditor'))
const AlertBoard = lazy(() => import('../apps/workbench/AlertBoard'))
const RegionBoard = lazy(() => import('../apps/workbench/RegionBoard'))
/** 下发任务链（v0.4 M2③：局→校→教师通知下发与回执跟踪） */
const TaskFlowBoard = lazy(() => import('../apps/workbench/TaskFlowBoard'))

const BOARD: Record<RoleId, { label: string; Comp: React.LazyExoticComponent<React.ComponentType> }> = {
  teacher: { label: BOARD_LABEL.teacher, Comp: QuizEditor },
  schoolAdmin: { label: BOARD_LABEL.schoolAdmin, Comp: AlertBoard },
  bureau: { label: BOARD_LABEL.bureau, Comp: RegionBoard },
}

function BoardFallback() {
  return (
    <div className="flex flex-1 items-center justify-center text-ink-mute">
      <Loader2 size={18} className="animate-spin" />
    </div>
  )
}

const XL_QUERY = '(min-width: 1280px)'

/** 桌面常驻面板是否可见（与 AppShell 的 hidden xl:flex 同口径）：
 *  未读点只在可见时清除，窄屏抽屉关闭时不误清（v0.9.3 P0-A ②） */
function useXlVisible(): boolean {
  const [visible, setVisible] = useState(() => window.matchMedia(XL_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(XL_QUERY)
    const onChange = () => setVisible(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return visible
}

/** 右栏：文档 + 角色增强面板 + 下发任务三 tab（桌面常驻 / 窄屏抽屉共用）。
 *  variant 区分宿主：抽屉打开即可见，桌面常驻面板需 xl 断点可见（v0.9.3 P0-A ②）。 */
export default function RightPanel({ variant = 'desktop' }: { variant?: 'desktop' | 'drawer' }) {
  const role = useAuthStore((s) => s.role)
  const quizItems = useQuizStore((s) => s.items)
  /* 右栏 tab（v0.9.3 P0-A①）：上移到 uiStore，供「占位即切文档」与回退提示联动 */
  const rightTab = useUiStore((s) => s.rightTab)
  const setRightTab = useUiStore((s) => s.setRightTab)
  const syncRightTabRole = useUiStore((s) => s.syncRightTabRole)
  const docFocusRequest = useUiStore((s) => s.docFocusRequest)
  const consumeDocFocus = useUiStore((s) => s.consumeDocFocus)
  /* 生成中 / 未读点（v0.9.3 P0-A②） */
  const generatingIds = useArtifactStore((s) => s.generatingIds)
  const unreadDocIds = useArtifactStore((s) => s.unreadDocIds)
  const markDocsRead = useArtifactStore((s) => s.markDocsRead)
  const xlVisible = useXlVisible()
  const panelVisible = variant === 'drawer' || xlVisible
  const prevQuizLen = useRef(quizItems.length)
  /* 下发待回执角标（v0.9.2 P2-A）：与 TaskFlowBoard 同口径统计 pending 回执 */
  const flows = useTaskFlowStore((s) => s.flows)
  const pendingReceipts = useMemo(() => {
    if (!role) return 0
    return flowsForRole(flows, role).reduce((n, f) => n + f.receipts.filter((r) => r.status === 'pending').length, 0)
  }, [flows, role])

  // 角色口径同步（v0.9.2 P0-B 默认 / v0.9.3 P0-A）：角色切换时按角色默认重算，同角色不覆盖手动选择
  useEffect(() => {
    syncRightTabRole(role)
  }, [role, syncRightTabRole])

  // 占位即切「文档」（v0.9.3 P0-A①）：仅新占位触发一次，消费后归零
  useEffect(() => {
    if (docFocusRequest > 0) {
      setRightTab('doc')
      consumeDocFocus()
    }
  }, [docFocusRequest, setRightTab, consumeDocFocus])

  // 未读点清除（v0.9.3 P0-A②）：面板可见且停在文档 tab 时视为已查看
  useEffect(() => {
    if (panelVisible && rightTab === 'doc' && unreadDocIds.length > 0) markDocsRead()
  }, [panelVisible, rightTab, unreadDocIds.length, markDocsRead])

  // Agent 命制新试题时自动切到出题工作台
  useEffect(() => {
    if (role === 'teacher' && quizItems.length > prevQuizLen.current) {
      setRightTab('board')
    }
    prevQuizLen.current = quizItems.length
  }, [quizItems.length, role, setRightTab])

  const board = role ? BOARD[role] : null
  const BoardComp = board?.Comp

  return (
    <div className="flex h-full w-full flex-col">
      {/* Tab 栏 */}
      <div className="flex shrink-0 gap-1 border-b border-line px-3 pt-2.5">
        <button
          onClick={() => setRightTab('doc')}
          data-testid="tab-doc"
          className={cn(
            'relative flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-xs font-medium transition-colors',
            rightTab === 'doc' ? 'border-b-2 border-primary text-primary' : 'text-ink-mute hover:text-ink-soft',
          )}
        >
          <FileText size={13} />
          文档
          {/* 生成中呼吸点 / 完成未读点（v0.9.3 P0-A②）：访问文档 tab 后未读点自动清除 */}
          {generatingIds.length > 0 ? (
            <span
              data-testid="doc-tab-generating"
              title="正在生成文档"
              className="absolute right-0.5 top-0.5 flex h-1.5 w-1.5"
            >
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-mint" />
            </span>
          ) : unreadDocIds.length > 0 ? (
            <span
              data-testid="doc-tab-unread"
              title="有新生成的文档"
              className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-coral"
            />
          ) : null}
        </button>
        {board && BoardComp && (
          <button
            onClick={() => setRightTab('board')}
            data-testid="tab-board"
            className={cn(
              'flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-xs font-medium transition-colors',
              rightTab === 'board' ? 'border-b-2 border-primary text-primary' : 'text-ink-mute hover:text-ink-soft',
            )}
          >
            <Sparkles size={13} />
            {board.label}
          </button>
        )}
        <button
          onClick={() => setRightTab('flow')}
          data-testid="tab-flow"
          className={cn(
            'relative flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-xs font-medium transition-colors',
            rightTab === 'flow' ? 'border-b-2 border-primary text-primary' : 'text-ink-mute hover:text-ink-soft',
          )}
        >
          <Send size={13} />
          下发
          {/* 待回执角标（v0.9.2 P2-A）：局/校下发的任务有未处理回执时提醒；进入 tab 后隐藏（面板内已有「N 待处理」徽标） */}
          {pendingReceipts > 0 && rightTab !== 'flow' && (
            <span className="absolute -top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-coral px-1 text-[0.5625rem] font-bold text-white">
              {pendingReceipts > 9 ? '9+' : pendingReceipts}
            </span>
          )}
        </button>
      </div>

      {/* 内容 */}
      <div className="flex min-h-0 flex-1 flex-col">
        {rightTab === 'doc' ? (
          <ArtifactPanel />
        ) : rightTab === 'flow' ? (
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
