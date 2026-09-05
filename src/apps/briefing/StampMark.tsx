import { useId } from 'react'
import { cn } from '../../lib/cn'

export type StampDecision = 'skip' | 'fav' | 'accept'

const STAMP_TEXT: Record<StampDecision, string> = { skip: '跳过', fav: '收藏', accept: '采纳' }

/** 印泥三色：跳过=珊瑚红 / 收藏=琥珀 / 采纳=靛蓝（对齐设计系统四色） */
const STAMP_COLOR: Record<StampDecision, { text: string; border: string; rgb: string }> = {
  skip: { text: 'text-coral', border: 'border-coral', rgb: 'var(--coral)' },
  fav: { text: 'text-amber', border: 'border-amber', rgb: 'var(--amber)' },
  accept: { text: 'text-primary', border: 'border-primary', rgb: 'var(--primary)' },
}

/** 定格倾角：真实盖章不会完全水平，微倾更自然 */
const REST_ROTATE: Record<StampDecision, number> = { skip: -8, fav: -3, accept: 8 }

/** 印面落位（v0.8.2）：决策 → 印章在卡片上的位置；BriefingPage 与 KeptBriefingCards 共用 */
export const STAMP_POSITION: Record<StampDecision, string> = {
  skip: 'left-5 top-5',
  fav: 'left-1/2 top-6 -translate-x-1/2',
  accept: 'right-5 top-5',
}

interface StampMarkProps {
  decision: StampDecision
  /** 拖拽预览强度 0-1（slamming 时忽略） */
  strength: number
  /** 决策触发：播放落章动画（高空砸下 → 过冲 → 回震 → 定格） */
  slamming?: boolean
  /** 印面小字日期，如「2026.09.04」；缺省取当天 */
  date?: string
  className?: string
}

export default function StampMark({ decision, strength, slamming = false, date, className }: StampMarkProps) {
  const filterId = useId()
  const color = STAMP_COLOR[decision]
  const rest = REST_ROTATE[decision]
  const dateText = date ?? new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '.')

  return (
    <div
      className={cn('pointer-events-none absolute z-10 h-[76px] w-[76px] select-none', className)}
      style={
        slamming
          ? undefined
          : { opacity: strength, transform: `scale(${0.85 + strength * 0.15}) rotate(${rest * strength}deg)` }
      }
      aria-hidden="true"
    >
      {/* 印泥晕圈：落章瞬间扩散淡出 */}
      {slamming && (
        <span
          className="absolute -inset-3 animate-stamp-ink rounded-full"
          style={{ background: `radial-gradient(circle, rgb(${color.rgb} / 0.35) 0%, transparent 70%)` }}
        />
      )}
      {/* 印章本体：SVG 位移滤镜制造印泥边缘毛糙 */}
      <div
        className={cn('relative h-full w-full', slamming && 'animate-stamp-slam')}
        style={{ filter: `url(#${filterId})` }}
      >
        {/* 双线印面：外框 3px + 内框 1px */}
        <div className={cn('flex h-full w-full flex-col items-center justify-center rounded-lg border-[3px]', color.border)}>
          <div className={cn('flex h-[calc(100%-8px)] w-[calc(100%-8px)] flex-col items-center justify-center rounded-md border', color.border)}>
            <span className={cn('text-[1.05rem] font-black leading-none tracking-[0.2em]', color.text)} style={{ fontFamily: '"Noto Serif SC", "Songti SC", serif' }}>
              {STAMP_TEXT[decision]}
            </span>
            <span className={cn('mt-1 text-[0.5rem] font-semibold leading-none tracking-wider', color.text)} style={{ opacity: 0.75 }}>
              {dateText}
            </span>
          </div>
        </div>
        {/* 印泥斑驳：径向渐变叠层模拟浓淡不均 */}
        <div
          className="absolute inset-0 rounded-lg"
          style={{
            background: [
              `radial-gradient(circle at 28% 30%, transparent 30%, rgb(var(--surface) / 0.5) 52%, transparent 60%)`,
              `radial-gradient(circle at 72% 68%, transparent 34%, rgb(var(--surface) / 0.42) 58%, transparent 66%)`,
              `radial-gradient(circle at 60% 22%, transparent 40%, rgb(var(--surface) / 0.3) 70%, transparent 78%)`,
            ].join(', '),
          }}
        />
      </div>
      {/* 静态滤镜定义（仅作用于 76px 小元素，开销可忽略） */}
      <svg className="absolute h-0 w-0" aria-hidden="true">
        <defs>
          <filter id={filterId}>
            <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.6" />
          </filter>
        </defs>
      </svg>
    </div>
  )
}
