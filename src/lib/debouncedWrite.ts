/**
 * 合并写盘（v0.9.3 P2-A②）：
 * 文本编辑 / 字号滑杆 / 栏宽拖拽等高频操作，把「每次变更全量写 localStorage」合并为
 * trailing 窗口内的单次写出；关键节点（生成定稿、切换文档、拖拽结束、页面隐藏/退出）调用
 * `flush()` 立即落盘，保证不丢数据。
 */
export interface DebouncedWriter {
  /** 触发一次变更（重置 trailing 窗口计时） */
  schedule: () => void
  /** 立即写出待处理变更（无待处理时为空操作） */
  flush: () => void
  /** 丢弃待处理变更（不写出，用于「本次已全量写出」或清库后重置） */
  cancel: () => void
  /** 是否有待写出变更（诊断 / 单测） */
  readonly pending: boolean
}

/** 合并窗口：≥300ms 无新变更即落盘（人眼「输入停顿」量级） */
export const PERSIST_DEBOUNCE_MS = 300

export function createDebouncedWriter(write: () => void, windowMs = PERSIST_DEBOUNCE_MS): DebouncedWriter {
  let handle: ReturnType<typeof setTimeout> | null = null

  return {
    schedule() {
      if (handle !== null) clearTimeout(handle)
      handle = setTimeout(() => {
        handle = null
        write()
      }, windowMs)
    },
    flush() {
      if (handle === null) return
      clearTimeout(handle)
      handle = null
      write()
    },
    cancel() {
      if (handle === null) return
      clearTimeout(handle)
      handle = null
    },
    get pending() {
      return handle !== null
    },
  }
}
