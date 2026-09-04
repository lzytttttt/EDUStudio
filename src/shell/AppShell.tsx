import { useState } from 'react'
import { PanelLeft, FileText, X } from 'lucide-react'
import Sidebar from './Sidebar'
import ChatPanel from '../apps/chat/ChatPanel'
import RightPanel from './RightPanel'
import GuideDialog from '../components/GuideDialog'
import { useAuthStore } from '../stores/authStore'
import { useSettingsStore } from '../stores/settingsStore'
import { cn } from '../lib/cn'

/** 三栏工作台外壳：<xl 右栏折叠为抽屉，<md 左栏折叠为抽屉 */
export default function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [artifactOpen, setArtifactOpen] = useState(false)
  const setStage = useAuthStore((s) => s.setStage)
  // 首次进入工作台：自动弹出操作说明（v0.3 UI 专项）
  const guideSeen = useSettingsStore((s) => s.guideSeen)
  const markGuideSeen = useSettingsStore((s) => s.markGuideSeen)
  const [guideOpen, setGuideOpen] = useState(!guideSeen)

  return (
    <div className="flex h-full overflow-hidden bg-bg">
      {/* 左栏：桌面常驻 / 移动抽屉 */}
      <aside className="hidden md:flex md:w-72 lg:w-80 shrink-0 border-r border-line bg-surface">
        <Sidebar onNavigate={() => setSidebarOpen(false)} />
      </aside>
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-ink/30 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 animate-slide-in-right border-r border-line bg-surface">
            <Sidebar onNavigate={() => setSidebarOpen(false)} />
          </aside>
        </div>
      )}

      {/* 中栏：对话流 */}
      <main className="relative flex min-w-0 flex-1 flex-col">
        {/* 移动端顶栏 */}
        <div className="flex items-center justify-between border-b border-line bg-surface px-3 py-2 md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-soft hover:bg-surface-2"
            aria-label="打开任务列表"
          >
            <PanelLeft size={18} />
          </button>
          <button
            onClick={() => setStage('briefing')}
            className="rounded-lg px-2 py-1 text-sm font-semibold transition-colors hover:bg-surface-2"
            title="返回今日简报"
          >
            EDUStudio
          </button>
          <button
            onClick={() => setArtifactOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-soft hover:bg-surface-2"
            aria-label="打开文档面板"
          >
            <FileText size={18} />
          </button>
        </div>
        <ChatPanel />
      </main>

      {/* 右栏：文档 + 角色增强面板，桌面常驻 / 窄屏抽屉 */}
      <aside className="hidden xl:flex xl:w-[400px] 2xl:w-[440px] shrink-0 border-l border-line bg-surface">
        <RightPanel />
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
              <RightPanel />
            </div>
          </aside>
        </div>
      )}

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
