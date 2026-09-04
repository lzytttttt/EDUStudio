import { X, Server, ShieldCheck, Trash2 } from 'lucide-react'
import { useSettingsStore } from '../stores/settingsStore'
import { cn } from '../lib/cn'

export default function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { mode, clearAllData } = useSettingsStore()
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md animate-fade-up rounded-3xl border border-line bg-surface p-6 shadow-pop">
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

        {/* 模式 */}
        <div className="mt-5">
          <p className="text-xs font-semibold text-ink-soft">Harness 模式</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className={cn(
              'rounded-2xl border p-3.5',
              mode === 'mock' ? 'border-primary bg-primary-soft' : 'border-line bg-surface-2 opacity-70',
            )}>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck size={15} className={mode === 'mock' ? 'text-primary' : 'text-ink-mute'} />
                Mock 剧本
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
                {mode === 'mock' ? '当前生效 · 离线可演示' : '切换 ACTIVE_MODE 后生效'}
              </p>
            </div>
            <div className={cn(
              'rounded-2xl border p-3.5',
              mode === 'api' ? 'border-primary bg-primary-soft' : 'border-line bg-surface-2 opacity-70',
            )}>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Server size={15} className={mode === 'api' ? 'text-primary' : 'text-ink-mute'} />
                DeepSeek API
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
                待接入 · 实现 adapter 后一键切换
              </p>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-mute">
            业务代码只依赖 harness 契约，接入真实模型仅需实现 DeepSeekAdapter 并将 providerRegistry 的
            ACTIVE_MODE 改为 'api'。
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
