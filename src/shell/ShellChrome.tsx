/**
 * v1.2 M1 · 统一顶栏 ShellChrome（主 chunk，roadmap §2.2 / §3.3 / §3.8）
 *
 * 顶栏五件事：品牌 · 工作区切换 · 一句话输入 · 通知/设置 · 身份与退出。
 * 两个工作区共用同一个顶栏（旧 Director 自绘顶栏与 AppShell 移动顶栏在新壳下不再出现）。
 *
 * 通知面板归属：经典工作区且非简报时 `AppShell` 自己会渲染 NotificationPanel（它监听同一个
 * panelOpen），本文件此时只负责「开面板」不再重复渲染，避免同屏两套；总指挥工作区 / 简报页
 * 由本文件渲染。
 */
import { useState } from 'react'
import { Bell, LogOut, Settings } from 'lucide-react'
import { BRAND_ART } from '../theme/art'
import { useAuthStore } from '../stores/authStore'
import { useNotificationStore, unreadCount } from '../stores/notificationStore'
import { useRouteStore } from '../stores/routeStore'
import { getRolePreset } from '../harness/roles'
import SettingsDialog from '../components/SettingsDialog'
import NotificationPanel from './NotificationPanel'
import WorkspaceSwitcher from './WorkspaceSwitcher'
import IntentBar from './IntentBar'
import { cn } from '../lib/cn'

/** 顶栏图标动作：移动端 44px 触控、桌面同样 44px（新交互 min-h-[44px] 规范） */
const ICON_BTN =
  'relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-mute transition-colors ' +
  'hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

export default function ShellChrome(): JSX.Element {
  const role = useAuthStore((s) => s.role)
  const logout = useAuthStore((s) => s.logout)
  const route = useRouteStore((s) => s.route)
  const unread = useNotificationStore((s) => unreadCount(s.items))
  const panelOpen = useNotificationStore((s) => s.panelOpen)
  const openPanel = useNotificationStore((s) => s.openPanel)
  const closePanel = useNotificationStore((s) => s.closePanel)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const preset = role ? getRolePreset(role) : null
  /** 与 ShellLayout 的 workspace 口径一致：非教师恒为经典 */
  const workspace = role === 'teacher' ? route.workspace : 'classic'
  /** 经典工作区 + 非简报时 AppShell 在页面内，它自己渲染通知面板（二者共享 panelOpen） */
  const appShellOwnsPanel = workspace === 'classic' && route.target?.kind !== 'briefing'

  return (
    <>
      <header
        data-testid="studio-shell-topbar"
        className="relative z-30 flex h-12 shrink-0 items-center gap-1.5 border-b border-line bg-surface px-2 md:h-auto md:gap-3 md:px-4 md:py-2.5"
      >
        {/* 品牌：只复用既有 BRAND_ART，不新增品牌色 */}
        <div className="flex shrink-0 items-center gap-2">
          <img src={BRAND_ART.markColor} alt="" className="h-6 w-6 object-contain md:h-7 md:w-7" />
          <span className="hidden text-sm font-bold tracking-tight text-ink md:inline">智教工坊</span>
        </div>

        <WorkspaceSwitcher />
        <IntentBar />

        <div className="flex shrink-0 items-center gap-0.5">
          {/* 通知中心：总指挥工作区 / 简报页由本文件渲染面板，经典工作台复用它自己的面板 */}
          <button
            type="button"
            data-testid="studio-notifications"
            onClick={openPanel}
            aria-label="通知中心"
            aria-haspopup="dialog"
            aria-expanded={panelOpen}
            title="通知中心"
            className={ICON_BTN}
          >
            <Bell size={18} aria-hidden />
            {unread > 0 && (
              <span
                aria-hidden
                className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-coral px-1 text-[0.5625rem] font-bold text-white"
              >
                {unread > 9 ? '9+' : unread}
              </span>
            )}
            {unread > 0 && <span className="sr-only">，{unread} 条未读</span>}
          </button>

          <button
            type="button"
            data-testid="studio-settings"
            onClick={() => setSettingsOpen(true)}
            aria-label="设置"
            title="设置"
            className={cn(ICON_BTN, 'hidden sm:flex')}
          >
            <Settings size={18} aria-hidden />
          </button>

          {preset && (
            <span
              data-testid="studio-role"
              title={`当前身份：${preset.name}`}
              className="hidden max-w-[6rem] truncate px-1 text-xs font-medium text-ink-soft md:inline"
            >
              {preset.name}
            </span>
          )}

          <button
            type="button"
            data-testid="studio-logout"
            onClick={logout}
            aria-label="退出登录"
            title="退出登录"
            className={ICON_BTN}
          >
            <LogOut size={18} aria-hidden />
          </button>
        </div>
      </header>

      {/* 通知中心（复用旧面板；position 由面板自身的 absolute inset-0 承担） */}
      {panelOpen && !appShellOwnsPanel && <NotificationPanel onClose={closePanel} />}

      {/* 设置（复用旧弹窗） */}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </>
  )
}
