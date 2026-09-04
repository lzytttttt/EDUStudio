import { useCallback, useEffect, useRef, useState } from 'react'
import {
  X, Star, Check, Sparkles, ArrowLeft, ArrowUp, ArrowRight, LayoutDashboard, RotateCcw,
} from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useBriefingStore } from '../../stores/briefingStore'
import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { getRolePreset } from '../../harness/roles'
import BriefingCardView from './BriefingCardView'
import GuideDialog from '../../components/GuideDialog'
import { cn } from '../../lib/cn'

type Direction = 'left' | 'up' | 'right'

const EXIT_MS = 340
const DECIDE_THRESHOLD = 110
const DRAG_START_THRESHOLD = 6

/** 飞出位移：在当前拖拽位置基础上继续飞出舞台，避免先弹回中心再飞出的跳变 */
const EXIT_OFFSET: Record<Direction, { x: number; y: number; rotate: number }> = {
  left: { x: -560, y: 70, rotate: -18 },
  right: { x: 560, y: 70, rotate: 18 },
  up: { x: 0, y: -660, rotate: 0 },
}

const STAMP_META: Record<Direction, { text: string; tone: string; position: string }> = {
  left: { text: '跳过', tone: 'border-coral text-coral', position: 'left-5 top-5 -rotate-12' },
  up: { text: '收藏', tone: 'border-amber text-amber', position: 'left-1/2 top-6 -translate-x-1/2 -rotate-3' },
  right: { text: '采纳', tone: 'border-primary text-primary', position: 'right-5 top-5 rotate-12' },
}

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1)

