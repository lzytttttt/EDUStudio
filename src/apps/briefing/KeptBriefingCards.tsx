import { useCallback, useEffect, useRef, useState } from 'react'
import type { BriefingCard } from '../../harness/types'
import type { CardDecision } from '../../stores/briefingStore'
import BriefingCardView from './BriefingCardView'
import StampMark, { STAMP_POSITION } from './StampMark'

/**
 * 已处理简报保留层（v0.8.2，桌面端）：
 * 盖章后的卡片不直接消失——以甩飞初速度进入物理运动（无重力，仅空气阻力 + 四向边界碰撞反弹），
 * 途中缩小、半透明，动能耗尽后停在舞台内；点击/拖拽任意保留卡可取回重新批阅。
 * 仅 transform/opacity 合成器友好属性，rAF 直写 DOM 不触发 React 渲染。
 */

export interface KeptCardItem {
  card: BriefingCard
  decision: CardDecision
  /** 甩飞起点（相对舞台中心 px）：取拖拽末位置 + 飞出偏移，与离场动画无缝衔接 */
  x0: number
  y0: number
  rot0: number
  /** 初速度（px/s）与角速度（deg/s） */
  vx: number
  vy: number
  spin: number
}

/* 物理参数：无重力，仅空气阻力 + 四向边界碰撞，卡片在舞台内漂浮滑行至动能耗尽 */
const WALL_RESTITUTION = 0.6
const AIR_DRAG = 0.5
const SPIN_DRAG = 1.2
const SETTLE_SPEED = 34
const MAX_AGE_MS = 3600
const REST_SCALE = 0.55
const REST_OPACITY = 0.55
const RETURN_MS = 240

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
const rand = (a: number, b: number) => a + Math.random() * (b - a)

interface Phys {
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  spin: number
  scale: number
  opacity: number
  /** 出生时刻（性能时间线 ms） */
  born: number
  /** 已静止：不再参与物理循环，仅在 resize 时重新夹取 */
  settled: boolean
  /** 拖拽取回中：CSS 过渡飞回卡组，跳过物理与指针 */
  returning: boolean
}

/** 弱动效偏好：跳过物理，按底部槽位直接定格 */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

