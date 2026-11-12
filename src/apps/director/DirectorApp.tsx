/**
 * Director 原型外壳（v1.0 预览）
 *
 * 少字策略：顶栏只留 4 个图标；导航只留 3 个词；提示通过引导条与过渡承担。
 * 与旧应用解耦：由 App.tsx 以 lazy chunk 加载，旧三屏（登录/简报/工作台）原样保留。
 */
import { useEffect } from 'react'
import { HelpCircle, LayoutGrid, LogOut, RefreshCw } from 'lucide-react'
import type { DirectorScreen } from '../../harness/director/types'
import { hasSeenDirectorGuide, useDirectorStore } from '../../stores/directorStore'
import { useAuthStore } from '../../stores/authStore'
import { BRAND_ART } from '../../theme/art'
import { cn } from '../../lib/cn'
import InboxSurface from './InboxSurface'
import MissionSurface from './MissionSurface'
import TeamSurface from './TeamSurface'
import GuideBar from './GuideBar'
import ArtifactSheet from './ArtifactSheet'
import { IconButton, TONE } from './shared'
import './director.css'

const DOCK: { id: DirectorScreen; label: string; glyph: string }[] = [
  { id: 'inbox', label: '战情', glyph: '◈' },
  { id: 'mission', label: '作战', glyph: '▶' },
  { id: 'team', label: '战队', glyph: '◎' },
]

export default function DirectorApp() {
  const screen = useDirectorStore((s) => s.screen)
  const setScreen = useDirectorStore((s) => s.setScreen)
  const startGuide = useDirectorStore((s) => s.startGuide)
  const resetDemo = useDirectorStore((s) => s.resetDemo)
  const toasts = useDirectorStore((s) => s.toasts)
  const stats = useDirectorStore((s) => s.stats)
  const mission = useDirectorStore((s) => s.mission)
  const setStage = useAuthStore((s) => s.setStage)
  const logout = useAuthStore((s) => s.logout)

  /* 首次进入自动开一段「导演引导」；?tour=0 可关闭（截图 / 回归用），?tour=1 强制重看 */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('tour') === '0') return
    const force = params.get('tour') === '1'
    const t = window.setTimeout(() => {
      if (force || !hasSeenDirectorGuide()) startGuide(force)
    }, 1100)
    return () => window.clearTimeout(t)
  }, [startGuide])

  const running = mission.status === 'running' || mission.status === 'waiting'

  return (
    <div className="d-root relative flex h-full flex-col overflow-hidden">
      {/* 背景层：柔光球 + 点阵，全部 aria-hidden */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="d-noise absolute inset-0" />
        <div className="d-orb animate-drift absolute -left-24 -top-24 h-[420px] w-[420px] bg-primary/25" />
        <div className="d-orb animate-drift absolute -right-24 top-10 h-[360px] w-[360px] bg-mint/25" style={{ animationDelay: '-6s' }} />
        <div className="d-orb animate-drift absolute bottom-[-140px] left-1/3 h-[380px] w-[380px] bg-amber/25" style={{ animationDelay: '-11s' }} />
      </div>

      {/* 顶栏：品牌 + 4 个图标动作（全部 title/aria 可发现） */}
      <header className="relative z-30 flex items-center justify-between px-4 py-3 sm:px-7 sm:py-4">
        <div className="flex items-center gap-2.5">
          <img src={BRAND_ART.markColor} alt="" className="h-8 w-8 object-contain sm:h-9 sm:w-9" />
          <div className="leading-tight">
            <p className="text-[0.8125rem] font-semibold tracking-tight">总指挥模式</p>
            <p className="hidden text-[0.625rem] text-ink-mute sm:block">EDUStudio · 预览</p>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton icon={HelpCircle} label="再看一遍引导" onClick={() => startGuide(true)} />
          <IconButton icon={RefreshCw} label="重置演示" onClick={resetDemo} />
          <IconButton icon={LayoutGrid} label="返回经典模式" onClick={() => setStage('briefing')} />
          <IconButton icon={LogOut} label="退出登录" onClick={logout} />
        </div>
      </header>

      {/* 主内容：一次只挂一个屏幕，切换走 d-fade 过渡 */}
      <main className="relative z-10 min-h-0 flex-1">
        <div key={screen} className="d-fade h-full">
          {screen === 'inbox' && <InboxSurface />}
          {screen === 'mission' && <MissionSurface />}
          {screen === 'team' && <TeamSurface />}
        </div>
      </main>

      {/* 底部渐隐：让内容在 dock 之下柔和收口（移动端滚动时不显生硬） */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 bottom-0 z-20 h-24 bg-gradient-to-t from-bg via-bg/75 to-transparent"
      />

      {/* 底部导航：3 个词；各屏内的具体操作不在这里堆 */}
      <nav
        aria-label="总指挥模式导航"
        className="fixed inset-x-0 bottom-3 z-30 flex justify-center px-4 sm:bottom-4"
      >
        <div className="d-dock flex items-center gap-0.5 rounded-full border border-line/80 px-1.5 py-1.5 shadow-card">
          {DOCK.map((item) => {
            const active = screen === item.id
            const badge = item.id === 'inbox' && stats.pending > 0
            return (
              <button
                key={item.id}
                type="button"
                data-testid={`director-dock-${item.id}`}
                aria-label={item.label}
                aria-pressed={active}
                onClick={() => setScreen(item.id)}
                className={cn(
                  'relative inline-flex w-[4.5rem] flex-col items-center gap-0.5 rounded-full py-1.5 text-[0.625rem] font-medium transition-all duration-300',
                  active ? 'bg-surface text-ink shadow-soft' : 'text-ink-soft hover:text-ink',
                )}
              >
                <span className={cn('text-[0.8125rem] leading-none', active ? 'text-primary' : 'text-ink-mute')}>
                  {item.id === 'mission' && running ? <span className="d-dot inline-block h-2 w-2 rounded-full bg-primary" /> : item.glyph}
                </span>
                {item.label}
                {badge && (
                  <span className="absolute right-3 top-1 h-1.5 w-1.5 rounded-full bg-coral" aria-hidden />
                )}
              </button>
            )
          })}
        </div>
      </nav>

      <GuideBar />
      <ArtifactSheet />

      {/* 轻提示：只给结果，不打断 */}
      <div className="pointer-events-none fixed inset-x-0 top-16 z-40 flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="d-rise pointer-events-auto flex items-center gap-2 rounded-full border border-line bg-surface/95 px-4 py-2 text-[0.75rem] font-medium text-ink shadow-card backdrop-blur"
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', TONE[t.tone].dot)} />
            {t.text}
          </div>
        ))}
      </div>
    </div>
  )
}