export default function BriefingPage() {
  const role = useAuthStore((s) => s.role)
  const setStage = useAuthStore((s) => s.setStage)
  const { cards, decisions, processed, loadDeck, decide, resetDeck } = useBriefingStore()
  const sendMessage = useChatStore((s) => s.sendMessage)

  const [exiting, setExiting] = useState<Direction | null>(null)
  const [drag, setDrag] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  // 首次进入简报：自动弹出操作说明（v0.3 UI 专项）
  const guideSeen = useSettingsStore((s) => s.guideSeen)
  const markGuideSeen = useSettingsStore((s) => s.markGuideSeen)
  const [guideOpen, setGuideOpen] = useState(!guideSeen)
  const pointerStart = useRef<{ x: number; y: number } | null>(null)
  const suppressClick = useRef(false)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (role) loadDeck(role)
  }, [role, loadDeck])

  const visible = cards.filter((c) => !decisions[c.id])
  const current = visible[0]
  const total = cards.length

  const handleDecide = useCallback(
    (direction: Direction) => {
      if (!current || exiting) return
      setExiting(direction)
      const card = current
      window.setTimeout(() => {
        const decided = decide(card.id, direction === 'up' ? 'fav' : direction === 'right' ? 'accept' : 'skip')
        setExiting(null)
        setDrag({ x: 0, y: 0 })
        setDragging(false)
        if (direction === 'right' && decided?.action?.kind === 'openTask') {
          void sendMessage(decided.action.goal)
          setStage('workbench')
        }
      }, EXIT_MS)
    },
    [current, exiting, decide, sendMessage, setStage],
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

  /* 卡片变换：拖拽跟手 → 过阈值飞出 / 未过阈值回弹 */
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
            transform: `translate3d(${drag.x}px, ${drag.y}px, 0) rotate(${drag.x * 0.05}deg) scale(1.02)`,
            transition: 'none',
          }
        : {
            transform: 'translate3d(0, 0, 0) scale(1)',
            transition: 'transform 420ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          }
      : undefined

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg">
      {/* 顶部进度栏 */}
      <header className="flex items-center justify-between px-6 pt-5 md:px-10">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-white">
            <Sparkles size={15} />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">今日简报</p>
            <p className="text-[11px] text-ink-mute">
              2026 年 9 月 4 日 · {preset?.name ?? '访客'} · 已处理 {processed}/{total}
            </p>
          </div>
        </div>
        <button
          onClick={() => setStage('workbench')}
          className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:border-primary/50 hover:text-primary"
        >
          <LayoutDashboard size={13} />
          跳过简报，直接进入工作台
        </button>
      </header>
      <div className="mx-6 mt-3 h-1 overflow-hidden rounded-full bg-line md:mx-10">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${total ? (processed / total) * 100 : 0}%` }}
        />
      </div>

      {/* 卡片舞台 */}
      <main className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-6">
        {!current ? (
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
                onClick={() => {
                  resetDeck()
                  if (role) loadDeck(role)
                }}
                className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-5 py-2.5 text-sm font-medium text-ink-soft transition-colors hover:border-primary/50 hover:text-primary"
              >
                <RotateCcw size={14} />
                重新过一遍
              </button>
            </div>
          </div>
        ) : (
          <div className="relative h-full max-h-[560px] w-full max-w-[420px]">
            {/* 底部堆叠预览 */}
            {visible[2] && (
              <div className="absolute inset-x-3 bottom-2 top-5 scale-[0.94] rounded-[28px] border border-line bg-surface opacity-40" />
            )}
            {visible[1] && (
              <div className="absolute inset-x-1.5 bottom-1 top-2.5 scale-[0.97] rounded-[28px] border border-line bg-surface opacity-70 shadow-card-next" />
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
                <BriefingCardView card={current} />
                {/* 方向印章：随拖拽力度淡入，飞出时满强度跟随 */}
                {(['left', 'up', 'right'] as Direction[]).map((dir) => {
                  const raw = dir === 'right' ? drag.x : dir === 'left' ? -drag.x : -drag.y
                  const strength = exiting === dir ? 1 : clamp01(raw / DECIDE_THRESHOLD)
                  if (strength <= 0) return null
                  const meta = STAMP_META[dir]
                  return (
                    <div
                      key={dir}
                      style={{ opacity: strength, transform: `scale(${0.85 + strength * 0.15})` }}
                      className={cn(
                        'pointer-events-none absolute z-10 flex h-16 w-16 items-center justify-center rounded-2xl border-[3px] bg-white/85 text-lg font-black tracking-widest shadow-pop backdrop-blur-sm',
                        meta.tone,
                        meta.position,
                      )}
                    >
                      {meta.text}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* 决策栏 */}
      {current && (
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
              <span className="text-[11px] text-ink-mute">跳过</span>
            </button>
            <button
              onClick={() => handleDecide('up')}
              className="group flex flex-col items-center gap-1.5"
              aria-label="收藏"
            >
              <span className="flex h-[58px] w-[58px] items-center justify-center rounded-full border border-line bg-surface text-amber shadow-soft transition-all group-hover:-translate-y-1 group-hover:border-amber/60 group-active:scale-90">
                <Star size={22} />
              </span>
              <span className="text-[11px] text-ink-mute">收藏</span>
            </button>
            <button
              onClick={() => handleDecide('right')}
              className="group flex flex-col items-center gap-1.5"
              aria-label="采纳"
            >
              <span className="flex h-[58px] w-[58px] items-center justify-center rounded-full bg-primary text-white shadow-pop transition-all group-hover:translate-y-0.5 group-hover:bg-primary-deep group-active:scale-90">
                <Check size={22} />
              </span>
              <span className="text-[11px] font-medium text-primary">采纳执行</span>
            </button>
          </div>
          <p className="mt-4 flex items-center justify-center gap-3 text-[11px] text-ink-mute">
            <span className="inline-flex items-center gap-1"><ArrowLeft size={11} /> 跳过</span>
            <span className="inline-flex items-center gap-1"><ArrowUp size={11} /> 收藏</span>
            <span className="inline-flex items-center gap-1"><ArrowRight size={11} /> 采纳</span>
            <span>· 支持拖拽滑卡</span>
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
    </div>
  )
}