export default function KeptBriefingCards({
  items,
  onReturn,
}: {
  items: KeptCardItem[]
  onReturn: (cardId: string) => void
}) {
  const reduced = useReducedMotion()
  const layerRef = useRef<HTMLDivElement>(null)
  /** 卡片未缩放尺寸（碰撞体），按 cardId 缓存 */
  const sizeRef = useRef<Map<string, { hw: number; hh: number }>>(new Map())
  const wrapRef = useRef<Map<string, HTMLDivElement>>(new Map())
  const physRef = useRef<Map<string, Phys>>(new Map())
  const rafRef = useRef(0)
  const lastTsRef = useRef(0)
  /** 边界半尺寸（舞台 layer 的一半），resize 时刷新 */
  const boundsRef = useRef({ hw: 400, hh: 300 })
  /** 弱动效槽位分配 */
  const slotRef = useRef(0)
  const dragRef = useRef<{ id: string; startX: number; startY: number; baseX: number; baseY: number } | null>(null)

  const measure = useCallback(() => {
    const layer = layerRef.current
    if (!layer) return
    boundsRef.current = { hw: layer.clientWidth / 2, hh: layer.clientHeight / 2 }
  }, [])

  const writeTransform = useCallback((id: string, p: Phys) => {
    const el = wrapRef.current.get(id)
    if (el) {
      el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0) rotate(${p.rot.toFixed(2)}deg) scale(${p.scale.toFixed(3)})`
      el.style.opacity = p.opacity.toFixed(3)
    }
  }, [])

  /** 静止定格：夹回边界内、倾角收敛到 ±14° 内 */
  const settle = useCallback(
    (id: string, p: Phys) => {
      const size = sizeRef.current.get(id)
      const b = boundsRef.current
      if (size) {
        p.x = Math.max(-b.hw + size.hw * p.scale, Math.min(b.hw - size.hw * p.scale, p.x))
        p.y = Math.max(-b.hh + size.hh * p.scale, Math.min(b.hh - size.hh * p.scale, p.y))
      }
      p.rot = Math.max(-14, Math.min(14, ((((p.rot % 360) + 540) % 360) - 180)))
      p.vx = 0
      p.vy = 0
      p.spin = 0
      p.settled = true
      writeTransform(id, p)
    },
    [writeTransform],
  )

  /* 物理主循环：空气阻力（无重力）+ 四向边界碰撞，动能耗尽后定格 */
  useEffect(() => {
    const map = physRef.current
    items.forEach((item) => {
      if (map.has(item.card.id)) return
      const p: Phys = {
        x: item.x0,
        y: item.y0,
        vx: item.vx,
        vy: item.vy,
        rot: item.rot0,
        spin: item.spin,
        scale: 1,
        opacity: 0.05,
        born: performance.now(),
        settled: false,
        returning: false,
      }
      if (reduced) {
        /* 弱动效：跳过物理，按槽位铺在舞台下缘 */
        const b = boundsRef.current
        const slot = (slotRef.current++ % 5) - 2
        p.x = slot * (b.hw / 2.6) + rand(-12, 12)
        p.y = b.hh - 150
        p.rot = slot % 2 === 0 ? -7 : 6
        p.scale = REST_SCALE
        p.opacity = REST_OPACITY
        p.settled = true
      }
      map.set(item.card.id, p)
    })
    for (const id of [...map.keys()]) {
      if (!items.some((i) => i.card.id === id)) {
        map.delete(id)
        sizeRef.current.delete(id)
      }
    }
    const animating = [...map.values()].some((p) => !p.settled && !p.returning)
    if (!animating || reduced) {
      map.forEach((p, id) => writeTransform(id, p))
      return
    }
    const tick = (ts: number) => {
      const dt = Math.min((ts - (lastTsRef.current || ts)) / 1000, 0.032)
      lastTsRef.current = ts
      const b = boundsRef.current
      let live = false
      map.forEach((p, id) => {
        if (p.settled || p.returning) return
        const size = sizeRef.current.get(id)
        const hw = (size?.hw ?? 200) * p.scale
        const hh = (size?.hh ?? 260) * p.scale
        const age = ts - p.born
        /* 空气阻力：速度与角速度指数衰减，无重力不产生下坠 */
        const dragK = Math.max(0, 1 - AIR_DRAG * dt)
        p.vx *= dragK
        p.vy *= dragK
        p.spin *= Math.max(0, 1 - SPIN_DRAG * dt)
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.rot += p.spin * dt
        /* 四向边界碰撞：等弹性反弹，角速度随碰撞衰减 */
        if (p.x < -b.hw + hw) {
          p.x = -b.hw + hw
          p.vx = Math.abs(p.vx) * WALL_RESTITUTION
          p.spin *= 0.5
        } else if (p.x > b.hw - hw) {
          p.x = b.hw - hw
          p.vx = -Math.abs(p.vx) * WALL_RESTITUTION
          p.spin *= 0.5
        }
        if (p.y < -b.hh + hh) {
          p.y = -b.hh + hh
          p.vy = Math.abs(p.vy) * WALL_RESTITUTION
        } else if (p.y > b.hh - hh) {
          p.y = b.hh - hh
          p.vy = -Math.abs(p.vy) * WALL_RESTITUTION
        }
        /* 缩小与半透明：入场 320ms 渐显、850ms 缩至定格尺寸 */
        p.opacity = 0.05 + (REST_OPACITY - 0.05) * easeOutCubic(Math.min(1, age / 320))
        p.scale = 1 - (1 - REST_SCALE) * easeOutCubic(Math.min(1, age / 850))
        const done = Math.hypot(p.vx, p.vy) < SETTLE_SPEED || age > MAX_AGE_MS
        if (done) settle(id, p)
        else {
          live = true
          writeTransform(id, p)
        }
      })
      if (live) rafRef.current = requestAnimationFrame(tick)
      else rafRef.current = 0
    }
    lastTsRef.current = 0
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [items, reduced, settle, writeTransform])

  /* 窗口尺寸变化：刷新边界并把所有卡片（含已定格）夹回舞台内 */
  useEffect(() => {
    measure()
    const onResize = () => {
      measure()
      const b = boundsRef.current
      physRef.current.forEach((p, id) => {
        const size = sizeRef.current.get(id)
        const hw = (size?.hw ?? 200) * p.scale
        const hh = (size?.hh ?? 260) * p.scale
        p.x = Math.max(-b.hw + hw, Math.min(b.hw - hw, p.x))
        p.y = Math.max(-b.hh + hh, Math.min(b.hh - hh, p.y))
        writeTransform(id, p)
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [measure, writeTransform])

  /* 取回重新批阅：CSS 过渡飞回卡组中心（复原尺寸与透明度），落地后交还卡组 */
  const returnCard = useCallback(
    (id: string) => {
      const p = physRef.current.get(id)
      const el = wrapRef.current.get(id)
      if (!p || !el) {
        onReturn(id)
        return
      }
      p.returning = true
      el.style.transition = `transform ${RETURN_MS}ms cubic-bezier(0.32, 0, 0.4, 1), opacity ${RETURN_MS}ms ease`
      el.style.transform = 'translate3d(0, 0, 0) rotate(0deg) scale(1)'
      el.style.opacity = '1'
      window.setTimeout(() => onReturn(id), RETURN_MS + 20)
    },
    [onReturn],
  )

  const onPointerDown = (id: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    const p = physRef.current.get(id)
    const el = wrapRef.current.get(id)
    if (!p || !el || p.returning || e.button !== 0) return
    e.preventDefault()
    el.setPointerCapture?.(e.pointerId)
    dragRef.current = { id, startX: e.clientX, startY: e.clientY, baseX: p.x, baseY: p.y }
    /* 拿起：微放大提亮，盖过卡组 */
    p.scale = 0.78
    p.opacity = 0.95
    el.style.zIndex = '30'
    el.style.transition = 'none'
    writeTransform(id, p)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    const p = d ? physRef.current.get(d.id) : null
    if (!d || !p) return
    p.x = d.baseX + (e.clientX - d.startX)
    p.y = d.baseY + (e.clientY - d.startY)
    writeTransform(d.id, p)
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null
    const el = wrapRef.current.get(d.id)
    if (el) {
      el.style.zIndex = ''
      el.style.transition = ''
    }
    void e
    returnCard(d.id)
  }

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
      {items.map((item) => (
        <div
          key={item.card.id}
          ref={(el) => {
            if (el) wrapRef.current.set(item.card.id, el)
            else wrapRef.current.delete(item.card.id)
          }}
          onPointerDown={onPointerDown(item.card.id)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="group pointer-events-auto absolute inset-0 flex touch-none select-none items-center justify-center cursor-grab active:cursor-grabbing"
        >
          <div
            ref={(el) => {
              if (el && !sizeRef.current.has(item.card.id)) {
                sizeRef.current.set(item.card.id, { hw: el.offsetWidth / 2, hh: el.offsetHeight / 2 })
              }
            }}
            className="relative h-full max-h-[560px] w-full max-w-[420px]"
          >
            {/* 卡面只读：保留卡是整体拖拽面，交互在取回卡组后进行 */}
            <div className="pointer-events-none h-full">
              <BriefingCardView card={item.card} />
            </div>
            {/* 盖章定格：保留卡持续展示决策印章 */}
            <StampMark decision={item.decision} strength={1} className={STAMP_POSITION[item.decision]} />
            {/* hover 提示：可拖回重新批阅 */}
            <div className="pointer-events-none absolute inset-0 z-20 rounded-[28px] opacity-0 ring-2 ring-primary/50 transition-opacity group-hover:opacity-100" />
            <span className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 whitespace-nowrap rounded-full bg-ink/80 px-2.5 py-1 text-[0.625rem] font-medium text-white opacity-0 shadow-soft backdrop-blur transition-opacity group-hover:opacity-100">
              拖回重新批阅
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
