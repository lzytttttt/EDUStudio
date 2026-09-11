import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LOOM_PANEL_DEFAULT_HEIGHT,
  LOOM_PANEL_MIN_HEIGHT,
  clampLoomHeight,
  useUiStore,
} from '../stores/uiStore'
import { useLoomStore } from '../stores/loomStore'

/* v0.9.4-02 空间任务台体验打磨：高度收敛 / 通知队列 / 标题口径 */

describe('clampLoomHeight 画布高度收敛', () => {
  it('正常区间原样返回', () => {
    expect(clampLoomHeight(420, 900)).toBe(420)
  })

  it('低于最小高度收敛到 180px', () => {
    expect(clampLoomHeight(40, 900)).toBe(LOOM_PANEL_MIN_HEIGHT)
  })

  it('超过中栏 80% 收敛到上限', () => {
    /* 900 × 0.8 = 720 */
    expect(clampLoomHeight(10_000, 900)).toBe(720)
  })

  it('窗口很矮时下限优先（80% 不足 180px 的场景）', () => {
    expect(clampLoomHeight(500, 150)).toBe(LOOM_PANEL_MIN_HEIGHT)
  })
})

describe('画布通知队列', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useUiStore.setState({ loomToasts: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('push 后入队，kind 与文案保真', () => {
    useUiStore.getState().pushLoomToast('success', '已连接：分析学情 → 生成练习')
    const toasts = useUiStore.getState().loomToasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatchObject({ kind: 'success', text: '已连接：分析学情 → 生成练习' })
  })

  it('超过 3 条丢弃最旧，新反馈始终可见', () => {
    for (let i = 1; i <= 4; i += 1) useUiStore.getState().pushLoomToast('info', `第 ${i} 条`)
    const toasts = useUiStore.getState().loomToasts
    expect(toasts).toHaveLength(3)
    expect(toasts.map((t) => t.text)).toEqual(['第 2 条', '第 3 条', '第 4 条'])
  })

  it('到时自动消失（TTL 3.2s）', () => {
    useUiStore.getState().pushLoomToast('error', '这会形成循环任务，请调整连接关系')
    expect(useUiStore.getState().loomToasts).toHaveLength(1)
    vi.advanceTimersByTime(3300)
    expect(useUiStore.getState().loomToasts).toHaveLength(0)
  })

  it('dismiss 按 id 精确移除', () => {
    useUiStore.getState().pushLoomToast('info', '已从画布移除，任务与产出保留')
    const id = useUiStore.getState().loomToasts[0].id
    useUiStore.getState().dismissLoomToast(id)
    expect(useUiStore.getState().loomToasts).toHaveLength(0)
  })
})

describe('画布标题口径（统一为「xx画布」）', () => {
  beforeEach(() => useLoomStore.setState({ boards: [], activeBoardId: null }))

  it('三个角色分别为 教学画布 / 管理画布 / 区域画布', () => {
    expect(useLoomStore.getState().ensureBoard('teacher').title).toBe('教学画布')
    expect(useLoomStore.getState().ensureBoard('schoolAdmin').title).toBe('管理画布')
    expect(useLoomStore.getState().ensureBoard('bureau').title).toBe('区域画布')
  })

  it('不再出现「本周管理任务」等旧口径', () => {
    const titles = useLoomStore.getState().boards.map((b) => b.title)
    expect(titles).not.toContain('本周管理任务')
    expect(titles).not.toContain('今日教学任务')
    expect(titles).not.toContain('区域协同任务')
  })
})

describe('画布高度状态', () => {
  it('默认 300px，可设置任意值（边界由 clampLoomHeight 收敛）', () => {
    useUiStore.setState({ loomHeight: LOOM_PANEL_DEFAULT_HEIGHT })
    expect(useUiStore.getState().loomHeight).toBe(300)
    useUiStore.getState().setLoomHeight(560)
    expect(useUiStore.getState().loomHeight).toBe(560)
  })
})
