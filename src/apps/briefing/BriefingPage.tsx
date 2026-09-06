import { useCallback, useEffect, useRef, useState } from 'react'
import {
  X, Star, Check, Sparkles, ArrowLeft, ArrowUp, ArrowRight, LayoutDashboard, RotateCcw,
  RefreshCw, FileText, Clock, Loader2, Wand2,
} from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useBriefingStore } from '../../stores/briefingStore'
import { useChatStore } from '../../stores/chatStore'
import { useFocusStore } from '../../stores/focusStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUiStore } from '../../stores/uiStore'
import { getRolePreset } from '../../harness/roles'
import { formatAge, isStale } from '../../harness/sources'
import type { BriefingGenOptions, CardLink } from '../../harness/types'
import ImportDocumentDialog from '../../components/ImportDocumentDialog'
import RegenerateDialog from './RegenerateDialog'
import BriefingCardView from './BriefingCardView'
import StampMark, { STAMP_POSITION, type StampDecision } from './StampMark'
import KeptBriefingCards, { type KeptCardItem } from './KeptBriefingCards'
import BriefingIntro from './BriefingIntro'
import FocusSummary from './FocusSummary'
import FocusTaskSheet from './FocusTaskSheet'
import GuideDialog from '../../components/GuideDialog'
import { cn } from '../../lib/cn'

type Direction = 'left' | 'up' | 'right'

const EXIT_MS = 340
const DECIDE_THRESHOLD = 110
const DRAG_START_THRESHOLD = 6
const TILT_FACTOR = 0.07
const PICKUP_SCALE = 1.03

/** 简报切入动画播放条件（v0.8.3）：弱动效偏好跳过；首次使用者先看操作引导（guideSeen=false 不播）。
 *  判定为函数：「重新过一遍」重播时按当次状态重新判定（如刚看完引导的用户同会话重放也可播） */
const INTRO_ELIGIBLE = () =>
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches && useSettingsStore.getState().guideSeen
/** 会话级标记：普通进入简报每次会话至多播一次（「重新过一遍」重播不受此限） */
let introPlayed = false

/** 飞出位移：在当前拖拽位置基础上继续飞出舞台，避免先弹回中心再飞出的跳变 */
const EXIT_OFFSET: Record<Direction, { x: number; y: number; rotate: number }> = {
  left: { x: -560, y: 70, rotate: -18 },
  right: { x: 560, y: 70, rotate: 18 },
  up: { x: 0, y: -660, rotate: 0 },
}

const STAMP_META: Record<Direction, StampDecision> = {
  left: 'skip',
  up: 'fav',
  right: 'accept',
}

/** 桌面端断点（对齐 Tailwind md：<768px 为移动端，保留卡物理动效仅在桌面启用） */
function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(
    () => typeof window === 'undefined' || window.matchMedia('(min-width: 768px)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const onChange = (e: MediaQueryListEvent) => setDesktop(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return desktop
}

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1)
/** 区间随机（保留卡甩飞初速度抖动，v0.8.2） */
const rand = (a: number, b: number) => a + Math.random() * (b - a)

/** 拖拽力度 → 阴影插值（shadow-card → shadow-pop），营造「拿起」手感 */
function dragShadow(strength: number): string {
  const a = 0.18 + strength * 0.12
  const b = 0.08 + strength * 0.1
  return `0 ${20 + strength * 8}px ${60 + strength * 20}px -20px rgba(38,34,29,${a.toFixed(3)}), 0 ${8 + strength * 4}px ${24 + strength * 8}px -12px rgba(38,34,29,${b.toFixed(3)})`
}

