import { useState } from 'react'
import {
  Sparkles, Plus, MessageSquare, Star, Trash2, Settings, ChevronRight, ChevronLeft, FileText, CircleHelp, Bell,
} from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { useChatStore } from '../stores/chatStore'
import { useBriefingStore } from '../stores/briefingStore'
import { useArtifactStore } from '../stores/artifactStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useNotificationStore, unreadCount } from '../stores/notificationStore'
import { useSkillStore } from '../stores/skillStore'
import { useUiStore, type SidebarTab } from '../stores/uiStore'
import { getRolePreset } from '../harness/roles'
import SettingsDialog from '../components/SettingsDialog'
import GuideDialog from '../components/GuideDialog'
import SkillsPanel from './SkillsPanel'
import { cn } from '../lib/cn'

const ROLE_BADGE = { teacher: 'bg-mint-soft text-mint', schoolAdmin: 'bg-primary-soft text-primary', bureau: 'bg-coral-soft text-coral' } as const

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const role = useAuthStore((s) => s.role)
  const setStage = useAuthStore((s) => s.setStage)
  const logout = useAuthStore((s) => s.logout)
  const { sessions, activeId, setActive, newSession, removeSession } = useChatStore()
  const favorites = useBriefingStore((s) => s.favorites)
  const removeFavorite = useBriefingStore((s) => s.removeFavorite)
  const docs = useArtifactStore((s) => s.docs)
  const setActiveDoc = useArtifactStore((s) => s.setActive)
  const mode = useSettingsStore((s) => s.mode)
  const learnedCount = useSkillStore((s) => s.learned.length)
  const unread = useNotificationStore((s) => unreadCount(s.items))
  const openNotifPanel = useNotificationStore((s) => s.openPanel)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  /* tab 受控于 uiStore（v0.7）：简报页「收藏夹」跳转链接可先定位 tab 再进入工作台 */
  const tab = useUiStore((s) => s.sidebarTab)
  const setTab = (key: SidebarTab) => useUiStore.getState().setSidebarTab(key)

  const preset = role ? getRolePreset(role) : null

  return (
    <div className="flex h-full w-full flex-col">
      {/* 品牌 */}
      <div className="flex items-center justify-between px-4 pb-3 pt-4">
        <button
          onClick={() => { setStage('briefing'); onNavigate?.() }}
          className="flex items-center gap-2 rounded-xl px-1 py-1 text-left transition-colors hover:bg-surface-2"
          title="返回今日简报"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-white">
            <Sparkles size={15} />
          </div>
          <div>
            <p className="text-sm font-bold leading-tight">智教工坊 · EDUStudio</p>
            <p className="minor-info text-[0.625rem] text-ink-mute">{mode === 'mock' ? 'Mock 演示模式' : 'API 模式'}</p>
          </div>
        </button>
        <div className="flex items-center gap-0.5">
          <button
            onClick={openNotifPanel}
            className="relative flex h-8 w-8 items-center justify-center rounded-lg text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink"
            aria-label="通知中心"
            title="通知中心"
          >
            <Bell size={16} />
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-coral px-1 text-[0.5625rem] font-bold text-white">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>
          <button
            onClick={() => setGuideOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink"
            aria-label="使用指南"
            title="使用指南"
          >
            <CircleHelp size={16} />
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink"
            aria-label="设置"
          >
            <Settings size={16} />
          </button>
        </div>
      </div>

      {/* 新建任务 */}
      <div className="px-3">
        <button
          onClick={() => { if (role) { newSession(role); onNavigate?.() } }}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-2.5 text-sm font-medium text-white shadow-soft transition-all hover:bg-primary-deep hover:shadow-pop active:scale-[0.98]"
        >
          <Plus size={16} />
          新建任务
        </button>
      </div>

      {/* Tab 切换 */}
      <div className="mx-3 mt-4 flex rounded-xl bg-surface-2 p-1 text-xs font-medium">
        {([['tasks', '任务'], ['fav', '收藏'], ['docs', '文档'], ['skills', '技能']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'flex-1 rounded-lg py-1.5 transition-all',
              tab === key ? 'bg-surface text-ink shadow-soft' : 'text-ink-mute hover:text-ink-soft',
            )}
          >
            {label}
            {key === 'fav' && favorites.length > 0 && ` ${favorites.length}`}
            {key === 'docs' && docs.length > 0 && ` ${docs.length}`}
            {key === 'skills' && learnedCount > 0 && ` ${learnedCount}`}
          </button>
        ))}
      </div>

      {/* 列表 */}
      <div className="mt-2 flex-1 space-y-1 overflow-y-auto px-3 pb-3">
        {tab === 'tasks' && (
          <>
            {sessions.length === 0 && (
              <p className="px-2 py-6 text-center text-xs leading-relaxed text-ink-mute">
                暂无任务<br />从今日简报采纳卡片，或点击「新建任务」
              </p>
            )}
            {sessions.map((s) => (
              <div
                key={s.id}
                onClick={() => { setActive(s.id); onNavigate?.() }}
                className={cn(
                  'group flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 transition-colors',
                  activeId === s.id ? 'bg-primary-soft text-primary' : 'hover:bg-surface-2',
                )}
              >
                <MessageSquare size={14} className="shrink-0 opacity-70" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.8125rem] font-medium leading-tight">{s.title}</p>
                  <p className="minor-info text-[0.625rem] text-ink-mute">
                    {new Date(s.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); removeSession(s.id) }}
                  className="hidden h-7 w-7 items-center justify-center rounded-lg text-ink-mute hover:bg-danger/10 hover:text-danger group-hover:flex"
                  aria-label="删除会话"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </>
        )}

        {tab === 'fav' && (
          <>
            {favorites.length === 0 && (
              <p className="px-2 py-6 text-center text-xs leading-relaxed text-ink-mute">
                收藏夹是空的<br />在今日简报中按 ↑ 收藏卡片
              </p>
            )}
            {favorites.map((f) => (
              <div key={f.id} className="group rounded-xl border border-line px-3 py-2.5 hover:border-amber/50">
                <div className="flex items-start gap-2">
                  <Star size={13} className="mt-0.5 shrink-0 fill-amber text-amber" />
                  <p className="line-clamp-2 flex-1 text-xs leading-relaxed">{f.title}</p>
                  <button
                    onClick={() => removeFavorite(f.id)}
                    className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-mute hover:bg-danger/10 hover:text-danger group-hover:flex"
                    aria-label="移除收藏"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <p className="minor-info mt-1 pl-5 text-[0.625rem] text-ink-mute">{f.source}</p>
              </div>
            ))}
          </>
        )}

        {tab === 'docs' && (
          <>
            {docs.length === 0 && (
              <p className="px-2 py-6 text-center text-xs leading-relaxed text-ink-mute">
                暂无文档<br />Agent 生成的教案/报告/通知会出现在这里
              </p>
            )}
            {docs.map((d) => (
              <div
                key={d.id}
                onClick={() => { setActiveDoc(d.id); onNavigate?.() }}
                className="group flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-2"
              >
                <FileText size={14} className="shrink-0 text-ink-mute" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.8125rem] font-medium leading-tight">{d.title}</p>
                  <p className="minor-info text-[0.625rem] text-ink-mute">
                    {new Date(d.createdAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
                  </p>
                </div>
                <ChevronRight size={13} className="shrink-0 text-ink-mute opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
            ))}
          </>
        )}

        {tab === 'skills' && <SkillsPanel />}
      </div>

      {/* 角色徽标 */}
      <div className="border-t border-line p-3">
        <div className="flex items-center justify-between rounded-2xl bg-surface-2 px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <span className={cn('flex h-8 w-8 items-center justify-center rounded-xl text-xs font-bold', role ? ROLE_BADGE[role] : '')}>
              {preset?.name.slice(0, 1)}
            </span>
            <div>
              <p className="text-xs font-semibold leading-tight">{preset?.name}</p>
              <p className="minor-info text-[0.625rem] text-ink-mute">{preset?.subtitle}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-mute transition-colors hover:bg-danger/10 hover:text-danger"
            title="切换身份"
            aria-label="切换身份"
          >
            <ChevronLeft size={15} />
          </button>
        </div>
      </div>

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {guideOpen && <GuideDialog stage="workbench" onClose={() => setGuideOpen(false)} />}
    </div>
  )
}
