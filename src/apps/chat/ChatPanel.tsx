import { useEffect, useRef } from 'react'
import { Sparkles, Zap, CheckCircle2, ArrowLeft } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useChatStore } from '../../stores/chatStore'
import { useBriefingStore } from '../../stores/briefingStore'
import { getRolePreset } from '../../harness/roles'
import AgentTraceView from './AgentTraceView'
import ChatInput from './ChatInput'
import { cn } from '../../lib/cn'

const ROLE_CHIP = { teacher: 'bg-mint-soft text-mint', schoolAdmin: 'bg-primary-soft text-primary', bureau: 'bg-coral-soft text-coral' } as const

function EmptyState() {
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
          <span key={t} className={cn('rounded-full px-2.5 py-1 text-[11px] font-medium', ROLE_CHIP[role ?? 'teacher'])}>
            {t}
          </span>
        ))}
      </div>
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
          <span className="mx-1.5 text-ink-mute">·</span>
          {hint}
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
  const { sessions, activeId, streaming } = useChatStore()
  const session = sessions.find((s) => s.id === activeId)
  const bottomRef = useRef<HTMLDivElement>(null)
  const entries = session?.entries ?? []
  const lastEntry = entries[entries.length - 1]
  /* 任务完成态：非流式中、已有对话、最后一条 assistant 已输出完毕 */
  const taskDone = !streaming && entries.length > 0 && lastEntry?.role === 'assistant' && !lastEntry.streaming

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [session?.entries])

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* 头部 */}
      {session && (
        <header className="hidden items-center justify-between border-b border-line bg-surface px-5 py-3 md:flex">
          <div className="flex min-w-0 items-center gap-2.5">
            <h1 className="truncate text-sm font-semibold">{session.title}</h1>
            {session.role && (
              <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium', ROLE_CHIP[session.role])}>
                {getRolePreset(session.role).name}
              </span>
            )}
          </div>
          {streaming && (
            <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-primary">
              <Zap size={12} className="animate-pulse" />
              Agent 执行中
            </span>
          )}
        </header>
      )}

      {/* 消息流 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
        {!session || session.entries.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="mx-auto max-w-2xl space-y-5">
            {session.entries.map((entry) =>
              entry.role === 'user' ? (
                <div key={entry.id} className="animate-fade-up flex justify-end">
                  <div className="max-w-[85%] rounded-3xl rounded-br-lg bg-primary px-4.5 px-4 py-2.5 text-sm leading-relaxed text-white shadow-soft">
                    {entry.content}
                  </div>
                </div>
              ) : (
                <div key={entry.id} className="animate-fade-up">
                  <AgentTraceView trace={entry.trace} streaming={!!entry.streaming} />
                  {entry.content && (
                    <div className="rounded-3xl rounded-bl-lg border border-line bg-surface px-4 py-3 text-sm leading-relaxed shadow-soft-next shadow-soft">
                      <p className="whitespace-pre-wrap">
                        {entry.content}
                        {entry.streaming && <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-primary align-middle" />}
                      </p>
                    </div>
                  )}
                </div>
              ),
            )}
            {taskDone && <BackToBriefingCard />}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <ChatInput />
    </div>
  )
}