export default function BriefingPage() {
  const role = useAuthStore((s) => s.role)
  const setStage = useAuthStore((s) => s.setStage)
  const { cards, decisions, processed, meta, loading, loadDeck, decide, revertDecision, resetDeck, setGenOptions } = useBriefingStore()
  const sendMessage = useChatStore((s) => s.sendMessage)
  const focusMode = useSettingsStore((s) => s.focusMode)
  const focusTasks = useFocusStore((s) => s.tasks)
  const clearTasks = useFocusStore((s) => s.clearTasks)
  const isDesktop = useIsDesktop()

  const [exiting, setExiting] = useState<Direction | null>(null)
  const [drag, setDrag] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  /* 已处理卡片保留层（v0.8.2 桌面端）：盖章后甩飞物理停留，可拖回重新批阅 */
  const [kept, setKept] = useState<KeptCardItem[]>([])
  /* 拖回的卡片优先作为当前卡展示（不受卡组顺序影响） */
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  // 后台任务浮层（v0.8.1）：批示过程中点击指示器随时查看任务明细
  const [taskSheetOpen, setTaskSheetOpen] = useState(false)
  // 重新生成弹窗（v0.8.4）：自定义提示词/种类/参考资料/高级选项后重载卡组
  const [regenOpen, setRegenOpen] = useState(false)
  // 简报切入动画（v0.8.3）：会话首进且已看过引导时播放；「重新过一遍」重置卡组时同样播放
  const [intro, setIntro] = useState(() => INTRO_ELIGIBLE() && !introPlayed)
  useEffect(() => {
    if (intro) introPlayed = true
  }, [intro])
  // 首次进入简报：自动弹出操作说明（v0.3 UI 专项）
  const guideSeen = useSettingsStore((s) => s.guideSeen)
  const markGuideSeen = useSettingsStore((s) => s.markGuideSeen)
  const [guideOpen, setGuideOpen] = useState(!guideSeen)
  const pointerStart = useRef<{ x: number; y: number } | null>(null)
  const suppressClick = useRef(false)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (role) void loadDeck(role)
  }, [role, loadDeck])

  const handleRefresh = useCallback(() => {
    if (!role || refreshing) return
    setRefreshing(true)
    void loadDeck(role).finally(() => window.setTimeout(() => setRefreshing(false), 400))
  }, [role, loadDeck, refreshing])

  /* 重新过一遍（批示完成空态 / 专注模式总结层共用）：重置卡组并重播卡牌生成切入动画（v0.8.3） */
  const replayDeck = useCallback(() => {
    setKept([])
    setPinnedId(null)
    resetDeck()
    if (INTRO_ELIGIBLE()) setIntro(true)
    if (role) void loadDeck(role)
  }, [resetDeck, loadDeck, role])

  /* 重新生成（v0.8.4）：保存选项 → 重置卡组并重载，复用「重新过一遍」的重播路径（含切入动画） */
  const handleRegenerate = useCallback(
    (options: BriefingGenOptions) => {
      setRegenOpen(false)
      setGenOptions(options)
      setKept([])
      setPinnedId(null)
      resetDeck()
      if (INTRO_ELIGIBLE()) setIntro(true)
      if (role) void loadDeck(role, options)
    },
    [setGenOptions, resetDeck, loadDeck, role],
  )

  const stale = isStale(meta)
  /* 导入入口（v0.9 M6①）：教师 / 校管 / 教育局三角色统一开放「导入文档」 */
  const canImport = role === 'teacher' || role === 'schoolAdmin' || role === 'bureau'

  const visible = cards.filter((c) => !decisions[c.id])
  const current = (pinnedId ? visible.find((c) => c.id === pinnedId) : undefined) ?? visible[0]
  const total = cards.length
  const activeTasks = focusTasks.filter((t) => t.status === 'queued' || t.status === 'running').length

  /* 取回保留卡（v0.8.2）：撤回决策 → 卡片回到未批示态并置顶展示，可修改内容后重新批阅 */
  const handleReturn = useCallback(
    (cardId: string) => {
      revertDecision(cardId)
      setPinnedId(cardId)
      setKept((prev) => prev.filter((k) => k.card.id !== cardId))
    },
    [revertDecision],
  )

  /* 卡片跳转分发（v0.7）：source→数据源 / task→工作台任务 / favorite→收藏夹 */
  const handleLink = useCallback(
    (link: CardLink) => {
      if (link.kind === 'source') {
        if (canImport) setImportOpen(true)
        else handleRefresh()
      } else if (link.kind === 'task') {
        if (link.goal) void sendMessage(link.goal)
        setStage('workbench')
      } else {
        useUiStore.getState().setSidebarTab('fav')
        setStage('workbench')
      }
    },
    [canImport, handleRefresh, sendMessage, setStage],
  )

  const handleDecide = useCallback(
    (direction: Direction) => {
      if (!current || exiting || intro) return
      setExiting(direction)
      const card = current
      const dragAt = { ...drag }
      window.setTimeout(() => {
        const decided = decide(card.id, direction === 'up' ? 'fav' : direction === 'right' ? 'accept' : 'skip')
        setExiting(null)
        setPinnedId(null)
        setDrag({ x: 0, y: 0 })
        setDragging(false)
        /* 保留卡（v0.8.2 桌面端）：以离场终点为起点、沿甩飞方向继续物理运动，与离场动画无缝衔接 */
        if (isDesktop && decided) {
          const off = EXIT_OFFSET[direction]
          setKept((prev) => [
            ...prev.slice(-7),
            {
              card: decided,
              decision: direction === 'up' ? 'fav' : direction === 'right' ? 'accept' : 'skip',
              x0: dragAt.x + off.x,
              y0: dragAt.y + off.y,
              rot0: dragAt.x * 0.02,
              vx: direction === 'right' ? rand(620, 900) : direction === 'left' ? -rand(620, 900) : rand(-260, 260),
              vy: direction === 'up' ? -rand(680, 920) : rand(40, 180),
              spin: direction === 'left' ? -rand(30, 110) : direction === 'right' ? rand(30, 110) : rand(-120, 120),
            },
          ])
        }
        if (direction === 'right' && decided?.action?.kind === 'openTask') {
          /* 采纳联动（v0.7）：卡片带选中选项时，选择结果注入任务目标 */
          const selected =
            decided.payload?.kind === 'options' && decided.payload.selected != null
              ? decided.payload.options[decided.payload.selected]?.text
              : null
          const goal = selected ? `${decided.action.goal}（已选：${selected}）` : decided.action.goal
          if (focusMode) {
            /* 专注模式：任务转入后台执行，留在简报页继续批示 */
            useFocusStore.getState().acceptTask(decided, goal)
          } else {
            void sendMessage(goal)
            setStage('workbench')
          }
        }
      }, EXIT_MS)
    },
    [current, exiting, drag, decide, isDesktop, focusMode, sendMessage, setStage, intro],
  )

  /* 键盘：← 跳过 / ↑ 收藏 / → 采纳 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') handleDecide('left')
      else if (e.key === 'ArrowUp') handleDecide('up')
      else if (e.key === 'ArrowRight') handleDecide('right')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleDecide])

  /* 指针拖拽：capture 到卡片容器；位移超过阈值才判定为拖拽，避免影响卡内点击 */
  const onPointerDown = (e: React.PointerEvent) => {
    if (exiting || e.button !== 0) return
    pointerStart.current = { x: e.clientX, y: e.clientY }
    cardRef.current?.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointerStart.current || exiting) return
    const x = e.clientX - pointerStart.current.x
    const y = e.clientY - pointerStart.current.y
    if (!dragging && Math.hypot(x, y) < DRAG_START_THRESHOLD) return
    setDragging(true)
    setDrag({ x, y })
  }
  const endDrag = () => {
    if (!pointerStart.current || exiting) return
    pointerStart.current = null
    if (!dragging) return
    const { x, y } = drag
    if (x > DECIDE_THRESHOLD || x < -DECIDE_THRESHOLD || y < -DECIDE_THRESHOLD) {
      suppressClick.current = true
      handleDecide(x > DECIDE_THRESHOLD ? 'right' : x < -DECIDE_THRESHOLD ? 'left' : 'up')
    } else {
      /* 未过阈值：弹性回弹，回弹结束后再解除拖拽态 */
      setDrag({ x: 0, y: 0 })
      window.setTimeout(() => setDragging(false), 420)
    }
  }
  /* 拖拽后拦截卡片内部的 click（如展开按钮），避免误触 */
  const onClickCapture = (e: React.MouseEvent) => {
    if (suppressClick.current) {
      e.preventDefault()
      e.stopPropagation()
      suppressClick.current = false
    }
  }

  const preset = role ? getRolePreset(role) : null

  /* 卡片变换（v0.7）：拖拽跟手（倾斜/放大/阴影加深）→ 过阈值飞出 / 未过阈值回弹 */
  const dragStrength = clamp01(Math.hypot(drag.x, drag.y) / DECIDE_THRESHOLD)
  const cardStyle: React.CSSProperties | undefined = exiting
    ? {
        transform: `translate3d(${drag.x + EXIT_OFFSET[exiting].x}px, ${drag.y + EXIT_OFFSET[exiting].y}px, 0) rotate(${EXIT_OFFSET[exiting].rotate + drag.x * 0.02}deg)`,
        opacity: 0,
        transition: `transform ${EXIT_MS}ms cubic-bezier(0.32, 0, 0.4, 1), opacity ${EXIT_MS - 40}ms ease-in`,
        pointerEvents: 'none',
      }
    : dragging
      ? drag.x !== 0 || drag.y !== 0
        ? {
            transform: `translate3d(${drag.x}px, ${drag.y}px, 0) rotate(${drag.x * TILT_FACTOR}deg) scale(${PICKUP_SCALE})`,
            boxShadow: dragShadow(dragStrength),
            transition: 'none',
          }
        : {
            transform: 'translate3d(0, 0, 0) scale(1)',
            transition: 'transform 420ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 420ms ease',
          }
      : undefined

  /* 堆叠视差（v0.7）：后卡跟随前卡拖拽微位移/缩放，拖拽中跟手、松手弹性回弹；入场 stagger 60ms */
  const stackShift = dragging ? clamp01(Math.hypot(drag.x, drag.y) / 220) : 0
  const stackStyle = (depth: 1 | 2): React.CSSProperties => ({
    transform: `translate3d(${drag.x * (depth === 1 ? 0.06 : 0.03)}px, ${drag.y * (depth === 1 ? 0.06 : 0.03)}px, 0) scale(${(depth === 1 ? 0.97 : 0.94) + stackShift * (depth === 1 ? 0.02 : 0.015)})`,
    opacity: (depth === 1 ? 0.7 : 0.4) + stackShift * (depth === 1 ? 0.2 : 0.15),
    transition: dragging ? 'none' : 'transform 420ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 420ms ease',
    animationDelay: `${depth * 60}ms`,
  })

  const stats = {
    accept: Object.values(decisions).filter((d) => d === 'accept').length,
    fav: Object.values(decisions).filter((d) => d === 'fav').length,
    skip: Object.values(decisions).filter((d) => d === 'skip').length,
  }
  const showFocusSummary = !current && !loading && focusMode && focusTasks.length > 0

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-bg">
      {/* 顶部进度栏（v0.6.1：移动端精简——隐藏日期、按钮缩为图标/短文案，减少 banner 遮挡） */}
      <header className="flex items-center justify-between gap-2 px-4 pt-4 sm:gap-3 sm:px-6 sm:pt-5 md:px-10">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary text-white">
            <Sparkles size={15} />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">今日简报</p>
            <p className="text-[0.6875rem] text-ink-mute">
              <span className="minor-info hidden sm:inline">2026 年 9 月 4 日 · </span>
              {preset?.name ?? '访客'} · 已处理 {processed}/{total}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* 数据新鲜度标注（v0.5 M1④）：来源 + 相对时间；超 7 天提示刷新（移动端不显示） */}
          {meta && (
            <button
              onClick={handleRefresh}
              title={stale ? '数据已超过 7 天，点击刷新' : '刷新数据'}
              className={cn(
                'minor-info hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.625rem] transition-colors sm:flex',
                stale ? 'border-amber/60 bg-amber-50 text-amber-700 hover:border-amber' : 'border-line bg-surface text-ink-mute hover:border-primary/40 hover:text-primary',
              )}
            >
              <RefreshCw size={10} className={cn(refreshing && 'animate-spin')} />
              <Clock size={10} />
              {meta.label} · {formatAge(meta.fetchedAt)}
              {stale && ' · 建议刷新'}
            </button>
          )}
          {canImport && (
            <button
              onClick={() => setImportOpen(true)}
              className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:border-primary/50 hover:text-primary sm:px-3"
              title={role === 'bureau' ? '导入区县汇总文档，简报将引用其内容' : '导入文档（成绩表/说明文档），简报与任务将引用其内容'}
              aria-label="导入文档"
            >
              <FileText size={13} />
              <span className="hidden sm:inline">导入文档</span>
            </button>
          )}
          {/* 重新生成（v0.8.4）：自定义偏好后重载卡组，与刷新/导入并列 */}
          <button
            onClick={() => setRegenOpen(true)}
            className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:border-primary/50 hover:text-primary sm:px-3"
            title="自定义偏好，重新生成今日简报"
            aria-label="重新生成简报"
            data-testid="regen-btn"
          >
            <Wand2 size={13} />
            <span className="hidden sm:inline">重新生成</span>
          </button>
          {/* 移动端后台执行指示器（v0.8.1）：收进顶栏避免遮挡卡片与落章，点击查看任务明细 */}
          {focusMode && activeTasks > 0 && current && (
            <button
              onClick={() => setTaskSheetOpen(true)}
              data-testid="focus-indicator-mobile"
              className="flex items-center gap-1 rounded-full border border-primary/30 bg-surface px-2 py-1.5 text-[0.6875rem] font-medium text-primary transition-colors hover:border-primary/60 md:hidden"
              aria-label={`${activeTasks} 个任务后台执行中，点击查看`}
              title="查看后台任务"
            >
              <Loader2 size={12} className="animate-spin" />
              {activeTasks}
            </button>
          )}
          <button
            onClick={() => setStage('workbench')}
            className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:border-primary/50 hover:text-primary sm:px-3.5"
          >
            <LayoutDashboard size={13} />
            <span className="hidden sm:inline">跳过简报，直接进入工作台</span>
            <span className="sm:hidden">工作台</span>
          </button>
        </div>
      </header>
      <div className="mx-4 mt-3 h-1 overflow-hidden rounded-full bg-line sm:mx-6 md:mx-10">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${total ? (processed / total) * 100 : 0}%` }}
        />
      </div>

      {/* 卡片舞台 */}
      <main className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-6">
        {/* 已处理保留层（v0.8.2 桌面端）：盖章卡甩飞物理停留，置于卡组之下、点击/拖拽可取回重批 */}
        {isDesktop && kept.length > 0 && <KeptBriefingCards items={kept} onReturn={handleReturn} />}
        {/* 专注模式：后台执行浮动指示器（v0.7），计数变化时弹跳；v0.8.1 起可点击查看任务明细（移动端收进顶栏） */}
        {focusMode && activeTasks > 0 && current && (
          <button
            key={activeTasks}
            onClick={() => setTaskSheetOpen(true)}
            data-testid="focus-indicator"
            className="absolute right-4 top-2 z-20 hidden animate-bounce-soft items-center gap-2 rounded-full border border-primary/30 bg-surface px-3.5 py-1.5 text-xs font-medium text-primary shadow-soft transition-colors hover:border-primary/60 md:flex"
            title="查看后台任务"
            aria-label={`${activeTasks} 个任务后台执行中，点击查看`}
          >
            <Loader2 size={13} className="animate-spin" />
            {activeTasks} 个任务后台执行中
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-mint" />
          </button>
        )}
        {intro ? (
          /* 首次进入简报：卡牌生成切入动画（v0.8.3），卡组就绪后淡出交棒给真实卡组入场 */
          <BriefingIntro ready={!loading} onDone={() => setIntro(false)} />
        ) : !current ? (
          loading ? (
            /* 卡组加载中：卡片形骨架屏，避免闪现「已读完」空状态 */
            <div className="h-full max-h-[560px] w-full max-w-[420px] animate-pulse">
              <div className="flex h-full flex-col rounded-[28px] border border-line bg-surface p-6">
                <div className="h-5 w-20 rounded-full bg-surface-2" />
                <div className="mt-6 h-7 w-4/5 rounded-lg bg-surface-2" />
                <div className="mt-3 h-4 w-full rounded bg-surface-2" />
                <div className="mt-2 h-4 w-11/12 rounded bg-surface-2" />
                <div className="mt-2 h-4 w-2/3 rounded bg-surface-2" />
                <div className="mt-auto space-y-2">
                  <div className="h-16 w-full rounded-2xl bg-surface-2" />
                  <div className="h-3 w-24 rounded bg-surface-2" />
                </div>
              </div>
            </div>
          ) : showFocusSummary ? (
            /* 专注模式：批示完成总结层（v0.7） */
            <FocusSummary
              tasks={focusTasks}
              stats={stats}
              onEnterWorkbench={() => setStage('workbench')}
              onReplay={() => {
                clearTasks()
                replayDeck()
              }}
            />
          ) : (
            <div className="animate-fade-up text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-mint-soft text-mint">
                <Check size={28} />
              </div>
              <h2 className="mt-5 text-xl font-bold">今日简报已读完</h2>
              <p className="mt-1.5 text-sm text-ink-soft">收藏的卡片已放入工作台收藏夹，随时回看</p>
              <div className="mt-6 flex items-center justify-center gap-3">
                <button
                  onClick={() => setStage('workbench')}
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-white shadow-soft transition-all hover:bg-primary-deep hover:shadow-pop"
                >
                  <LayoutDashboard size={15} />
                  进入工作台
                </button>
                <button
                  onClick={replayDeck}
                  className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-5 py-2.5 text-sm font-medium text-ink-soft transition-colors hover:border-primary/50 hover:text-primary"
                >
                  <RotateCcw size={14} />
                  重新过一遍
                </button>
              </div>
            </div>
          )
        ) : (
          <div className="relative h-full max-h-[560px] w-full max-w-[420px]">
            {/* 底部堆叠预览：视差联动 + 入场 stagger（v0.7） */}
            {visible[2] && (
              <div
                style={stackStyle(2)}
                className="absolute inset-x-3 bottom-2 top-5 animate-card-enter rounded-[28px] border border-line bg-surface opacity-40"
              >
                <div className="m-4 h-4 w-1/2 rounded bg-surface-2" />
              </div>
            )}
            {visible[1] && (
              <div
                style={stackStyle(1)}
                className="absolute inset-x-1.5 bottom-1 top-2.5 animate-card-enter rounded-[28px] border border-line bg-surface opacity-70 shadow-card-next"
              >
                <div className="m-4 h-4 w-2/3 rounded bg-surface-2" />
              </div>
            )}
            {/* 当前卡：外层负责入场动画（key 变化触发），内层负责拖拽/飞出变换 */}
            <div key={current.id} className="absolute inset-0 animate-card-enter">
              <div
                ref={cardRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onClickCapture={onClickCapture}
                style={cardStyle}
                className="absolute inset-0 touch-none select-none"
              >
                <BriefingCardView
                  card={current}
                  onSelectOption={(cardId, index) => useBriefingStore.getState().selectOption(cardId, index)}
                  onToggleTodo={(cardId, index) => useBriefingStore.getState().toggleTodo(cardId, index)}
                  onEditText={(cardId, text) => useBriefingStore.getState().editCardText(cardId, text)}
                  onOpenLink={handleLink}
                />
                {/* 真实落章（v0.7）：拖拽预览随力度淡入，决策触发瞬间砸下定格并随卡飞出 */}
                {(['left', 'up', 'right'] as Direction[]).map((dir) => {
                  const raw = dir === 'right' ? drag.x : dir === 'left' ? -drag.x : -drag.y
                  const strength = exiting === dir ? 1 : clamp01(raw / DECIDE_THRESHOLD)
                  if (strength <= 0) return null
                  return (
                    <StampMark
                      key={dir}
                      decision={STAMP_META[dir]}
                      strength={strength}
                      slamming={exiting === dir}
                      className={STAMP_POSITION[STAMP_META[dir]]}
                    />
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* 责任边界提示（v0.9 M3①）：常驻轻标识，不弹窗打断批示流 */}
      <p className="minor-info px-4 pb-1.5 text-center text-[0.625rem] text-ink-mute">
        AI 生成内容仅供参考，采纳前请人工复核
      </p>

      {/* 决策栏（切入动画期间不渲染，避免批示到未展示的卡） */}
      {current && !intro && (
        <footer className="pb-[max(28px,env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-center gap-8">
            <button
              onClick={() => handleDecide('left')}
              className="group flex flex-col items-center gap-1.5"
              aria-label="跳过"
            >
              <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full border border-line bg-surface text-ink-soft shadow-soft transition-all group-hover:-rotate-12 group-hover:border-coral/50 group-hover:text-coral group-active:scale-90">
                <X size={20} />
              </span>
              <span className="text-[0.6875rem] text-ink-mute">跳过</span>
            </button>
            <button
              onClick={() => handleDecide('up')}
              className="group flex flex-col items-center gap-1.5"
              aria-label="收藏"
            >
              <span className="flex h-[58px] w-[58px] items-center justify-center rounded-full border border-line bg-surface text-amber shadow-soft transition-all group-hover:-translate-y-1 group-hover:border-amber/60 group-active:scale-90">
                <Star size={22} />
              </span>
              <span className="text-[0.6875rem] text-ink-mute">收藏</span>
            </button>
            <button
              onClick={() => handleDecide('right')}
              className="group flex flex-col items-center gap-1.5"
              aria-label="采纳"
              data-testid="adopt-btn"
            >
              <span className="flex h-[58px] w-[58px] items-center justify-center rounded-full bg-primary text-white shadow-pop transition-all group-hover:translate-y-0.5 group-hover:bg-primary-deep group-active:scale-90">
                <Check size={22} />
              </span>
              <span className="text-[0.6875rem] font-medium text-primary">
                {focusMode ? '采纳（后台执行）' : '采纳执行'}
              </span>
            </button>
          </div>
          <p className="minor-info mt-4 flex items-center justify-center gap-3 text-[0.6875rem] text-ink-mute">
            <span className="inline-flex items-center gap-1"><ArrowLeft size={11} /> 跳过</span>
            <span className="inline-flex items-center gap-1"><ArrowUp size={11} /> 收藏</span>
            <span className="inline-flex items-center gap-1"><ArrowRight size={11} /> 采纳</span>
            <span>· 支持拖拽滑卡</span>
            <span className="hidden md:inline">· 点击已盖章卡片可拖回重批</span>
          </p>
        </footer>
      )}

      {/* 首次进入操作说明 */}
      {guideOpen && (
        <GuideDialog
          stage="briefing"
          onClose={() => {
            setGuideOpen(false)
            markGuideSeen()
          }}
        />
      )}

      {/* 导入文档（v0.9 M6②，原成绩 CSV 导入改造更名）：文档原文作为附件材料直通 LLM 上下文 */}
      {importOpen && (
        <ImportDocumentDialog
          onClose={() => setImportOpen(false)}
          onImported={() => {
            if (role) void loadDeck(role)
          }}
        />
      )}

      {/* 重新生成弹窗（v0.8.4）：确认后按选项重置并重载卡组 */}
      {regenOpen && <RegenerateDialog onClose={() => setRegenOpen(false)} onConfirm={handleRegenerate} />}

      {/* 后台任务浮层（v0.8.1）：批示过程中随时查看任务明细与状态 */}
      {taskSheetOpen && (
        <FocusTaskSheet
          tasks={focusTasks}
          onClose={() => setTaskSheetOpen(false)}
          onEnterWorkbench={() => setStage('workbench')}
        />
      )}
    </div>
  )
}
