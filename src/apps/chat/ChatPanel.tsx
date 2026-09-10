import { useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, Zap, CheckCircle2, ArrowLeft, RotateCcw, AlertCircle, GraduationCap, Plus, FileText, X } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useChatStore } from '../../stores/chatStore'
import { useBriefingStore } from '../../stores/briefingStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUiStore } from '../../stores/uiStore'
import { useArtifactStore } from '../../stores/artifactStore'
import { DEFAULT_RIGHT_TAB, BOARD_LABEL } from '../../lib/rightPanel'
import { getRolePreset } from '../../harness/roles'
import AgentTraceView from './AgentTraceView'
import ChatInput from './ChatInput'
import DemoWizard from './DemoWizard'
import { cn } from '../../lib/cn'

const ROLE_CHIP = { teacher: 'bg-mint-soft text-mint', schoolAdmin: 'bg-primary-soft text-primary', bureau: 'bg-coral-soft text-coral' } as const

function EmptyState({ onStartDemo }: { onStartDemo: () => void }) {
  const role = useAuthStore((s) => s.role)
  const preset = role ? getRolePreset(role) : null
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-primary-soft text-primary">
        <Sparkles size={24} />
      </div>
      <h2 className="mt-4 text-lg font-bold">你好，{preset?.name ?? '朋友'}</h2>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-ink-soft">
        我是你的教育 AI 助手。描述一个目标，我会自动规划步骤、调用工具并产出文档。
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-1.5">
        {preset?.tools.map((t) => (
          <span key={t} className={cn('rounded-full px-2.5 py-1 text-[0.6875rem] font-medium', ROLE_CHIP[role ?? 'teacher'])}>
            {t}
          </span>
        ))}
      </div>
      <button
        data-testid="demo-entry"
        onClick={onStartDemo}
        className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary-soft px-4 py-2 text-xs font-medium text-primary shadow-soft transition-all hover:shadow-pop active:scale-95"
      >
        <GraduationCap size={14} />
        自进化演示 · 三分钟看懂技能沉淀与复用
      </button>
    </div>
  )
}

/** 任务完成后的返回简报快捷卡片：提示剩余卡片数，一键回到简报流 */
function BackToBriefingCard() {
  const setStage = useAuthStore((s) => s.setStage)
  const cards = useBriefingStore((s) => s.cards)
  const decisions = useBriefingStore((s) => s.decisions)
  const remaining = cards.filter((c) => !decisions[c.id]).length
  const hint =
    cards.length === 0
      ? '回到今日简报，继续处理待办卡片'
      : remaining > 0
        ? `今日简报还有 ${remaining} 张卡片待处理`
        : '今日简报已全部处理完毕'
  return (
    <div className="animate-fade-up flex items-center justify-between gap-3 rounded-2xl border border-mint/25 bg-mint-soft px-4 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <CheckCircle2 size={16} className="shrink-0 text-mint" />
        <p className="truncate text-xs text-ink-soft">
          <span className="font-semibold text-ink">本任务已完成</span>
          <span className="minor-info">
            <span className="mx-1.5 text-ink-mute">·</span>
            {hint}
          </span>
        </p>
      </div>
      <button
        onClick={() => setStage('briefing')}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface px-3.5 py-1.5 text-xs font-medium text-primary shadow-soft transition-all hover:shadow-pop active:scale-95"
      >
        <ArrowLeft size={13} />
        返回简报
      </button>
    </div>
  )
}

