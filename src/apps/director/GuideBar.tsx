/**
 * 导演引导条（v1 原型 → v1.1 引导升级）
 *
 * 「少字」策略：一次只给一句话；目标元素用呼吸光圈提示；自动推进、可跳过。
 *
 * v1.1 P0/P1（roadmap §7.1 V8 / 研究 02 §2.3）：
 * - 切屏时先 setScreen，再等 d-fade 过渡（director.css 420ms）结束才定位光圈，防跳位；
 * - 目标在空态下不存在（如 idle 时的任务条）→ 自动跳到下一步，任一步都不空指；
 * - 悬停 / 聚焦时暂停自动推进，离开后从当前步重新计时；自动推进 6000ms；
 * - 点击被高亮的目标即视为「已看到」，立即推进（目标本身动作照常执行）；
 * - 跳过走 store.closeGuide（写 seen）；「?」重看走 startGuide(true)，store 语义不改、不写 seen。
 */
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, X } from 'lucide-react'
import { GUIDE_STEPS } from '../../harness/director/data'
import { useDirectorStore } from '../../stores/directorStore'
import { cn } from '../../lib/cn'

/** 自动推进：6s（原 4.2s），悬停/聚焦暂停 */
const GUIDE_AUTO_MS = 6000
/** 切屏后等 d-fade（420ms）结束再定位光圈；+30ms 余量防末帧跳位 */
const SCREEN_FADE_MS = 450
/** 同屏内换步：只等一档 160ms，避免光圈闪烁 */
const SAME_SCREEN_MS = 160

/** 尊重「减弱动效」：滚动定位不做平滑动画 */
function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

export default function GuideBar() {
  const active = useDirectorStore((s) => s.guideActive)
  const step = useDirectorStore((s) => s.guideStep)
  const nextGuide = useDirectorStore((s) => s.nextGuide)
  const closeGuide = useDirectorStore((s) => s.closeGuide)
  const setScreen = useDirectorStore((s) => s.setScreen)
  /* 悬停 / 聚焦时暂停自动推进；离开后重新计时 */
  const [paused, setPaused] = useState(false)
  const ringTimer = useRef<number | undefined>(undefined)
  const autoTimer = useRef<number | undefined>(undefined)
  const ringed = useRef<HTMLElement | null>(null)
  const total = GUIDE_STEPS.length

  /* 定位光圈：切屏 → 等 d-fade 结束；同屏 → 160ms；空目标自动跳步 */
  useEffect(() => {
    if (!active) return
    const current = GUIDE_STEPS[step]
    if (!current) return
    const screenChanged = useDirectorStore.getState().screen !== current.screen
    if (screenChanged) setScreen(current.screen)

    let cancelled = false
    const advance = () => nextGuide(total)
    ringTimer.current = window.setTimeout(() => {
      if (cancelled) return
      const target = document.querySelector<HTMLElement>(current.target)
      if (!target) {
        /* 空目标自动跳步：任一步都不空指（如 mission-strip 在 idle 时不存在） */
        advance()
        return
      }
      ringed.current = target
      target.classList.add('d-guide-ring')
      target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' })
      /* 点击高亮目标即推进（once：避免同一目标多次触发） */
      target.addEventListener('click', advance, { once: true })
    }, screenChanged ? SCREEN_FADE_MS : SAME_SCREEN_MS)

    return () => {
      cancelled = true
      window.clearTimeout(ringTimer.current)
      const el = ringed.current
      if (el) {
        el.classList.remove('d-guide-ring')
        el.removeEventListener('click', advance)
      }
      ringed.current = null
    }
  }, [active, step, nextGuide, setScreen, total])

  /* 自动推进：暂停 / 切步重置计时；最后一步后 nextGuide 收尾关闭（现有 store 语义） */
  useEffect(() => {
    if (!active || paused) return
    autoTimer.current = window.setTimeout(() => nextGuide(total), GUIDE_AUTO_MS)
    return () => window.clearTimeout(autoTimer.current)
  }, [active, paused, step, nextGuide, total])

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeGuide()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, closeGuide])

  if (!active) return null
  const current = GUIDE_STEPS[step]
  if (!current) return null

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[5.75rem] z-40 flex justify-center px-4 sm:bottom-24"
      data-testid="director-guide"
    >
      <div
        className="pointer-events-auto d-rise flex items-center gap-2 rounded-full border border-line bg-surface/90 py-1.5 pl-4 pr-2 shadow-card backdrop-blur-xl"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={(e) => {
          /* 焦点移出整个引导条才恢复自动推进 */
          const next = e.relatedTarget
          if (!(next instanceof Node) || !e.currentTarget.contains(next)) setPaused(false)
        }}
      >
        <span aria-hidden className="d-dot h-1.5 w-1.5 rounded-full bg-primary" />
        <button
          type="button"
          onClick={() => nextGuide(total)}
          className="max-w-[62vw] truncate rounded-full text-left text-[0.8125rem] font-medium text-ink transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg sm:max-w-none"
          title="点击继续"
        >
          {current.hint}
        </button>
        <span className="flex items-center gap-1" aria-hidden>
          {GUIDE_STEPS.map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-1 rounded-full transition-all duration-300',
                i === step ? 'w-4 bg-primary/70' : 'w-1 bg-ink-mute/30',
              )}
            />
          ))}
        </span>
        <button
          type="button"
          aria-label="下一步"
          title="下一步"
          onClick={() => nextGuide(total)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary-soft text-primary transition-transform hover:translate-x-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <ArrowRight size={14} strokeWidth={2.2} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="跳过引导"
          title="跳过引导"
          onClick={closeGuide}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <X size={14} aria-hidden />
        </button>
      </div>
    </div>
  )
}
