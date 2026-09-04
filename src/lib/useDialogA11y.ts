import { useEffect, useRef } from 'react'

/**
 * 弹层无障碍（v0.4 M4③）：
 * - Esc 关闭；
 * - 打开时把焦点移入弹层容器（键盘用户 Tab 焦点流从弹层开始）。
 * 用法：const ref = useDialogA11y<HTMLDivElement>(open, onClose)，容器加 ref + tabIndex={-1}。
 */
export function useDialogA11y<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return ref
}
