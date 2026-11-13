/**
 * v1.2 M0 · StudioBus 同步事件总线单测（roadmap §3.4 / §3.10）
 * 覆盖：同步派发、注册顺序、退订、once、onAny、异常隔离、typed 先于 onAny、多实例隔离。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStudioBus, studioBus } from '../studio/bus'
import type { StudioEvent } from '../studio/contracts'

const started = (missionId: string): StudioEvent => ({ type: 'mission.started', missionId, execution: 'mock' })

describe('studioBus', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('同步派发：emit 返回时 handler 已执行，且收到同一事件对象', () => {
    const bus = createStudioBus()
    const event = started('m-1')
    const seen: StudioEvent[] = []
    bus.on('mission.started', (e) => seen.push(e))
    bus.emit(event)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toBe(event)
  })

  it('同一 type 的多个 handler 按注册顺序执行', () => {
    const bus = createStudioBus()
    const order: string[] = []
    bus.on('mission.started', () => order.push('a'))
    bus.on('mission.started', () => order.push('b'))
    bus.on('mission.started', () => order.push('c'))
    bus.emit(started('m-1'))
    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('on 返回退订函数，退订后不再收到事件', () => {
    const bus = createStudioBus()
    let calls = 0
    const off = bus.on('mission.started', () => calls++)
    bus.emit(started('m-1'))
    off()
    bus.emit(started('m-2'))
    expect(calls).toBe(1)
  })

  it('重复退订幂等（不抛错、不影响其他 handler）', () => {
    const bus = createStudioBus()
    let calls = 0
    const off = bus.on('mission.started', () => calls++)
    const off2 = bus.on('mission.started', () => calls++)
    off()
    off()
    bus.emit(started('m-1'))
    expect(calls).toBe(1)
    off2()
    bus.emit(started('m-2'))
    expect(calls).toBe(1)
  })

  it('once 只触发一次，再次 emit 不重复', () => {
    const bus = createStudioBus()
    const seen: string[] = []
    bus.once('mission.started', (e) => seen.push(e.missionId))
    bus.emit(started('m-1'))
    bus.emit(started('m-2'))
    expect(seen).toEqual(['m-1'])
  })

  it('once 的退订函数在触发前可取消', () => {
    const bus = createStudioBus()
    let calls = 0
    const off = bus.once('mission.started', () => calls++)
    off()
    bus.emit(started('m-1'))
    expect(calls).toBe(0)
  })

  it('onAny 收到所有类型事件，并按注册顺序执行', () => {
    const bus = createStudioBus()
    const types: string[] = []
    bus.onAny((e) => types.push(`first:${e.type}`))
    bus.onAny((e) => types.push(`second:${e.type}`))
    bus.emit(started('m-1'))
    bus.emit({ type: 'mission.delivered', missionId: 'm-1', artifactIds: [] })
    expect(types).toEqual([
      'first:mission.started',
      'second:mission.started',
      'first:mission.delivered',
      'second:mission.delivered',
    ])
  })

  it('onAny 返回的退订函数生效', () => {
    const bus = createStudioBus()
    let calls = 0
    const off = bus.onAny(() => calls++)
    bus.emit(started('m-1'))
    off()
    bus.emit(started('m-2'))
    expect(calls).toBe(1)
  })

  it('单个 handler 抛错被隔离：其余 handler 仍执行，emit 不抛，console.error 记录', () => {
    const bus = createStudioBus()
    const order: string[] = []
    bus.on('mission.started', () => order.push('before'))
    bus.on('mission.started', () => {
      throw new Error('boom')
    })
    bus.on('mission.started', () => order.push('after'))
    expect(() => bus.emit(started('m-1'))).not.toThrow()
    expect(order).toEqual(['before', 'after'])
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('onAny handler 抛错同样隔离，不影响 typed handler 与后续 onAny', () => {
    const bus = createStudioBus()
    let typedCalls = 0
    let afterCalls = 0
    bus.on('mission.started', () => typedCalls++)
    bus.onAny(() => {
      throw new Error('any-boom')
    })
    bus.onAny(() => afterCalls++)
    expect(() => bus.emit(started('m-1'))).not.toThrow()
    expect(typedCalls).toBe(1)
    expect(afterCalls).toBe(1)
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('派发顺序：该 type 的 handler 先于 onAny', () => {
    const bus = createStudioBus()
    const order: string[] = []
    bus.onAny(() => order.push('any'))
    bus.on('mission.started', () => order.push('typed'))
    bus.emit(started('m-1'))
    expect(order).toEqual(['typed', 'any'])
  })

  it('无 handler 时 emit 不抛错', () => {
    const bus = createStudioBus()
    expect(() => bus.emit(started('m-1'))).not.toThrow()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('createStudioBus 返回相互独立实例（互不串事件）', () => {
    const busA = createStudioBus()
    const busB = createStudioBus()
    let aCalls = 0
    let bCalls = 0
    busA.on('mission.started', () => aCalls++)
    busB.on('mission.started', () => bCalls++)
    busA.emit(started('m-1'))
    expect(aCalls).toBe(1)
    expect(bCalls).toBe(0)
  })

  it('主 chunk 单例 studioBus 可用（emit/on/once/onAny 四方法齐全）', () => {
    expect(studioBus).toBeTruthy()
    expect(studioBus.emit).toBeTypeOf('function')
    expect(studioBus.on).toBeTypeOf('function')
    expect(studioBus.once).toBeTypeOf('function')
    expect(studioBus.onAny).toBeTypeOf('function')
  })
})
