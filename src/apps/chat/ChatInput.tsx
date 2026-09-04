import { useRef, useState } from 'react'
import { SendHorizonal, Square } from 'lucide-react'
import type { RoleId } from '../../harness/types'
import { useChatStore } from '../../stores/chatStore'
import { cn } from '../../lib/cn'

/** 角色场景快捷指令 */
const SCENES: Record<RoleId, string[]> = {
  teacher: [
    '备一节《摩擦力》公开课教案',
    '针对高一（3）班函数单调性薄弱点出分层练习',
    '生成家长会讲稿',
  ],
  schoolAdmin: [
    '生成本月学校治理简报',
    '起草高一（7）班物理帮扶方案',
    '汇总本月评课分析',
  ],
  bureau: [
    '起草本季度区域教学质量分析报告',
    '起草学生体质健康专项督导通知',
    '汇总各校 AI 试点申报并生成评审意见',
  ],
}

export default function ChatInput() {
  const role = useChatStore((s) => s.sessions.find((x) => x.id === s.activeId)?.role)
  const { sendMessage, abort, streaming } = useChatStore()
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const submit = () => {
    const value = text.trim()
    if (!value || streaming) return
    setText('')
    void sendMessage(value)
  }

  return (
    <div className="border-t border-line bg-surface px-4 pb-4 pt-3">
      {/* 场景快捷 chips */}
      <div className="mb-2.5 flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none]">
        {role && SCENES[role].map((s) => (
          <button
            key={s}
            onClick={() => { setText(s); inputRef.current?.focus() }}
            className="shrink-0 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-[11px] text-ink-soft transition-all hover:border-primary/50 hover:bg-primary-soft hover:text-primary"
          >
            {s}
          </button>
        ))}
      </div>
      <div className="flex items-end gap-2 rounded-3xl border border-line bg-surface-2 p-2 pl-4 transition-colors focus-within:border-primary/50">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          rows={1}
          placeholder={streaming ? 'Agent 执行中…' : '描述你的任务，Enter 发送，Shift+Enter 换行'}
          className="max-h-32 flex-1 resize-none bg-transparent py-2 text-sm leading-relaxed outline-none placeholder:text-ink-mute"
        />
        {streaming ? (
          <button
            onClick={abort}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-danger text-white transition-all hover:opacity-90 active:scale-95"
            aria-label="停止"
          >
            <Square size={15} />
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!text.trim()}
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl transition-all active:scale-95',
              text.trim() ? 'bg-primary text-white hover:bg-primary-deep' : 'bg-line text-ink-mute',
            )}
            aria-label="发送"
          >
            <SendHorizonal size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
