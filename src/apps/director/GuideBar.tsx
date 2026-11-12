/**
 * 导演引导条（v1 原型）
 *
 * 「少字」策略：一次只给一句话；目标元素用呼吸光圈提示；自动推进、可跳过。
 * 步骤切屏时先切屏再等一帧定位目标，避免引导指向不存在的元素。
 */
import { useEffect, useRef } from 'react'
import { ArrowRight, X } from 'lucide-react'
import { GUIDE_STEPS } from '../../harness/director/data'
import { useDirectorStore } from '../../stores/directorStore'
import { cn } from '../../lib/cn'

const STEP_MS = 4200

export default function GuideBar() {
  const active = useDirectorStore((s) => s.guideActive)
  const step = useDirectorStore((s) => s.guideStep)
  const nextGuide = useDirectorStore((s) => s.nextGuide)
  const closeGuide = useDirectorStore((s) => s.closeGuide)
  const setScreen = useDirectorStore((s) => s.setScreen)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!active) return
    const current = GUIDE_STEPS[step]
    if (!current) return
    if (useDirectorStore.getState().screen !== current.screen) setScreen(current.screen)

    let ringed: HTMLElement | null = null
    const locate = window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(current.target)
      if (target) {
        ringed = target
        target.classList.add('d-guide-ring')
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 180)

    timer.current = window.setTimeout(() => nextGuide(GUIDE_STEPS.length), STEP_MS)

    return () => {
      window.clearTimeout(locate)
      window.clearTimeout(timer.current)
      ringed?.classList.remove('d-guide-ring')
    }
  }, [active, step, nextGuide, setScreen])

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
    <div className="pointer-events-none fixed inset-x-0 bottom-[5.75rem] z-40 flex justify-center px-4 sm:bottom-24">
      <div className="pointer-events-auto d-rise flex items-center gap-3 rounded-full border border-line bg-surface/90 py-2 pl-4 pr-2 shadow-card backdrop-blur-xl">
        <span className="d-dot h-1.5 w-1.5 rounded-full bg-primary" />
        <button
          type="button"
          onClick={() => nextGuide(GUIDE_STEPS.length)}
          className="max-w-[62vw] truncate text-left text-[0.8125rem] font-medium text-ink transition-colors hover:text-primary sm:max-w-none"
          title="点击继续"
        >
          {current.hint}
        </button>
        <span className="flex items-center gap-1" aria-hidden>
          {GUIDE_STEPS.map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-1 rounded-full transition-all duration-500',
                i === step ? 'w-4 bg-primary/70' : 'w-1 bg-ink-mute/30',
              )}
            />
          ))}
        </span>
        <button
          type="button"
          aria-label="下一步"
          title="下一步"
          onClick={() => nextGuide(GUIDE_STEPS.length)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary-soft text-primary transition-transform hover:translate-x-0.5"
        >
          <ArrowRight size={13} strokeWidth={2.2} />
        </button>
        <button
          type="button"
          aria-label="跳过引导"
          title="跳过引导"
          onClick={closeGuide}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  )
}
