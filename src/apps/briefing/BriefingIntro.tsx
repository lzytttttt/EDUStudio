import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { cn } from '../../lib/cn'

/**
 * 简报首次切入动画（v0.8.3）：
 * 表现「今日简报卡牌生成」的过程——三张卡牌自右下依次飞入落叠，
 * 每张落卡迸一圈光晕，顶卡星芒脉冲 + 微光扫过表达生成中，无任何文字；
 * 卡组就绪（ready）且保底时长走完后整体微缩淡出，交棒给真实卡组的入场动画。
 * 纯 transform/opacity 合成器友好动画；pointer-events-none 不拦截交互。
 */

/** 逐卡入叠编排：delay 飞入起始时刻 / rot 落定微倾角 / land 迸光时刻；几何对齐卡组堆叠层 */
const DEALS = [
  { delay: 0, rot: -5, land: 400, geo: 'inset-x-6 bottom-3 top-7', z: 'z-0', dim: 'opacity-40', top: false },
  { delay: 190, rot: 3, land: 590, geo: 'inset-x-3 bottom-1.5 top-3.5', z: 'z-10', dim: 'opacity-70', top: false },
  { delay: 380, rot: 0, land: 780, geo: 'inset-0', z: 'z-20', dim: '', top: true },
]

/** 顶卡落定迸出的碎粒：设计系统四色中的三色，向量经 CSS 变量注入 */
const BITS = [
  { cls: 'bg-primary', bx: '26px', by: '-20px' },
  { cls: 'bg-mint', bx: '-18px', by: '-26px' },
  { cls: 'bg-amber', bx: '8px', by: '-34px' },
]

/** 保底展示时长：末张卡落定 + 迸光收尾后再收场（就绪早于此也等齐） */
const MIN_MS = 1250
/** 收场淡出时长（对齐 tailwind intro-out） */
const OUT_MS = 300

export default function BriefingIntro({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false)
  const minDone = useRef(false)
  const readyRef = useRef(ready)
  readyRef.current = ready

  /* 弱动效偏好：不播动画，直接交棒 */
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) onDone()
  }, [onDone])

  /* 保底时长走完后若卡组已就绪则收场；就绪晚于保底（API 生成中）则循环微光等待 */
  useEffect(() => {
    const t = window.setTimeout(() => {
      minDone.current = true
      if (readyRef.current) setLeaving(true)
    }, MIN_MS)
    return () => window.clearTimeout(t)
  }, [])
  useEffect(() => {
    if (ready && minDone.current && !leaving) setLeaving(true)
  }, [ready, leaving])

  /* 淡出结束后交棒给真实卡组 */
  useEffect(() => {
    if (!leaving) return
    const t = window.setTimeout(onDone, OUT_MS + 40)
    return () => window.clearTimeout(t)
  }, [leaving, onDone])

  return (
    <div
      data-testid="briefing-intro"
      className={cn(
        'pointer-events-none absolute inset-0 z-30 flex items-center justify-center px-4 py-6',
        leaving && 'animate-intro-out',
      )}
      aria-hidden="true"
    >
      <div className="relative h-full max-h-[560px] w-full max-w-[420px]">
        {DEALS.map((d) => (
          <div
            key={d.delay}
            className={cn('absolute animate-intro-deal', d.geo, d.z)}
            style={{ animationDelay: `${d.delay}ms`, '--intro-rot': `${d.rot}deg` } as React.CSSProperties}
          >
            <div
              className={cn(
                'relative h-full w-full overflow-hidden rounded-[28px] border border-line bg-surface shadow-card',
                d.dim,
              )}
            >
              {/* 卡面骨架：生成中的简报内容条 */}
              <div className="flex h-full flex-col p-6">
                <div className="h-5 w-24 rounded-full bg-surface-2" />
                <div className="mt-6 h-7 w-4/5 rounded-lg bg-surface-2" />
                <div className="mt-3 space-y-2.5">
                  <div className="h-4 w-full rounded bg-surface-2" />
                  <div className="h-4 w-11/12 rounded bg-surface-2" />
                  <div className="h-4 w-2/3 rounded bg-surface-2" />
                </div>
                {d.top && (
                  /* 生成区：星芒脉冲 + 微光扫过，卡组就绪前持续循环 */
                  <div className="relative mt-auto flex h-24 items-center justify-center overflow-hidden rounded-2xl bg-primary-soft/70">
                    <Sparkles size={22} className="animate-pulse text-primary" style={{ animationDelay: '820ms' }} />
                    <span
                      className="absolute inset-y-0 w-1/3 animate-intro-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent"
                      style={{ animationDelay: '820ms' }}
                    />
                  </div>
                )}
              </div>
              {/* 落卡迸光：光晕扩散淡出（时刻对齐飞入落定） */}
              <span
                className="absolute right-5 top-5 h-16 w-16 animate-intro-spark rounded-full"
                style={{
                  background: 'radial-gradient(circle, rgb(var(--primary) / 0.4) 0%, transparent 70%)',
                  animationDelay: `${d.land}ms`,
                }}
              />
              {d.top &&
                BITS.map((b, i) => (
                  <span
                    key={b.cls}
                    className={cn('absolute right-10 top-9 h-1.5 w-1.5 animate-intro-bit rounded-full', b.cls)}
                    style={{
                      animationDelay: `${780 + i * 45}ms`,
                      '--intro-bx': b.bx,
                      '--intro-by': b.by,
                    } as React.CSSProperties}
                  />
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