export default function ChatPanel() {
  /* 字段选择器订阅（v0.9.3 P0-D③）：后台任务 / 其它会话的变化不再连带中栏整块重渲染，
     只有「当前会话」的内容推进（本会话流式）才更新 */
  const activeId = useChatStore((s) => s.activeId)
  const session = useChatStore((s) => s.sessions.find((x) => x.id === s.activeId))
  const streaming = useChatStore((s) => s.streaming)
  const retry = useChatStore((s) => s.retry)
  const newSession = useChatStore((s) => s.newSession)
  /* Mock 边界标识（v0.9 M4③）：运行时读取 mode，切换即时生效；API 模式零打扰 */
  const mode = useSettingsStore((s) => s.mode)
  const [demoOpen, setDemoOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  /** 是否跟随新内容（贴近底部为跟随，用户上滑查看历史则不打扰） */
  const stickRef = useRef(true)
  const entries = session?.entries ?? []
  const lastEntry = entries[entries.length - 1]
  /* 任务完成态：非流式中、已有对话、最后一条 assistant 已输出完毕 */
  const taskDone = !streaming && entries.length > 0 && lastEntry?.role === 'assistant' && !lastEntry.streaming
  /* 头部仪表盘用：提前取出角色，避免 JSX 闭包内失去 narrowing */
  const headerRole = session?.role

  /* 回退路径（v0.9.3 P0-A③）：文档占位自动切「文档」后，中栏常驻一条可收起的轻提示，
   * 一键回到角色主工作台；仅在生成中显示，不弹窗、不打断流式 */
  const rightTab = useUiStore((s) => s.rightTab)
  const setRightTab = useUiStore((s) => s.setRightTab)
  const docNoticeDismissed = useUiStore((s) => s.docNoticeDismissed)
  const dismissDocNotice = useUiStore((s) => s.dismissDocNotice)
  const generatingIds = useArtifactStore((s) => s.generatingIds)
  const docFocusNotice =
    generatingIds.length > 0 && rightTab === 'doc' && !docNoticeDismissed && !!headerRole && DEFAULT_RIGHT_TAB[headerRole] !== 'doc'
  const backToBoard = () => {
    if (headerRole) setRightTab(DEFAULT_RIGHT_TAB[headerRole])
    dismissDocNotice()
  }

  /* 头部仪表盘（v0.9.2 P1-B）：从 trace 实时计算步骤进度与并行组数——
   * 总步数取「plan 步骤数」与「tool_call 数」的较大者（无 plan 事件时仍有进度），
   * 已完成步数 = tool_result 数，并行组数 = group 字段去重。 */
  const progress = useMemo(() => {
    let totalSteps = 0
    let doneSteps = 0
    let toolCalls = 0
    const groups = new Set<string>()
    for (const e of entries) {
      for (const ev of e.trace) {
        if (ev.kind === 'plan') totalSteps = Math.max(totalSteps, ev.steps.length)
        else if (ev.kind === 'tool_call') toolCalls += 1
        else if (ev.kind === 'tool_result') doneSteps += 1
        if ((ev.kind === 'tool_call' || ev.kind === 'tool_result') && ev.group) groups.add(ev.group)
      }
    }
    return { totalSteps: Math.max(totalSteps, toolCalls), doneSteps, groups: groups.size }
  }, [entries])

  /* 滚动策略（v0.9.3 P0-D④）：仅在用户贴近底部时跟随，且不用 smooth——
     平滑动画在高频流式下会与内容互相追赶，反而抖；用户上滑回看历史时完全不动 */
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 56
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // 切换会话：重置为跟随并直接落底（不带历史偏移）
  useEffect(() => {
    stickRef.current = true
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [activeId])

  useEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [session?.entries])

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* 头部（v0.9.2 P1-B）：任务状态仪表盘——一眼看清「这是谁的任务、跑到哪一步」 */}
      {session && headerRole && (
        <header className="hidden items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3 md:flex">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2.5">
              <h1 className="truncate text-sm font-semibold">{session.title}</h1>
              <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[0.625rem] font-medium', ROLE_CHIP[headerRole])}>
                {getRolePreset(headerRole).name}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              {streaming ? (
                <>
                  <span className="flex items-center gap-1.5 text-[0.6875rem] font-medium text-mint">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-mint" />
                    </span>
                    执行中
                    {progress.totalSteps > 0 && (
                      <span>
                        {' '}
                        · 第 {Math.min(progress.doneSteps, progress.totalSteps)}/{progress.totalSteps} 步
                      </span>
                    )}
                    <Zap size={10} className="text-amber" />
                  </span>
                  {progress.groups > 0 && (
                    <span className="rounded-md bg-amber-soft px-1.5 py-0.5 text-[0.5625rem] font-semibold text-amber">
                      并行 {progress.groups} 组
                    </span>
                  )}
                </>
              ) : (
                <span className="minor-info flex items-center gap-1.5 text-[0.6875rem] text-ink-mute">
                  <span className="h-1.5 w-1.5 rounded-full bg-line" />
                  空闲
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* 自进化演示常驻入口（v0.9.3 P1-A③）：非空会话也能随时开演，不必先清空会话 */}
            <button
              data-testid="demo-entry-top"
              onClick={() => setDemoOpen(true)}
              title="自进化演示：三分钟看懂技能沉淀与复用"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <GraduationCap size={13} />
              自进化演示
            </button>
            {/* 新建任务快捷入口（v0.9.2 P1-B）：复用 newSession，与 Sidebar 主按钮同族样式 */}
            <button
              onClick={() => newSession(headerRole)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-medium text-white shadow-soft transition-all hover:bg-primary-deep hover:shadow-pop active:scale-95"
            >
              <Plus size={13} />
              新建任务
            </button>
          </div>
        </header>
      )}

      {/* 回退轻提示（v0.9.3 P0-A③）：自动切「文档」后仍可一键回到角色主工作台 */}
      {docFocusNotice && headerRole && (
        <div
          data-testid="doc-focus-notice"
          className="flex shrink-0 items-center gap-2 border-b border-line bg-primary-soft/60 px-4 py-1.5 md:px-5"
        >
          <FileText size={12} className="shrink-0 text-primary" />
          <p className="min-w-0 flex-1 truncate text-[0.6875rem] text-ink-soft">
            文档已切到右栏逐字生成，可边看边改
          </p>
          <button
            onClick={backToBoard}
            data-testid="doc-focus-back"
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-[0.625rem] font-medium text-primary shadow-soft transition-all hover:shadow-pop active:scale-95"
          >
            <ArrowLeft size={10} />
            返回{BOARD_LABEL[headerRole]}
          </button>
          <button
            onClick={dismissDocNotice}
            data-testid="doc-focus-dismiss"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink"
            aria-label="收起提示"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* 消息流（v0.4 M4②：content-visibility 原生虚拟化，长会话跳过屏外渲染） */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
        {!session || session.entries.length === 0 ? (
          <EmptyState onStartDemo={() => setDemoOpen(true)} />
        ) : (
          <div className="mx-auto max-w-2xl space-y-5">
            {session.entries.map((entry) =>
              entry.role === 'user' ? (
                <div key={entry.id} className="cv-msg animate-fade-up flex justify-end">
                  <div className="chat-bubble max-w-[85%] rounded-3xl rounded-br-lg bg-primary px-4.5 px-4 py-2.5 leading-relaxed text-white shadow-soft">
                    {entry.content}
                  </div>
                </div>
              ) : (
                <div key={entry.id} className="cv-msg animate-fade-up">
                  <AgentTraceView trace={entry.trace} streaming={!!entry.streaming} />
                  {entry.content && (
                    <div className="chat-bubble rounded-3xl rounded-bl-lg border border-line bg-surface px-4 py-3 leading-relaxed shadow-soft-next shadow-soft">
                      <p className="whitespace-pre-wrap">
                        {entry.content}
                        {entry.streaming && <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-primary align-middle" />}
                      </p>
                    </div>
                  )}
                  {/* Mock 边界标识（v0.9 M4①）：演示模式 assistant 消息 meta 区低调标注，样式对齐数据来源标注 */}
                  {mode === 'mock' && !entry.streaming && entry.content && (
                    <p className="minor-info mt-1.5 flex items-center gap-1.5 text-[0.625rem] text-ink-mute">
                      <span className="rounded-full bg-surface-2 px-1.5 py-0.5 font-medium">演示</span>
                      演示剧本生成，非真实模型产出
                    </p>
                  )}
                  {/* 失败重试（v0.4 M1④）：断点重试，按原目标重新执行 */}
                  {!entry.streaming && entry.error && (
                    <div className="mt-2 flex items-center gap-2.5 rounded-2xl border border-danger/25 bg-danger/5 px-4 py-2.5">
                      <AlertCircle size={14} className="shrink-0 text-danger" />
                      <p className="min-w-0 flex-1 truncate text-xs text-ink-soft">执行中断，可从断点重试</p>
                      <button
                        onClick={() => void retry(entry.id)}
                        disabled={streaming}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs font-medium text-danger shadow-soft transition-all hover:shadow-pop active:scale-95 disabled:opacity-40"
                      >
                        <RotateCcw size={12} />
                        重试
                      </button>
                    </div>
                  )}
                </div>
              ),
            )}
            {taskDone && <BackToBriefingCard />}
            <div />
          </div>
        )}
      </div>

      <ChatInput />
      {demoOpen && <DemoWizard onClose={() => setDemoOpen(false)} />}
    </div>
  )
}
