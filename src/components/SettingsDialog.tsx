import { useState } from 'react'
import { X, Eye, EyeOff, RotateCcw, Trash2, User, Type } from 'lucide-react'
import { useSettingsStore, maskKey, clampPref, PREF_MAX_LEN, type FontSize } from '../stores/settingsStore'
import { cn } from '../lib/cn'
import { useDialogA11y } from '../lib/useDialogA11y'

const FONT_OPTIONS: { value: FontSize; label: string; sample: string }[] = [
  { value: 'small', label: '小', sample: 'A' },
  { value: 'medium', label: '标准', sample: 'A' },
  { value: 'large', label: '大', sample: 'A' },
  { value: 'xlarge', label: '超大', sample: 'A' },
]

const FONT_SAMPLE_SIZE: Record<FontSize, string> = {
  small: 'text-[13px]',
  medium: 'text-[15px]',
  large: 'text-[17px]',
  xlarge: 'text-[20px]',
}

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const s = useSettingsStore()
  const [showKey, setShowKey] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const dialogRef = useDialogA11y<HTMLDivElement>(true, onClose)

  const pref = s.preferences

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="animate-fade-up max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-line bg-surface p-6 shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">设置</h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-xl text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink" aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        {/* ── 偏好画像（注入 system prompt，API 模式生效） ── */}
        <section className="mb-6">
          <div className="mb-3 flex items-center gap-2">
            <User size={14} className="text-primary" />
            <h3 className="text-sm font-semibold text-ink">偏好画像</h3>
            <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] text-primary">API 模式生效</span>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-ink-mute">
            让 AI 记住你的称呼、背景与表达偏好，注入到每次对话的 system prompt（仅存本机，最长 {PREF_MAX_LEN} 字）。
          </p>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft">称呼</label>
              <input
                value={pref.nickname}
                onChange={(e) => s.updatePreferences({ nickname: clampPref(e.target.value) })}
                maxLength={PREF_MAX_LEN}
                placeholder="如：张老师"
                className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-mute focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft">学段学科背景</label>
              <input
                value={pref.stage}
                onChange={(e) => s.updatePreferences({ stage: clampPref(e.target.value) })}
                maxLength={PREF_MAX_LEN}
                placeholder="如：初中物理，带初三毕业班"
                className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-mute focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft">表达风格偏好</label>
              <input
                value={pref.style}
                onChange={(e) => s.updatePreferences({ style: clampPref(e.target.value) })}
                maxLength={PREF_MAX_LEN}
                placeholder="如：简洁务实，少用套话"
                className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-mute focus:border-primary"
              />
            </div>
          </div>
        </section>

        {/* ── 界面：字号 ── */}
        <section className="mb-6">
          <div className="mb-3 flex items-center gap-2">
            <Type size={14} className="text-primary" />
            <h3 className="text-sm font-semibold text-ink">界面字号</h3>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-ink-mute">
            调整对话与文档阅读区的字号，即时生效。超大档适合高龄用户：自动隐藏时间戳、来源等次要信息，聚焦核心内容。
          </p>
          <div className="flex gap-2">
            {FONT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => s.setFontSize(opt.value)}
                className={cn(
                  'flex flex-1 flex-col items-center gap-1 rounded-2xl border px-3 py-3 transition-all',
                  s.fontSize === opt.value
                    ? 'border-primary bg-primary-soft text-primary'
                    : 'border-line bg-surface-2 text-ink-soft hover:border-primary/40',
                )}
              >
                <span className={cn('font-semibold', FONT_SAMPLE_SIZE[opt.value])}>{opt.sample}</span>
                <span className="text-[11px]">{opt.label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* ── 模型接入 ── */}
        <section className="mb-6">
          <h3 className="mb-3 text-sm font-semibold text-ink">模型接入</h3>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <button
              onClick={() => s.update({ mode: 'mock' })}
              className={cn(
                'rounded-2xl border px-3 py-3 text-left transition-all',
                s.mode === 'mock' ? 'border-primary bg-primary-soft' : 'border-line bg-surface-2 hover:border-primary/40',
              )}
            >
              <p className={cn('text-sm font-medium', s.mode === 'mock' ? 'text-primary' : 'text-ink')}>演示模式</p>
              <p className="mt-0.5 text-[11px] text-ink-mute">内置剧本，无需联网</p>
            </button>
            <button
              onClick={() => s.update({ mode: 'api' })}
              className={cn(
                'rounded-2xl border px-3 py-3 text-left transition-all',
                s.mode === 'api' ? 'border-primary bg-primary-soft' : 'border-line bg-surface-2 hover:border-primary/40',
              )}
            >
              <p className={cn('text-sm font-medium', s.mode === 'api' ? 'text-primary' : 'text-ink')}>API 模式</p>
              <p className="mt-0.5 text-[11px] text-ink-mute">OpenAI 兼容接口</p>
            </button>
          </div>

          {s.mode === 'api' && (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-soft">接入方式</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => s.update({ proxyUrl: '' })}
                    className={cn(
                      'rounded-xl border px-3 py-2 text-xs transition-all',
                      !s.proxyUrl ? 'border-primary bg-primary-soft text-primary' : 'border-line bg-surface-2 text-ink-soft',
                    )}
                  >
                    浏览器直连
                  </button>
                  <button
                    onClick={() => s.update({ proxyUrl: s.proxyUrl || 'http://localhost:8787/api/llm' })}
                    className={cn(
                      'rounded-xl border px-3 py-2 text-xs transition-all',
                      s.proxyUrl ? 'border-primary bg-primary-soft text-primary' : 'border-line bg-surface-2 text-ink-soft',
                    )}
                  >
                    轻后端代理
                  </button>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-soft">{s.proxyUrl ? '代理地址' : 'Base URL'}</label>
                <input
                  value={s.proxyUrl || s.baseUrl}
                  onChange={(e) => s.update(s.proxyUrl ? { proxyUrl: e.target.value } : { baseUrl: e.target.value })}
                  placeholder={s.proxyUrl ? 'http://localhost:8787/api/llm' : 'https://api.deepseek.com/v1'}
                  className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-mute focus:border-primary"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-soft">模型 ID</label>
                <input
                  value={s.model}
                  onChange={(e) => s.update({ model: e.target.value })}
                  placeholder="deepseek-chat"
                  className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-mute focus:border-primary"
                />
              </div>
              {!s.proxyUrl && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-soft">API Key</label>
                  <div className="relative">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={s.apiKey}
                      onChange={(e) => s.update({ apiKey: e.target.value })}
                      placeholder="sk-..."
                      className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 pr-10 text-sm text-ink outline-none transition-colors placeholder:text-ink-mute focus:border-primary"
                    />
                    <button
                      onClick={() => setShowKey((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-mute transition-colors hover:text-ink-soft"
                      aria-label={showKey ? '隐藏' : '显示'}
                    >
                      {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  {s.apiKey && <p className="mt-1 text-[11px] text-ink-mute">已保存：{maskKey(s.apiKey)}</p>}
                </div>
              )}
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
                ⚠️ Key 仅存本机浏览器。生产环境请使用轻后端代理（proxy/ 目录），避免 Key 暴露。
              </p>
            </div>
          )}
        </section>

        {/* ── 数据 ── */}
        <section>
          <h3 className="mb-3 text-sm font-semibold text-ink">数据</h3>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => s.resetLLMSettings()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-ink-soft transition-colors hover:border-primary/40 hover:text-primary"
            >
              <RotateCcw size={12} />
              重置模型设置
            </button>
            <button
              onClick={() => {
                if (confirmClear) {
                  s.clearAllData()
                } else {
                  setConfirmClear(true)
                  setTimeout(() => setConfirmClear(false), 3000)
                }
              }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs transition-colors',
                confirmClear
                  ? 'border-danger bg-danger text-white'
                  : 'border-line bg-surface-2 text-ink-soft hover:border-danger/40 hover:text-danger',
              )}
            >
              <Trash2 size={12} />
              {confirmClear ? '确认清空？' : '清空全部数据'}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
