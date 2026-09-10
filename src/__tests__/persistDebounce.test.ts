import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDebouncedWriter, PERSIST_DEBOUNCE_MS } from '../lib/debouncedWrite'
import { flushArtifactPersist, useArtifactStore } from '../stores/artifactStore'
import { flushSettingsPersist, useSettingsStore } from '../stores/settingsStore'

/**
 * v0.9.3 P2-A② 持久化合并写盘：
 * 高频变更（正文编辑 / 字号滑杆 / 栏宽拖拽）在 trailing 窗口内合并为一次全量落盘；
 * 关键节点（finalize / 切换文档 / 拖拽结束 / 页面隐藏）强制 flush，保证不丢最后一笔。
 */

const ARTIFACTS_KEY = 'edustudio:artifacts'
const SETTINGS_KEY = 'edustudio:settings'

let setItem: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.useFakeTimers()
  setItem = vi.spyOn(Storage.prototype, 'setItem')
  useArtifactStore.setState({ docs: [], revisions: {}, activeId: null, generatingIds: [], unreadDocIds: [] })
})

afterEach(() => {
  /* 清掉模块级单例中残留的合并窗口，避免跨用例串扰 */
  flushArtifactPersist()
  flushSettingsPersist()
  setItem.mockRestore()
  vi.useRealTimers()
})

/** 指定存储 key 的写盘次数 */
function writes(key: string): number {
  return setItem.mock.calls.filter(([k]) => k === key).length
}

describe('createDebouncedWriter（trailing 合并语义）', () => {
  it('窗口内连续触发只写出一次，写出时机为最后一次触发后满窗口', () => {
    const write = vi.fn()
    const w = createDebouncedWriter(write, 300)

    w.schedule()
    vi.advanceTimersByTime(200)
    w.schedule()
    vi.advanceTimersByTime(200)
    expect(write).not.toHaveBeenCalled()
    expect(w.pending).toBe(true)

    vi.advanceTimersByTime(100)
    expect(write).toHaveBeenCalledTimes(1)
    expect(w.pending).toBe(false)
  })

  it('flush 立即写出并撤销窗口（不重复写）；无待写时为空操作', () => {
    const write = vi.fn()
    const w = createDebouncedWriter(write, 300)

    w.schedule()
    w.flush()
    expect(write).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1000)
    expect(write).toHaveBeenCalledTimes(1)

    w.flush()
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('cancel 丢弃待写变更且不写出，之后可重新调度', () => {
    const write = vi.fn()
    const w = createDebouncedWriter(write, 300)

    w.schedule()
    w.cancel()
    vi.advanceTimersByTime(1000)
    expect(write).not.toHaveBeenCalled()
    expect(w.pending).toBe(false)

    w.schedule()
    vi.advanceTimersByTime(300)
    expect(write).toHaveBeenCalledTimes(1)
  })
})

describe('artifactStore 正文编辑合并写盘', () => {
  it('连续逐字编辑只写一次，落盘为最后一笔内容', () => {
    const docId = useArtifactStore.getState().createManual('teacher')
    setItem.mockClear()

    useArtifactStore.getState().updateContent(docId, '# 一')
    useArtifactStore.getState().updateContent(docId, '# 一二')
    useArtifactStore.getState().updateContent(docId, '# 一二三')
    expect(writes(ARTIFACTS_KEY)).toBe(0)

    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS)
    expect(writes(ARTIFACTS_KEY)).toBe(1)
    const saved = JSON.parse(localStorage.getItem(ARTIFACTS_KEY) ?? '{}') as { docs: { id: string; content: string }[] }
    expect(saved.docs.find((d) => d.id === docId)?.content).toBe('# 一二三')
  })

  it('切换文档（setActive）为关键节点：立即落盘待写编辑', () => {
    const first = useArtifactStore.getState().createManual('teacher')
    const second = useArtifactStore.getState().createManual('teacher')
    setItem.mockClear()

    useArtifactStore.getState().updateContent(first, '未到窗口的编辑')
    useArtifactStore.getState().setActive(second)
    expect(writes(ARTIFACTS_KEY)).toBe(1)

    const saved = JSON.parse(localStorage.getItem(ARTIFACTS_KEY) ?? '{}') as { docs: { id: string; content: string }[] }
    expect(saved.docs.find((d) => d.id === first)?.content).toBe('未到窗口的编辑')

    /* 窗口到期后不重复写 */
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS)
    expect(writes(ARTIFACTS_KEY)).toBe(1)
  })

  it('flushArtifactPersist 兜底落盘（页面隐藏路径）', () => {
    const docId = useArtifactStore.getState().createManual('teacher')
    setItem.mockClear()

    useArtifactStore.getState().updateContent(docId, '离开页面前的内容')
    flushArtifactPersist()
    expect(writes(ARTIFACTS_KEY)).toBe(1)

    const saved = JSON.parse(localStorage.getItem(ARTIFACTS_KEY) ?? '{}') as { docs: { id: string; content: string }[] }
    expect(saved.docs.find((d) => d.id === docId)?.content).toBe('离开页面前的内容')
  })

  it('生成定稿（finalize）立即写出，不等合并窗口', () => {
    useArtifactStore.getState().createPlaceholder('a1', '教案', 'lessonPlan', 'teacher', 'agent')
    useArtifactStore.getState().appendChunk('a1', '正文')
    setItem.mockClear()

    useArtifactStore.getState().finalize('a1', '教案', 'lessonPlan')
    expect(writes(ARTIFACTS_KEY)).toBe(1)
  })
})

describe('settingsStore 字号 / 栏宽合并写盘', () => {
  it('字号滑杆连续触发只写一次，落盘为最终字号', () => {
    setItem.mockClear()
    useSettingsStore.getState().setFontSize(15)
    useSettingsStore.getState().setFontSize(16)
    useSettingsStore.getState().setFontSize(17)
    expect(writes(SETTINGS_KEY)).toBe(0)

    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS)
    expect(writes(SETTINGS_KEY)).toBe(1)
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as { fontSize: number }
    expect(saved.fontSize).toBe(17)
  })

  it('栏宽拖拽结束 flush 立即落盘（Resizer onEnd 路径）', () => {
    setItem.mockClear()
    useSettingsStore.getState().setColumnWidth('left', 280)
    useSettingsStore.getState().setColumnWidth('left', 300)
    expect(writes(SETTINGS_KEY)).toBe(0)

    flushSettingsPersist()
    expect(writes(SETTINGS_KEY)).toBe(1)
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as { columnWidths: { left: number } }
    expect(saved.columnWidths.left).toBe(300)

    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS)
    expect(writes(SETTINGS_KEY)).toBe(1)
  })

  it('低频设置项仍立即落盘（不受合并窗口影响）', () => {
    setItem.mockClear()
    useSettingsStore.getState().setFocusMode(false)
    expect(writes(SETTINGS_KEY)).toBe(1)
  })
})
