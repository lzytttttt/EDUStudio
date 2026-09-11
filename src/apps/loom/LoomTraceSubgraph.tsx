/**
 * Loom 任务节点展开子图（v0.9.4 M6）
 *
 * 把 `projectTrace` 的结果（plan / tool / result / artifact / reflect）用横向小节点 + 连接线
 * 画在任务卡内，最多 LOOM_TRACE_MAX_ITEMS 项，超出显示「+N 步」。
 *
 * - 纯展示：运行态 amber 呼吸点、完成 mint、失败 danger；
 * - 视觉走浅色纸感 token（rounded-lg / border-line / bg-white/70），配色仅作状态修饰；
 * - 尊重 prefers-reduced-motion：弱动效偏好下关闭呼吸动画。
 */
import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { LOOM_TRACE_MAX_ITEMS, type LoomTraceItem, type LoomTraceStatus } from './loomProjection'
import { cn } from '../../lib/cn'

/** 弱动效偏好（与 v0.9.3 KeptBriefingCards 同款判定） */
export function useReducedMotion(): boolean {
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

const STATUS_CHIP: Record<LoomTraceStatus, string> = {
  running: 'border-amber/40 bg-amber-soft/70',
  done: 'border-line bg-white/70',
  error: 'border-danger/30 bg-danger/5',
}

const STATUS_DOT: Record<LoomTraceStatus, string> = {
  running: 'bg-amber',
  done: 'bg-mint',
  error: 'bg-danger',
}

const STATUS_LABEL: Record<LoomTraceStatus, string> = {
  running: 'text-amber',
  done: 'text-ink-soft',
  error: 'text-danger',
}

interface LoomTraceSubgraphProps {
  items: LoomTraceItem[]
  className?: string
}

export function LoomTraceSubgraph({ items, className }: LoomTraceSubgraphProps) {
  const reduced = useReducedMotion()

  if (items.length === 0) {
    return <p className={cn('mt-2 text-[0.5625rem] text-ink-mute', className)}>暂无执行记录</p>
  }

  const shown = items.slice(0, LOOM_TRACE_MAX_ITEMS)
  const hidden = items.length - shown.length

  return (
    <div data-testid="loom-trace-subgraph" className={cn('mt-2 border-t border-line pt-1.5', className)}>
      <p className="text-[0.5625rem] font-medium text-ink-mute">执行轨迹</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-0.5 gap-y-1">
        {shown.map((item, i) => (
          <div key={item.id} className="flex items-center gap-0.5">
            {i > 0 && <ChevronRight size={9} className="shrink-0 text-ink-mute" aria-hidden />}
            <span
              data-testid="loom-trace-item"
              data-kind={item.kind}
              data-status={item.status}
              title={item.label}
              className={cn(
                'flex max-w-[5.5rem] items-center gap-1 rounded-lg border px-1.5 py-1',
                STATUS_CHIP[item.status],
              )}
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  STATUS_DOT[item.status],
                  item.status === 'running' && !reduced && 'animate-pulse',
                )}
              />
              <span className={cn('truncate text-[0.5625rem] leading-none', STATUS_LABEL[item.status])}>
                {item.label}
              </span>
            </span>
          </div>
        ))}
        {hidden > 0 && (
          <span
            data-testid="loom-trace-more"
            className="ml-0.5 rounded-lg border border-line bg-white/70 px-1.5 py-1 text-[0.5625rem] text-ink-mute"
          >
            +{hidden} 步
          </span>
        )}
      </div>
    </div>
  )
}
