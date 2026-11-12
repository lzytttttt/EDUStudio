/**
 * Director 原型外壳（v1.0 预览 → v1.1 视觉收口）
 *
 * 少字策略：顶栏只留 4 个图标；导航只留 3 个词；提示通过引导条与过渡承担。
 * 与旧应用解耦：由 App.tsx 以 lazy chunk 加载，旧三屏（登录/简报/工作台）原样保留。
 *
 * v1.1 视觉 P0/P1（roadmap §7.1）：
 * - V1：toast 下移至 top-[4.75rem]，同屏最多 2 条（同文案合并 ×N），role=status + aria-live；
 * - V6：dock 兼容移动安全区 bottom-[max(12px,env(safe-area-inset-bottom))]；
 * - V9：dock 字形统一 lucide Inbox/Play/Users 18px，图形 aria-hidden，角标走 sr-only；焦点环；
 * - M3 兜底：`?mission=exam_loop` 挂载时种下 exam_loop 计划（不跳屏，tour 参数不影响）。
 */
import { useEffect, useRef } from 'react'
import { HelpCircle, Inbox, LayoutGrid, LogOut, Play, RefreshCw, Users, type LucideIcon } from 'lucide-react'
import type { DirectorScreen, MissionStatus, ToastItem } from '../../harness/director/types'
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

const DOCK: { id: DirectorScreen; label: string; icon: LucideIcon }[] = [
  { id: 'inbox', label: '战情', icon: Inbox },
  { id: 'mission', label: '作战', icon: Play },
  { id: 'team', label: '战队', icon: Users },
]

/** V1 合并规则：同文案合并计数；同屏最多展示最新 2 条（避免叠在标题上） */
function foldToasts(toasts: ToastItem[]): (ToastItem & { count: number })[] {
  const folded: (ToastItem & { count: number })[] = []
  for (const item of toasts) {
    const same = folded.find((t) => t.text === item.text)
    if (same) same.count += 1
    else folded.push({ ...item, count: 1 })
  }
  return folded.slice(-2)
}

/** 作战/暂停态在 dock 上点一个状态点（running 主色呼吸、waiting/paused amber） */
function dockDotClass(status: MissionStatus): string {
  if (status === 'running') return 'bg-primary animate-pulse'
  if (status === 'waiting' || status === 'paused') return 'bg-amber'
  return ''
}

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

  /* M3 演示兜底：`?mission=exam_loop` 只种计划、不跳屏；与 ?tour / ?v1 互不影响。
     **只应用一次**：种完立刻用 history.replaceState 摘掉 mission 参数（保留其它参数）。
     否则刷新后 URL 仍在，会再次 startMission 覆盖持久化恢复出来的 paused/进度。 */
  const missionBootRef = useRef(false)
  useEffect(() => {
    if (missionBootRef.current) return
    missionBootRef.current = true
    const url = new URL(window.location.href)
    if (url.searchParams.get('mission') !== 'exam_loop') return
    useDirectorStore.getState().startMission('exam_loop')
    url.searchParams.delete('mission')
    const search = url.searchParams.toString()
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${search ? `?${search}` : ''}${url.hash}`,
    )
  }, [])

  const visibleToasts = foldToasts(toasts)
  const liveDot = dockDotClass(mission.status)

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
            <p className="hidden text-[0.6875rem] text-ink-soft sm:block">EDUStudio · 预览</p>
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
        className="fixed inset-x-0 bottom-[max(12px,env(safe-area-inset-bottom))] z-30 flex justify-center px-4"
      >
        <div className="d-dock flex items-center gap-0.5 rounded-full border border-line/80 px-1.5 py-1.5 shadow-card">
          {DOCK.map((item) => {
            const active = screen === item.id
            const badge = item.id === 'inbox' && stats.pending > 0
            const Icon = item.icon
            const showDot = item.id === 'mission' && liveDot.length > 0
            return (
              <button
                key={item.id}
                type="button"
                data-testid={`director-dock-${item.id}`}
                aria-pressed={active}
                onClick={() => setScreen(item.id)}
                className={cn(
                  /* 触控 dock ≥44（min-h-[44px]）；字号下限 11px */
                  'relative inline-flex min-h-[44px] w-[4.5rem] flex-col items-center justify-center gap-0.5 rounded-full py-2 text-[0.6875rem] font-medium transition-all duration-300',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                  active ? 'bg-surface text-ink shadow-soft' : 'text-ink-soft hover:text-ink',
                )}
              >
                {/* V9：字形统一 lucide 18px；图形对读屏隐藏，读屏只念三个词 + 角标 */}
                <Icon
                  size={18}
                  strokeWidth={1.8}
                  aria-hidden
                  className={cn(active ? 'text-primary' : 'text-ink-soft')}
                />
                <span>{item.label}</span>
                {badge && (
                  <>
                    <span aria-hidden className="absolute right-3 top-1 h-1.5 w-1.5 rounded-full bg-coral" />
                    <span className="sr-only">，{stats.pending} 件待决策</span>
                  </>
                )}
                {showDot && (
                  <span aria-hidden className={cn('absolute right-3 top-1 h-1.5 w-1.5 rounded-full', liveDot)} />
                )}
              </button>
            )
          })}
        </div>
      </nav>

      <GuideBar />
      <ArtifactSheet />

      {/* 轻提示：只给结果，不打断；top-[4.75rem] 避开标题，role=status 供读屏播报 */}
      <div
        data-testid="director-toasts"
        role="status"
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 top-[4.75rem] z-40 flex flex-col items-center gap-2 px-4"
      >
        {visibleToasts.map((t) => (
          <div
            key={t.id}
            className="d-toast pointer-events-auto flex items-center gap-2 rounded-full border border-line bg-surface/95 px-4 py-2 text-[0.75rem] font-medium text-ink shadow-card backdrop-blur"
          >
            <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', TONE[t.tone].dot)} />
            {t.text}
            {t.count > 1 && <span className="text-[0.6875rem] text-ink-soft">×{t.count}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
