import { describe, expect, it, vi } from 'vitest'
import { createStreamBuffer, frameScheduler, throttleDelay, type FrameScheduler } from '../lib/throttle'

/**
 * v0.9.3 P0-D 流式渲染节流：帧调度被测试接管（不依赖 rAF / 真实计时），
 * 固化「同帧合并 / flush 不丢内容 / 尾帧补齐」三条语义。
 */

/** 手动调度器：把「帧」握在测试手里 */
function manualScheduler() {
  const queue: (() => void)[] = []
  const cancelled: unknown[] = []
  const scheduler: FrameScheduler = {
    schedule: (run) => {
      queue.push(run)
      return queue.length - 1
    },
    cancel: (handle) => {
      cancelled.push(handle)
      if (typeof handle === 'number') queue[handle] = () => {}
    },
  }
  return {
    scheduler,
    cancelled,
    runFrame: () => {
      for (const run of queue.splice(0)) run()
    },
  }
}

describe('throttleDelay（时间窗判定）', () => {
  it('距上次刷新已达窗口 → 0（立即刷新）', () => {
    expect(throttleDelay(100, 100)).toBe(0)
    expect(throttleDelay(250, 100)).toBe(0)
  })

  it('窗口内 → 返回尾帧剩余延迟', () => {
    expect(throttleDelay(0, 100)).toBe(100)
    expect(throttleDelay(40, 100)).toBe(60)
    expect(throttleDelay(99, 100)).toBe(1)
  })
})

describe('createStreamBuffer（chunk 批处理）', () => {
  it('同帧多次 push 合并为一次 apply，顺序与内容不丢', () => {
    const apply = vi.fn()
    const { scheduler, runFrame } = manualScheduler()
    const buf = createStreamBuffer<{ id: string; chunk: string }>(apply, scheduler)

    buf.push({ id: 'a', chunk: '1' })
    buf.push({ id: 'a', chunk: '2' })
    buf.push({ id: 'b', chunk: 'x' })
    expect(apply).not.toHaveBeenCalled()
    expect(buf.pendingCount).toBe(3)

    runFrame()
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply.mock.calls[0][0]).toEqual([
      { id: 'a', chunk: '1' },
      { id: 'a', chunk: '2' },
      { id: 'b', chunk: 'x' },
    ])
    expect(buf.pendingCount).toBe(0)
  })

  it('flush：立即写出并取消待刷新帧（finalize / 中断前调用不丢内容）', () => {
    const apply = vi.fn()
    const { scheduler, cancelled, runFrame } = manualScheduler()
    const buf = createStreamBuffer<string>(apply, scheduler)

    buf.push('partial')
    buf.flush()
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith(['partial'])
    expect(cancelled).toEqual([0])

    // 已取消的帧再跑也不会重复写出
    runFrame()
    expect(apply).toHaveBeenCalledTimes(1)
    expect(buf.pendingCount).toBe(0)
  })

  it('无待写内容时 flush 不产生空写；flush 后可重新调度', () => {
    const apply = vi.fn()
    const { scheduler, runFrame } = manualScheduler()
    const buf = createStreamBuffer<number>(apply, scheduler)

    buf.flush()
    expect(apply).not.toHaveBeenCalled()

    buf.push(1)
    buf.flush()
    buf.push(2)
    runFrame()
    expect(apply.mock.calls).toEqual([[[1]], [[2]]])
  })

  it('跨帧写入按帧分批（每帧一次 apply）', () => {
    const apply = vi.fn()
    const { scheduler, runFrame } = manualScheduler()
    const buf = createStreamBuffer<string>(apply, scheduler)

    buf.push('a')
    runFrame()
    buf.push('b')
    buf.push('c')
    runFrame()
    expect(apply.mock.calls).toEqual([[['a']], [['b', 'c']]])
  })
})

describe('frameScheduler', () => {
  it('调度后执行一次（rAF 或降级定时均可用）', async () => {
    const run = vi.fn()
    frameScheduler.schedule(run)
    await new Promise((r) => setTimeout(r, 60))
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('取消后不再执行', async () => {
    const run = vi.fn()
    const handle = frameScheduler.schedule(run)
    frameScheduler.cancel(handle)
    await new Promise((r) => setTimeout(r, 60))
    expect(run).not.toHaveBeenCalled()
  })
})
