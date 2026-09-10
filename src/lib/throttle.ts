import { useEffect, useRef, useState } from 'react'

/**
 * 流式渲染节流工具（v0.9.3 P0-D）：
 * ① `createStreamBuffer`——同帧多个 chunk 合并为一次下游写入，`finalize` / 中断前 flush 不丢内容；
 * ② `useThrottledValue`——流式期间按时间窗合并刷新 + 尾帧补齐，收敛（非流式）时直通原值。
 * 调度器与纯判定分离，逻辑可单测（见 `__tests__/throttle.test.ts`）。
 */

/** 节流判定（纯函数）：距上次刷新不足窗口时返回尾帧延迟毫秒，否则返回 0 = 立即刷新 */
export function throttleDelay(elapsed: number, windowMs: number): number {
  return elapsed >= windowMs ? 0 : windowMs - elapsed
}

export interface FrameScheduler {
  schedule: (run: () => void) => unknown
  cancel: (handle: unknown) => void
}

const HAS_RAF = typeof requestAnimationFrame === 'function'

/** 默认调度器：rAF 优先（同帧合并）；无 rAF 环境（单测 / 降级）退化为 16ms 定时 */
export const frameScheduler: FrameScheduler = HAS_RAF
  ? {
      schedule: (run) => requestAnimationFrame(() => run()),
      cancel: (handle) => cancelAnimationFrame(handle as number),
    }
  : {
      schedule: (run) => setTimeout(run, 16),
      cancel: (handle) => clearTimeout(handle as number),
    }

export interface StreamBuffer<T> {
  /** 累积一条并调度刷新（同一帧内多次 push 只写一次） */
  push: (item: T) => void
  /** 立即写出并取消待刷新帧（finalize / 中断 / 卸载前调用） */
  flush: () => void
  /** 待写出条数（诊断 / 单测） */
  readonly pendingCount: number
}

/** chunk 批处理缓冲：push 累积，同帧一次 apply */
export function createStreamBuffer<T>(apply: (items: T[]) => void, scheduler: FrameScheduler = frameScheduler): StreamBuffer<T> {
  let pending: T[] = []
  let handle: unknown = null

  const emit = () => {
    if (!pending.length) return
    const items = pending
    pending = []
    apply(items)
  }

  return {
    push(item) {
      pending.push(item)
      if (handle === null) {
        handle = scheduler.schedule(() => {
          handle = null
          emit()
        })
      }
    },
    flush() {
      if (handle !== null) {
        scheduler.cancel(handle)
        handle = null
      }
      emit()
    },
    get pendingCount() {
      return pending.length
    },
  }
}

/**
 * 值节流（P0-D①）：`enabled` 时按 `windowMs` 时间窗合并刷新，尾帧补齐最新值；
 * `enabled=false`（生成收敛 / 编辑态）直通原值，保证 finalize 全量渲染一次、编辑零延迟。
 */
export function useThrottledValue<T>(value: T, windowMs: number, enabled = true): T {
  const [throttled, setThrottled] = useState(value)
  const lastFlushRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestRef = useRef(value)
  latestRef.current = value

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      lastFlushRef.current = Date.now()
      setThrottled(value)
      return
    }
    const delay = throttleDelay(Date.now() - lastFlushRef.current, windowMs)
    if (delay <= 0) {
      lastFlushRef.current = Date.now()
      setThrottled(value)
      return
    }
    /* 尾帧已在路上：由它读取最新值，避免每个 chunk 都排一个定时器 */
    if (timerRef.current !== null) return
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      lastFlushRef.current = Date.now()
      setThrottled(latestRef.current)
    }, delay)
  }, [value, windowMs, enabled])

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    },
    [],
  )

  return enabled ? throttled : value
}
