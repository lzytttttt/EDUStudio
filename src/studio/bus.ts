/**
 * v1.2 M0 · StudioBus 同步事件总线（主 chunk，约 0.3KB；roadmap §3.4）
 *
 * 纪律：
 * - 同步派发：emit 返回时全部 handler 已执行，便于断言顺序；
 * - handler 异常隔离：单个 handler 抛错只 console.error，不中断其余 handler；
 * - on 返回退订函数；once 触发后自动退订；onAny 收全部事件；
 * - 不挂 window 自定义事件（§3.1 规则 3 的历史 flush 钩子除外，本模块不新增）。
 *
 * 派发顺序：先按注册顺序执行该 type 的 handler，再按注册顺序执行 onAny handler；
 * 派发使用注册时刻的快照，派发过程中新增的 handler 从下一次事件起生效。
 */

import type { StudioBus, StudioEvent } from './contracts'

type AnyHandler = (event: StudioEvent) => void

interface Registration {
  handler: AnyHandler
  /** once 注册在首次触发前先摘除（防重入重复触发） */
  once: boolean
}

export function createStudioBus(): StudioBus {
  const typed = new Map<StudioEvent['type'], Registration[]>()
  const anyList: Registration[] = []

  const subscribe = (list: Registration[], handler: AnyHandler, once: boolean): (() => void) => {
    const registration: Registration = { handler, once }
    list.push(registration)
    return () => {
      const index = list.indexOf(registration)
      if (index >= 0) list.splice(index, 1)
    }
  }

  /** 执行一批 handler：单个异常隔离；once 在调用前摘除，避免重入时重复执行 */
  const dispatch = (list: Registration[], event: StudioEvent): void => {
    for (const registration of [...list]) {
      if (registration.once) {
        const index = list.indexOf(registration)
        if (index < 0) continue // 已被其他 handler 退订
        list.splice(index, 1)
      }
      try {
        registration.handler(event)
      } catch (error) {
        console.error('[studioBus] handler 异常已隔离:', error)
      }
    }
  }

  const listFor = (type: StudioEvent['type']): Registration[] => {
    const existing = typed.get(type)
    if (existing) return existing
    const created: Registration[] = []
    typed.set(type, created)
    return created
  }

  return {
    emit(event: StudioEvent): void {
      const registrations = typed.get(event.type)
      if (registrations && registrations.length > 0) dispatch(registrations, event)
      if (anyList.length > 0) dispatch(anyList, event)
    },
    on<T extends StudioEvent['type']>(type: T, handler: (e: Extract<StudioEvent, { type: T }>) => void): () => void {
      return subscribe(listFor(type), handler as AnyHandler, false)
    },
    once<T extends StudioEvent['type']>(type: T, handler: (e: Extract<StudioEvent, { type: T }>) => void): () => void {
      return subscribe(listFor(type), handler as AnyHandler, true)
    },
    onAny(handler: AnyHandler): () => void {
      return subscribe(anyList, handler, false)
    },
  }
}

/** 主 chunk 单例（§3.4）：跨域通信只走它，禁止 window 自定义事件 */
export const studioBus: StudioBus = createStudioBus()
