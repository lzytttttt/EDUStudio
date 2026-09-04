import { useRef, useState } from 'react'
import { SendHorizonal, Square, SlidersHorizontal, Plus, X, RotateCcw } from 'lucide-react'
import type { RoleId } from '../../harness/types'
import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useAuthStore } from '../../stores/authStore'
import { cn } from '../../lib/cn'

/** 角色场景快捷指令默认值（可被 preferences.scenes 覆盖，见 v0.3 专项 ③） */
export const SCENES: Record<RoleId, string[]> = {
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

const MAX_SCENES = 8

export default function ChatInput() {
  // 优先取当前会话角色；无会话（首次进入）时回退到登录角色，保证快捷指令始终可见
  const sessionRole = useChatStore((s) => s.sessions.find((x) => x.id === s.activeId)?.role)
  const authRole = useAuthStore((s) => s.role)
  const role = (sessionRole ?? authRole) as RoleId | undefined
  const { sendMessage, abort, streaming } = useChatStore()
  const preferences = useSettingsStore((s) => s.preferences)
  const updatePreferences = useSettingsStore((s) => s.updatePreferences)
  const [text, setText] = useState('')
  const [managing, setManaging] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const defaults = role ? SCENES[role] : []
  const custom = role ? preferences.scenes[role] : undefined
  const scenes = custom && custom.length > 0 ? custom : defaults

  const setScenes = (list: string[]) => {
    if (!role) return
    updatePreferences({ scenes: { ...preferences.scenes, [role]: list } })
  }

  const addScene = () => {
    const v = draft.trim()
    if (!v || scenes.length >= MAX_SCENES || scenes.includes(v)) return
    setScenes([...scenes, v])
    setDraft('')
  }

  const submit = () => {
    const value = text.trim()
    if (!value || streaming) return
    setText('')
    void sendMessage(value)
  }

  return (
    <div className="pb-safe border-t border-line bg-surface px-4 pb-4 pt-3">
      {/* 场景快捷 chips */}
      <div className="mb-2.5 flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none]">
        {role && scenes.map((s) => (
          <button
            key={s}
            onClick={() => { setText(s); inputRef.current?.focus() }}
            className="shrink-0 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-[11px] text-ink-soft transition-all hover:border-primary/50 hover:bg-primary-soft hover:text-primary"
          >
            {s}
          </button>
        ))}
        {role && (
          <button
            onClick={() => setManaging((v) => !v)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1.5 text-[11px] transition-all',
              managing
                ? 'border-primary/50 bg-primary-soft text-primary'
                : 'border-dashed border-line text-ink-mute hover:border-primary/50 hover:text-primary',
            )}
            aria-label="管理快捷指令"
          >
            <SlidersHorizontal size={11} />
            管理
          </button>
        )}
      </div>

      {/* 快捷指令管理面板 */}
      {managing && role && (
        <div className="animate-fade-up mb-2.5 rounded-2xl border border-line bg-surface-2 p-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold text-ink-soft">
              自定义快捷指令（{scenes.length}/{MAX_SCENES}）
            </p>
            {custom && custom.length > 0 && (
              <button
                onClick={() => updatePreferences({ scenes: { ...preferences.scenes, [role]: [] } })}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-ink-mute transition-colors hover:bg-surface hover:text-ink-soft"
              >
                <RotateCcw size={11} />
                恢复默认
              </button>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {scenes.map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-1 rounded-full border border-line bg-surface py-1 pl-2.5 pr-1 text-[11px] text-ink-soft"
              >
                {s}
                <button
                  onClick={() => setScenes(scenes.filter((x) => x !== s))}
                  className="flex h-4 w-4 items-center justify-center rounded-full text-ink-mute transition-colors hover:bg-danger/10 hover:text-danger"
                  aria-label={`删除「${s}」`}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
            {scenes.length === 0 && <p className="text-[11px] text-ink-mute">已清空，可添加常用指令或恢复默认</p>}
          </div>
          <div className="mt-2.5 flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  addScene()
                }
              }}
              maxLength={40}
              placeholder="输入常用指令，如「生成期中考试质量分析」"
              className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-1.5 text-[11px] text-ink outline-none transition-colors placeholder:text-ink-mute focus:border-primary"
            />
            <button
              onClick={addScene}
              disabled={!draft.trim() || scenes.length >= MAX_SCENES}
              className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-primary px-3 py-1.5 text-[11px] font-medium text-white transition-all hover:bg-primary-deep disabled:opacity-40"
            >
              <Plus size={11} />
              添加
            </button>
          </div>
        </div>
      )}

      <div className="flex items-end gap-2 rounded-3xl border border-line bg-surface-2 p-2 pl-4 transition-colors focus-within:border-primary/50">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          data-testid="chat-input"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          rows={1}
          placeholder={streaming ? 'Agent 执行中…' : '描述你的任务，Enter 发送，Shift+Enter 换行'}
          className="chat-input max-h-32 flex-1 resize-none bg-transparent py-2 leading-relaxed outline-none placeholder:text-ink-mute"
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
            data-testid="chat-send"
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
