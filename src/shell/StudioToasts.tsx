/**
 * v1.2 M2 · 统一轻提示层 StudioToasts（主 chunk，roadmap §2.3 F6 / §3.4 / §3.8）
 *
 * 位置与行为：
 * - 固定顶部居中（避开标题与移动端安全区），最多展示 `STUDIO_TOAST_MAX` 条；
 * - 数据唯一来源 `useUiStore.toasts`（pushToast 写入，ShellChrome 渲染本组件）；
 * - 同文案合并计数后 `text` 形如「已保存 ×2」，展示时拆成正文 + ×N 徽标（不重复读屏）；
 * - 容器 role=status / aria-live=polite：读屏只播报结果，不打断当前操作；
 * - 不持有状态、不写 store，关闭/自动消失全部由 store 负责。
 */
import { useUiStore, STUDIO_TOAST_MAX, splitToastText, type ToastKind } from '../stores/uiStore'
import { cn } from '../lib/cn'

/** 类别 → 视觉（复用既有 token：mint=成功 / coral=错误 / 中性=信息；不新增色相） */
const TONE: Record<ToastKind, { ring: string; dot: string }> = {
  info: { ring: 'border-line', dot: 'bg-ink-mute' },
  success: { ring: 'border-mint/40', dot: 'bg-mint' },
  error: { ring: 'border-coral/40', dot: 'bg-coral' },
}

export default function StudioToasts(): JSX.Element {
  const toasts = useUiStore((s) => s.toasts)

  return (
    /* 常驻 live region（空态也挂载）：读屏在 DOM 变化时稳定播报；高度为 0 不占位、不拦截点击 */
    <div
      data-testid="studio-toasts"
      role="status"
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-0 top-[4.75rem] z-[60] flex flex-col items-center gap-2 px-4"
    >
      {toasts.slice(-STUDIO_TOAST_MAX).map((toast) => {
        const { base, count } = splitToastText(toast.text)
        const tone = TONE[toast.kind]
        return (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto flex max-w-[min(92vw,26rem)] items-center gap-2 rounded-full border bg-surface/95 px-4 py-2 text-[0.75rem] font-medium text-ink shadow-card backdrop-blur',
              tone.ring,
            )}
          >
            <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tone.dot)} />
            <span className="truncate">{base}</span>
            {count > 1 && (
              <span aria-hidden className="shrink-0 text-[0.6875rem] font-semibold text-ink-soft">
                ×{count}
              </span>
            )}
            {/* 合并计数对读屏同样可见（视觉徽标 aria-hidden，避免重复报数） */}
            {count > 1 && <span className="sr-only">，共 {count} 次</span>}
          </div>
        )
      })}
    </div>
  )
}
