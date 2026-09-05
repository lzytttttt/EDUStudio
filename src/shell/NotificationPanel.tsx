import { Bell, BellOff, CheckCheck, FileText, Send, Trash2, X, Info } from 'lucide-react'
import { useNotificationStore, unreadCount, type NotifItem } from '../stores/notificationStore'
import { useAuthStore } from '../stores/authStore'
import { useArtifactStore } from '../stores/artifactStore'
import { t } from '../lib/i18n'
import { cn } from '../lib/cn'

const KIND_META: Record<NotifItem['kind'], { icon: typeof Bell; style: string }> = {
  annotation: { icon: FileText, style: 'bg-primary-soft text-primary' },
  receipt: { icon: Send, style: 'bg-mint-soft text-mint' },
  task: { icon: Send, style: 'bg-amber-soft text-amber-600' },
  system: { icon: Info, style: 'bg-surface-2 text-ink-mute' },
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 通知中心面板（v0.5 M2④）：铃铛入口，点击条目跳转文档/看板 */
export default function NotificationPanel({ onClose }: { onClose: () => void }) {
  const items = useNotificationStore((s) => s.items)
  const markRead = useNotificationStore((s) => s.markRead)
  const markAllRead = useNotificationStore((s) => s.markAllRead)
  const clear = useNotificationStore((s) => s.clear)
  const setStage = useAuthStore((s) => s.setStage)
  const setActiveDoc = useArtifactStore((s) => s.setActive)

  const unread = unreadCount(items)

  const open = (n: NotifItem) => {
    markRead(n.id)
    if (n.docId) {
      setActiveDoc(n.docId)
      setStage('workbench')
    } else if (n.flowId) {
      setStage('workbench')
    }
    onClose()
  }

  return (
    <div className="absolute inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="animate-fade-up mt-16 flex max-h-[70%] w-full max-w-md flex-col rounded-3xl border border-line bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Bell size={14} className="text-primary" />
            {t('notif.title')}
            {unread > 0 && (
              <span className="rounded-full bg-coral-soft px-2 py-0.5 text-[10px] font-medium text-coral">
                {t('notif.unread', { count: unread })}
              </span>
            )}
          </h3>
          <div className="flex items-center gap-0.5">
            <button
              onClick={markAllRead}
              disabled={unread === 0}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-30"
              title={t('notif.markAll')}
              aria-label={t('notif.markAll')}
            >
              <CheckCheck size={14} />
            </button>
            <button
              onClick={clear}
              disabled={items.length === 0}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-mute transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-30"
              title={t('notif.clear')}
              aria-label={t('notif.clear')}
            >
              <Trash2 size={14} />
            </button>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink"
              aria-label={t('notif.close')}
            >
              <X size={14} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
          {items.length === 0 && (
            <p className="flex flex-col items-center gap-2 px-2 py-10 text-center text-xs text-ink-mute">
              <BellOff size={20} />
              {t('notif.empty')}
              <span className="text-[10px] leading-relaxed">{t('notif.emptyHint')}</span>
            </p>
          )}
          {items.map((n) => {
            const meta = KIND_META[n.kind]
            const Icon = meta.icon
            return (
              <button
                key={n.id}
                onClick={() => open(n)}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-2xl border px-3 py-2.5 text-left transition-colors',
                  n.read ? 'border-line bg-surface hover:bg-surface-2' : 'border-primary/30 bg-primary-soft/40 hover:bg-primary-soft',
                )}
              >
                <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl', meta.style)}>
                  <Icon size={13} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-ink">{n.title}</p>
                  {n.body && <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-ink-mute">{n.body}</p>}
                  <p className="minor-info mt-0.5 text-[10px] text-ink-mute">
                    {t(`notif.kind.${n.kind}` as const)} · {fmtTime(n.createdAt)}
                  </p>
                </div>
                {!n.read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-coral" />}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
