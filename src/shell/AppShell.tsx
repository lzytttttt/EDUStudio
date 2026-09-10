import { useState } from 'react'
import { LayoutList, MessageSquare, FileText, X, ArrowLeft } from 'lucide-react'
import Sidebar from './Sidebar'
import ChatPanel from '../apps/chat/ChatPanel'
import RightPanel from './RightPanel'
import NotificationPanel from './NotificationPanel'
import GuideDialog from '../components/GuideDialog'
import Resizer from './Resizer'
import { useAuthStore } from '../stores/authStore'
import { useArtifactStore } from '../stores/artifactStore'
import { useSettingsStore, DEFAULT_COLUMN_WIDTHS, clampColumnWidth, flushSettingsPersist } from '../stores/settingsStore'
import { useNotificationStore, unreadCount } from '../stores/notificationStore'
import { t } from '../lib/i18n'
import { cn } from '../lib/cn'

/** 三栏工作台外壳：<xl 右栏折叠为抽屉，<md 左栏折叠为抽屉 + 底部标签（v0.5 M4②）；
 *  桌面端左右栏宽度可拖拽调整（v0.6 M4②），分隔条承担边线视觉 */
export default function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [artifactOpen, setArtifactOpen] = useState(false)
  const setStage = useAuthStore((s) => s.setStage)
  // 首次进入工作台：自动弹出操作说明（v0.3 UI 专项）
  const guideSeen = useSettingsStore((s) => s.guideSeen)
  const markGuideSeen = useSettingsStore((s) => s.markGuideSeen)
  const [guideOpen, setGuideOpen] = useState(!guideSeen)
  // 三栏栏宽（v0.6 M4②）
  const columnWidths = useSettingsStore((s) => s.columnWidths)
  const setColumnWidth = useSettingsStore((s) => s.setColumnWidth)
  // 通知中心（v0.5 M2④）
  const panelOpen = useNotificationStore((s) => s.panelOpen)
  const closePanel = useNotificationStore((s) => s.closePanel)
  const notifItems = useNotificationStore((s) => s.items)
  const unread = unreadCount(notifItems)
  /* 文档生成中 / 未读（v0.9.3 P0-A②）：窄屏抽屉入口同款角标，避免文档产出被抽屉深藏 */
  const docGenerating = useArtifactStore((s) => s.generatingIds.length > 0)
  const docUnread = useArtifactStore((s) => s.unreadDocIds.length > 0)

  return (
    <div className="flex h-full overflow-hidden bg-bg">
      {/* 左栏：桌面常驻（宽度可拖拽）/ 移动抽屉 */}
      <aside
        style={{ width: columnWidths.left }}
        className="hidden md:flex shrink-0 bg-surface"
      >
        <Sidebar onNavigate={() => setSidebarOpen(false)} />
      </aside>
      <Resizer
        at="md"
        label="调整任务栏宽度"
        onMove={(x) => setColumnWidth('left', clampColumnWidth('left', x))}
        onReset={() => setColumnWidth('left', DEFAULT_COLUMN_WIDTHS.left)}
        onEnd={flushSettingsPersist}
      />
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-ink/30 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 animate-slide-in-right border-r border-line bg-surface">
            <Sidebar onNavigate={() => setSidebarOpen(false)} />
          </aside>
        </div>
      )}

      {/* 中栏：对话流（移动端为底部标签栏 + iOS 安全区让位，v0.6.1 修复输入框被遮挡） */}
      <main className="relative flex min-w-0 flex-1 flex-col pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] md:pb-0">
        {/* 移动端顶栏：返回简报明确入口（v0.9 M5④，原品牌文字按钮可发现性弱） */}
        <div className="flex items-center border-b border-line bg-surface px-3 py-2 md:hidden">
          <button
            onClick={() => setStage('briefing')}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-2"
            title="返回今日简报"
          >
            <ArrowLeft size={16} />
            简报
          </button>
        </div>
        <ChatPanel />
      </main>

      {/* 右栏：文档 + 角色增强面板，桌面常驻（宽度可拖拽）/ 窄屏抽屉 */}
      <Resizer
        at="xl"
        label="调整文档栏宽度"
        onMove={(x) => setColumnWidth('right', clampColumnWidth('right', window.innerWidth - x))}
        onReset={() => setColumnWidth('right', DEFAULT_COLUMN_WIDTHS.right)}
        onEnd={flushSettingsPersist}
      />
      <aside
        style={{ width: columnWidths.right }}
        className="hidden xl:flex shrink-0 bg-surface"
      >
        <RightPanel variant="desktop" />
      </aside>
      {artifactOpen && (
        <div className="fixed inset-0 z-40 xl:hidden">
          <div className="absolute inset-0 bg-ink/30 backdrop-blur-sm" onClick={() => setArtifactOpen(false)} />
          <aside className="absolute inset-y-0 right-0 flex w-[min(92vw,420px)] animate-slide-in-right border-l border-line bg-surface">
            <div className="flex w-full flex-col">
              <button
                onClick={() => setArtifactOpen(false)}
                className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-ink-mute hover:bg-surface-2"
                aria-label="关闭"
              >
                <X size={16} />
              </button>
              <RightPanel variant="drawer" />
            </div>
          </aside>
        </div>
      )}

      {/* 移动端底部标签（v0.5 M4②）：列表 / 会话 / 文档；含 iOS 安全区避让（v0.6.1） */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <button
          onClick={() => setSidebarOpen(true)}
          className="relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.625rem] text-ink-soft transition-colors hover:text-ink"
          aria-label="打开任务列表"
        >
          <LayoutList size={18} />
          {t('nav.list')}
          {unread > 0 && <span className="absolute right-1/4 top-1.5 h-2 w-2 rounded-full bg-coral" />}
        </button>
        <button
          onClick={() => {
            setSidebarOpen(false)
            setArtifactOpen(false)
          }}
          className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.625rem] text-primary"
          aria-label="回到会话"
        >
          <MessageSquare size={18} />
          {t('nav.chat')}
        </button>
        <button
          onClick={() => setArtifactOpen(true)}
          className="relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.625rem] text-ink-soft transition-colors hover:text-ink"
          aria-label="打开文档面板"
        >
          <FileText size={18} />
          {t('nav.docs')}
          {/* 生成中呼吸点 / 未读点（v0.9.3 P0-A②）：与右栏「文档」tab 同口径 */}
          {docGenerating ? (
            <span data-testid="nav-doc-generating" className="absolute right-1/4 top-1.5 flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-mint" />
            </span>
          ) : docUnread ? (
            <span data-testid="nav-doc-unread" className="absolute right-1/4 top-1.5 h-2 w-2 rounded-full bg-coral" />
          ) : null}
        </button>
      </nav>

      {/* 通知中心（v0.5 M2④） */}
      {panelOpen && <NotificationPanel onClose={closePanel} />}

      {/* 首次进入操作说明 */}
      {guideOpen && (
        <GuideDialog
          stage="workbench"
          onClose={() => {
            setGuideOpen(false)
            markGuideSeen()
          }}
        />
      )}
    </div>
  )
}
