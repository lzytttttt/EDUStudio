/**
 * v1.2 M1 · 一句话委托输入条 IntentBar（主 chunk，roadmap §2.2 / §3.8）
 *
 * 全局唯一入口：提交只做三件事（§3.8 契约）——
 * 1) `submitIntent(text, 'inbox')` 写入主 chunk 的待消费槽 + 广播 `intent.submitted`；
 * 2) `navigateTo({ kind: 'inbox' })` 把用户带到战情台（执行反馈的落点）；
 * 3) 清空输入。
 *
 * 真正的拆解 / 执行由懒加载的 CommandCenter 消费（主 chunk 不 import Director 实现）；
 * 空文本不提交；非教师禁用（总指挥工作区教师专属，D14）。Enter 与按钮等价。
 */
import { useState } from 'react'
import { Send } from 'lucide-react'
import { submitIntent } from '../studio/intent'
import { navigateTo } from '../studio/router'
import { useAuthStore } from '../stores/authStore'
import { cn } from '../lib/cn'

const PLACEHOLDER = '一句话交给战队…'
const PLACEHOLDER_DISABLED = '总指挥工作区仅教师可用'

/** 单行输入的最小高度（移动端 44px 触控规范；桌面同高保持视觉一致） */
const CONTROL_H = 'h-11'

export default function IntentBar(): JSX.Element {
  const role = useAuthStore((s) => s.role)
  const canUse = role === 'teacher'
  const [text, setText] = useState('')
  const trimmed = text.trim()
  const canSubmit = canUse && trimmed.length > 0

  const submit = (): void => {
    if (!canSubmit) return
    submitIntent(trimmed, 'inbox')
    navigateTo({ kind: 'inbox' })
    setText('')
  }

  return (
    <form
      className="flex min-w-0 flex-1 items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <input
        data-testid="studio-intent-input"
        aria-label="一句话交给战队"
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={!canUse}
        placeholder={canUse ? PLACEHOLDER : PLACEHOLDER_DISABLED}
        enterKeyHint="send"
        autoComplete="off"
        className={cn(
          CONTROL_H,
          'min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-2.5 text-sm text-ink',
          'placeholder:text-ink-mute focus-visible:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45',
          'disabled:cursor-not-allowed disabled:opacity-50 md:px-3',
        )}
      />
      <button
        type="submit"
        data-testid="studio-intent-submit"
        aria-label="提交委托"
        title={canUse ? '交给战队（Enter）' : '总指挥工作区仅教师可用'}
        disabled={!canSubmit}
        className={cn(
          CONTROL_H,
          'inline-flex w-11 shrink-0 items-center justify-center gap-1 rounded-xl bg-primary text-sm font-medium text-white',
          'transition-colors hover:bg-primary-deep disabled:cursor-not-allowed disabled:opacity-40',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
          'md:w-auto md:px-3',
        )}
      >
        <Send size={16} aria-hidden />
        <span className="hidden md:inline">交给战队</span>
      </button>
    </form>
  )
}
