/**
 * v1.2 M0 · ConcurrencyGovernor 单测（roadmap §4.2 调度语义）
 * 覆盖：limit 并发 / 同优先级 FIFO / 前台优先插队 / release 幂等 / run 抛错释放 / pending 计数 / limit 可配
 */
import { describe, expect, it } from 'vitest'
import { createConcurrencyGovernor, DEFAULT_CONCURRENCY_LIMIT } from '../studio/concurrency'

/** 让出一轮宏任务，确保队列/微任务都已落定 */
const flushTasks = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('ConcurrencyGovernor（v1.2 M0）', () => {
  it('默认并发上限为 2：第三个申请者排队，释放后才获得许可', async () => {
    const gov = createConcurrencyGovernor()
    expect(DEFAULT_CONCURRENCY_LIMIT).toBe(2)

    const releaseA = await gov.acquire()
    const releaseB = await gov.acquire()
    expect(gov.pending()).toEqual({ foreground: 0, background: 0, active: 2 })

    let thirdGranted = false
    const third = gov.acquire('background').then((release) => {
      thirdGranted = true
      return release
    })
    await flushTasks()
    expect(thirdGranted).toBe(false)
    expect(gov.pending()).toEqual({ foreground: 0, background: 1, active: 2 })

    releaseA()
    const releaseC = await third
    expect(thirdGranted).toBe(true)
    expect(gov.pending()).toEqual({ foreground: 0, background: 0, active: 2 })

    releaseB()
    releaseC()
    expect(gov.pending()).toEqual({ foreground: 0, background: 0, active: 0 })
  })

  it('同优先级 FIFO：limit=1 时先后台申请按入队顺序授予', async () => {
    const gov = createConcurrencyGovernor({ limit: 1 })
    const order: string[] = []

    const releaseFirst = await gov.acquire('background')
    const second = gov.acquire('background').then((release) => {
      order.push('second')
      return release
    })
    const third = gov.acquire('background').then((release) => {
      order.push('third')
      return release
    })

    await flushTasks()
    expect(order).toEqual([])

    releaseFirst()
    const releaseSecond = await second
    expect(order).toEqual(['second'])

    releaseSecond()
    const releaseThird = await third
    expect(order).toEqual(['second', 'third'])
    releaseThird()
    expect(gov.pending()).toEqual({ foreground: 0, background: 0, active: 0 })
  })

  it('前台优先于已排队的后台：释放一个许可时前台插队', async () => {
    const gov = createConcurrencyGovernor({ limit: 1 })
    const order: string[] = []

    const releaseRunning = await gov.acquire('foreground')
    const background = gov.acquire('background').then((release) => {
      order.push('background')
      return release
    })
    const foreground = gov.acquire('foreground').then((release) => {
      order.push('foreground')
      return release
    })

    await flushTasks()
    expect(order).toEqual([])

    releaseRunning()
    const releaseForeground = await foreground
    expect(order).toEqual(['foreground'])
    expect(gov.pending()).toEqual({ foreground: 0, background: 1, active: 1 })

    releaseForeground()
    const releaseBackground = await background
    expect(order).toEqual(['foreground', 'background'])
    releaseBackground()
    expect(gov.pending()).toEqual({ foreground: 0, background: 0, active: 0 })
  })

  it('release 幂等：重复调用不重复释放、不超额授予', async () => {
    const gov = createConcurrencyGovernor({ limit: 1 })
    const releaseFirst = await gov.acquire('foreground')
    const second = gov.acquire('background')
    await flushTasks()

    releaseFirst()
    const releaseSecond = await second
    expect(gov.pending().active).toBe(1)

    // 重复释放不应让 active 归零（否则会多授予许可）
    releaseFirst()
    releaseFirst()
    expect(gov.pending()).toEqual({ foreground: 0, background: 0, active: 1 })

    releaseSecond()
    releaseSecond()
    expect(gov.pending()).toEqual({ foreground: 0, background: 0, active: 0 })
  })

  it('run 抛错时仍释放许可，后续任务可继续执行', async () => {
    const gov = createConcurrencyGovernor({ limit: 1 })

    await expect(
      gov.run('foreground', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(gov.pending()).toEqual({ foreground: 0, background: 0, active: 0 })

    const value = await gov.run('background', async () => 42)
    expect(value).toBe(42)
    expect(gov.pending()).toEqual({ foreground: 0, background: 0, active: 0 })
  })

  it('run 遵守并发上限：前两个任务在办时第三个排队，结束后依次执行', async () => {
    const gov = createConcurrencyGovernor()
    const gates: Array<() => void> = []
    const started: string[] = []

    const task = (name: string) => async () => {
      started.push(name)
      await new Promise<void>((resolve) => gates.push(resolve))
      return name
    }

    const p1 = gov.run('background', task('a'))
    const p2 = gov.run('background', task('b'))
    const p3 = gov.run('background', task('c'))
    await flushTasks()

    expect(started).toEqual(['a', 'b'])
    expect(gov.pending()).toEqual({ foreground: 0, background: 1, active: 2 })

    gates[0]()
    await flushTasks()
    expect(started).toEqual(['a', 'b', 'c'])
    expect(gov.pending()).toEqual({ foreground: 0, background: 0, active: 2 })
    expect(await p1).toBe('a')

    gates[1]()
    await flushTasks()
    expect(await p2).toBe('b')

    gates[2]()
    await flushTasks()
    expect(await p3).toBe('c')
    expect(gov.pending()).toEqual({ foreground: 0, background: 0, active: 0 })
  })

  it('limit 可配：limit=1 串行、limit=3 可三任务并发', async () => {
    const serial = createConcurrencyGovernor({ limit: 1 })
    const r1 = await serial.acquire()
    let secondGranted = false
    const p2 = serial.acquire().then((release) => {
      secondGranted = true
      return release
    })
    await flushTasks()
    expect(secondGranted).toBe(false)
    r1()
    const r2 = await p2
    r2()
    expect(serial.pending()).toEqual({ foreground: 0, background: 0, active: 0 })

    const wide = createConcurrencyGovernor({ limit: 3 })
    const releases = await Promise.all([wide.acquire(), wide.acquire(), wide.acquire()])
    expect(wide.pending().active).toBe(3)
    releases.forEach((release) => release())
    expect(wide.pending().active).toBe(0)
  })

  it('pending 计数区分前台/后台排队数，且非法 limit 归一为 1', async () => {
    const gov = createConcurrencyGovernor({ limit: 0 })
    const releaseFirst = await gov.acquire('foreground')
    let secondGranted = false
    const second = gov.acquire('background').then((release) => {
      secondGranted = true
      return release
    })
    await flushTasks()
    expect(secondGranted).toBe(false)
    expect(gov.pending()).toEqual({ foreground: 0, background: 1, active: 1 })

    releaseFirst()
    const releaseSecond = await second
    expect(gov.pending()).toEqual({ foreground: 0, background: 0, active: 1 })
    releaseSecond()
    expect(gov.pending()).toEqual({ foreground: 0, background: 0, active: 0 })
  })
})
