import { useState } from 'react'
import { X, Server, ShieldCheck, Trash2, PlugZap, Eye, EyeOff, Loader2, TriangleAlert } from 'lucide-react'
import { useSettingsStore, maskKey, type LLMSettings } from '../stores/settingsStore'
import { testLLMConnection } from '../harness/llm/adapter'
import { cn } from '../lib/cn'

type TestState = { status: 'idle' | 'testing' | 'ok' | 'fail'; message: string }

export default function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useSettingsStore()
  const { update, clearAllData } = settings
  const [draft, setDraft] = useState<LLMSettings>(() => ({
    mode: settings.mode,
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKey: settings.apiKey,
    proxyUrl: settings.proxyUrl,
  }))
  const [showKey, setShowKey] = useState(false)
  const [test, setTest] = useState<TestState>({ status: 'idle', message: '' })
  const [saved, setSaved] = useState(false)

  if (!open) return null

  const set = (patch: Partial<LLMSettings>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setSaved(false)
  }

  const save = () => {
    update(draft)
    setSaved(true)
  }

  const runTest = async () => {
    setTest({ status: 'testing', message: '' })
    const r = await testLLMConnection({
      baseUrl: draft.baseUrl,
      model: draft.model,
      apiKey: draft.apiKey,
      proxyUrl: draft.proxyUrl || undefined,
    })
    setTest({ status: r.ok ? 'ok' : 'fail', message: r.message })
  }

  const usingProxy = Boolean(draft.proxyUrl.trim())

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative max-h-[88vh] w-full max-w-md animate-fade-up overflow-y-auto rounded-3xl border border-line bg-surface p-6 shadow-pop">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">设置</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-mute hover:bg-surface-2"
            aria-label="关闭设置"
          >
            <X size={16} />
          </button>
        </div>

        {/* 模式（点击即切换，运行时生效） */}
        <div className="mt-5">
          <p className="text-xs font-semibold text-ink-soft">Harness 模式</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              onClick={() => set({ mode: 'mock' })}
              className={cn(
                'rounded-2xl border p-3.5 text-left transition-colors',
                draft.mode === 'mock' ? 'border-primary bg-primary-soft' : 'border-line bg-surface-2 opacity-70 hover:opacity-100',
              )}
            >
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck size={15} className={draft.mode === 'mock' ? 'text-primary' : 'text-ink-mute'} />
                Mock 剧本
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
                {draft.mode === 'mock' ? '当前生效 · 离线可演示' : '离线可演示，零成本'}
              </p>
            </button>
            <button
              onClick={() => set({ mode: 'api' })}
              className={cn(
                'rounded-2xl border p-3.5 text-left transition-colors',
                draft.mode === 'api' ? 'border-primary bg-primary-soft' : 'border-line bg-surface-2 opacity-70 hover:opacity-100',
              )}
            >
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Server size={15} className={draft.mode === 'api' ? 'text-primary' : 'text-ink-mute'} />
                DeepSeek API
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
                {draft.mode === 'api' ? '当前生效 · 真实模型' : '真实模型，失败自动回退 Mock'}
              </p>
            </button>
          </div>
        </div>

        {/* API 配置 */}
        <div className="mt-5 border-t border-line pt-4">
          <p className="text-xs font-semibold text-ink-soft">模型配置（OpenAI 兼容）</p>

          <label className="mt-3 block text-[11px] font-medium text-ink-soft">
            代理地址（可选，填入后 key 由代理保管）
            <input
              value={draft.proxyUrl}
              onChange={(e) => set({ proxyUrl: e.target.value })}
              placeholder="https://your-proxy.example.com/v1"
              className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-ink outline-none transition-colors placeholder:text-ink-mute focus:border-primary"
            />
          </label>

          <label className="mt-3 block text-[11px] font-medium text-ink-soft">
            API 直连 baseUrl
            <input
              value={draft.baseUrl}
              onChange={(e) => set({ baseUrl: e.target.value })}
              disabled={usingProxy}
              placeholder="https://api.deepseek.com/v1"
              className={cn(
                'mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-ink outline-none transition-colors placeholder:text-ink-mute focus:border-primary',
                usingProxy && 'cursor-not-allowed opacity-50',
              )}
            />
          </label>

          <label className="mt-3 block text-[11px] font-medium text-ink-soft">
            模型 ID
            <input
              value={draft.model}
              onChange={(e) => set({ model: e.target.value })}
              disabled={usingProxy}
              placeholder="deepseek-chat"
              className={cn(
                'mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-ink outline-none transition-colors placeholder:text-ink-mute focus:border-primary',
                usingProxy && 'cursor-not-allowed opacity-50',
              )}
            />
          </label>

          <label className="mt-3 block text-[11px] font-medium text-ink-soft">
            API Key {draft.apiKey && <span className="text-ink-mute">（{maskKey(draft.apiKey)}）</span>}
            <div className="relative mt-1">
              <input
                type={showKey ? 'text' : 'password'}
                value={draft.apiKey}
                onChange={(e) => set({ apiKey: e.target.value })}
                disabled={usingProxy}
                placeholder={usingProxy ? '由代理保管，无需填写' : 'sk-…'}
                className={cn(
                  'w-full rounded-xl border border-line bg-surface-2 px-3 py-2 pr-9 text-xs text-ink outline-none transition-colors placeholder:text-ink-mute focus:border-primary',
                  usingProxy && 'cursor-not-allowed opacity-50',
                )}
              />
              <button
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-mute hover:text-ink-soft"
                aria-label={showKey ? '隐藏 Key' : '显示 Key'}
                type="button"
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </label>

          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={runTest}
              disabled={test.status === 'testing'}
              className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-xs font-medium text-ink-soft transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
            >
              {test.status === 'testing' ? <Loader2 size={13} className="animate-spin" /> : <PlugZap size={13} />}
              测试连接
            </button>
            <button
              onClick={save}
              className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-medium text-white shadow-soft transition-all hover:bg-primary-deep active:scale-[0.98]"
            >
              保存配置
            </button>
            {saved && <span className="text-[11px] text-mint">已保存</span>}
          </div>
          {test.status !== 'idle' && test.status !== 'testing' && (
            <p className={cn('mt-2 text-[11px] leading-relaxed', test.status === 'ok' ? 'text-mint' : 'text-danger')}>
              {test.status === 'ok' ? '✓ ' : '✗ '}
              {test.message}
            </p>
          )}
          <p className="mt-2 flex items-start gap-1 text-[11px] leading-relaxed text-ink-mute">
            <TriangleAlert size={12} className="mt-0.5 shrink-0" />
            Key 仅存于浏览器 LocalStorage，生产环境请使用代理地址统一保管。
          </p>
        </div>

        {/* 数据 */}
        <div className="mt-5 border-t border-line pt-4">
          <p className="text-xs font-semibold text-ink-soft">本地数据</p>
          <p className="mt-1 text-[11px] text-ink-mute">会话、收藏、文档均存储于浏览器 LocalStorage（edustudio: 前缀）</p>
          <button
            onClick={clearAllData}
            className="mt-3 flex items-center gap-2 rounded-xl border border-danger/30 px-3.5 py-2 text-xs font-medium text-danger transition-colors hover:bg-danger/10"
          >
            <Trash2 size={13} />
            清空全部本地数据
          </button>
        </div>
      </div>
    </div>
  )
}
