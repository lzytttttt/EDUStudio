/**
 * v1.2 M2 · 统一轻提示单测（roadmap §2.3 F6 / §3.4）
 *
 * 覆盖：同文案 1.5s 内合并计数、最多 3 条、3.2s 自动消失（fake timers）、手动 dismiss、
 * 旧 loomToasts API 不变、store 订阅与退订。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STUDIO_TOAST_MAX,
  STUDIO_TOAST_TTL_MS,
  formatToastText,
  splitToastText,
  useUiStore,
} from '../stores/uiStore'

const T0 = new Date(2026, 10, 13, 10, 0, 0).getTime()

function toasts() {
  return useUiStore.getState().toasts
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  useUiStore.setState({ toasts: [], loomToasts: [] })
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('pushToast（基础形状与自增 id）', () => {
  it('写入 {id,kind,text,at}；id 模块级自增、at = 当前时间', () => {
    useUiStore.getState().pushToast('info', '已连接')
    useUiStore.getState().pushToast('success', '已保存')
    const list = toasts()
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ kind: 'info', text: '已连接', at: T0 })
    expect(list[1]).toMatchObject({ kind: 'success', text: '已保存', at: T0 })
    expect(list[1].id).toBeGreaterThan(list[0].id)
    expect(typeof list[0].id).toBe('number')
  })
})

describe('同文案合并为计数（1.5s 窗口）', () => {
  it('窗口内重复推送 → 只保留一条，正文不变、计数 ×N，id 稳定', () => {
    const { pushToast } = useUiStore.getState()
    pushToast('success', '已保存')
    const id = toasts()[0].id
    vi.advanceTimersByTime(300)
    pushToast('success', '已保存')
    expect(toasts()).toHaveLength(1)
    expect(toasts()[0].id).toBe(id)
    expect(toasts()[0].text).toBe('已保存 ×2')
    expect(toasts()[0].at).toBe(T0 + 300)

    vi.advanceTimersByTime(300)
    pushToast('success', '已保存')
    expect(toasts()).toHaveLength(1)
    expect(splitToastText(toasts()[0].text)).toEqual({ base: '已保存', count: 3 })
  })

  it('超过 1.5s 窗口后再推同文案 → 新增一条（不合并）', () => {
    const { pushToast } = useUiStore.getState()
    pushToast('info', '已刷新')
    vi.advanceTimersByTime(1600)
    pushToast('info', '已刷新')
    expect(toasts()).toHaveLength(2)
    expect(toasts().map((t) => t.text)).toEqual(['已刷新', '已刷新'])
  })

  it('不同文案不合并；纯函数 formatToastText/splitToastText 口径一致', () => {
    const { pushToast } = useUiStore.getState()
    pushToast('info', '已连接')
    pushToast('error', '已断开')
    expect(toasts()).toHaveLength(2)
    expect(formatToastText('已保存', 1)).toBe('已保存')
    expect(formatToastText('已保存', 2)).toBe('已保存 ×2')
    expect(splitToastText('已保存 ×12')).toEqual({ base: '已保存', count: 12 })
    expect(splitToastText('无计数')).toEqual({ base: '无计数', count: 1 })
  })
})

describe('上限与自动消失', () => {
  it(`最多保留 ${STUDIO_TOAST_MAX} 条：超出丢弃最旧一条`, () => {
    const { pushToast } = useUiStore.getState()
    for (const text of ['一', '二', '三', '四', '五']) pushToast('info', text)
    expect(toasts()).toHaveLength(STUDIO_TOAST_MAX)
    expect(toasts().map((t) => t.text)).toEqual(['三', '四', '五'])
  })

  it(`${STUDIO_TOAST_TTL_MS}ms 后自动消失（fake timers）`, () => {
    useUiStore.getState().pushToast('success', '已保存')
    vi.advanceTimersByTime(STUDIO_TOAST_TTL_MS - 1)
    expect(toasts()).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(toasts()).toHaveLength(0)
  })

  it('合并后自动消失从最近一次推送重新计时', () => {
    const { pushToast } = useUiStore.getState()
    pushToast('success', '已保存')
    vi.advanceTimersByTime(1000)
    pushToast('success', '已保存') // 合并，刷新计时
    vi.advanceTimersByTime(STUDIO_TOAST_TTL_MS - 1)
    expect(toasts()).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(toasts()).toHaveLength(0)
  })
})

describe('dismissToast 与旧 Loom API 不变', () => {
  it('手动 dismiss 立即移除，且后续计时器不会“复活”它', () => {
    const { pushToast, dismissToast } = useUiStore.getState()
    pushToast('error', '导出失败')
    const id = toasts()[0].id
    dismissToast(id)
    expect(toasts()).toHaveLength(0)
    vi.advanceTimersByTime(STUDIO_TOAST_TTL_MS + 100)
    expect(toasts()).toHaveLength(0)
    /* 已移除 id 再 dismiss 不报错、不重复 */
    dismissToast(id)
    expect(toasts()).toHaveLength(0)
  })

  it('旧 loomToasts API 原样可用，且与统一 toasts 互不干扰', () => {
    const { pushLoomToast, dismissLoomToast, pushToast } = useUiStore.getState()
    pushLoomToast('success', '画布已连接')
    pushToast('info', '统一提示')
    expect(useUiStore.getState().loomToasts).toHaveLength(1)
    expect(useUiStore.getState().loomToasts[0]).toMatchObject({ kind: 'success', text: '画布已连接' })
    expect(toasts()).toHaveLength(1)
    dismissLoomToast(useUiStore.getState().loomToasts[0].id)
    expect(useUiStore.getState().loomToasts).toHaveLength(0)
    expect(toasts()).toHaveLength(1)
  })
})

describe('订阅与退订', () => {
  it('subscribe 能收到 push / dismiss；unsubscribe 后不再收到', () => {
    const seen: number[] = []
    const unsubscribe = useUiStore.subscribe((state) => {
      seen.push(state.toasts.length)
    })
    const { pushToast } = useUiStore.getState()
    pushToast('info', '第一条')
    expect(seen[seen.length - 1]).toBe(1)

    unsubscribe()
    pushToast('info', '第二条')
    expect(seen[seen.length - 1]).toBe(1)

    /* 自动消失仍正常（订阅退订不影响 store 自身计时） */
    vi.advanceTimersByTime(STUDIO_TOAST_TTL_MS * 2)
    expect(toasts()).toHaveLength(0)
  })
})
