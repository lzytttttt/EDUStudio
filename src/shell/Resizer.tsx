import { useRef, useState } from 'react'
import { cn } from '../lib/cn'

interface ResizerProps {
  /** 拖拽回调：透传 pointer clientX，由父级换算栏宽（左栏 = clientX；右栏 = innerWidth - clientX） */
  onMove: (clientX: number) => void
  /** 双击重置默认宽度 */
  onReset: () => void
  /** 拖拽结束（pointerup / pointercancel）：关键节点，供父级强制落盘（v0.9.3 P2-A②） */
  onEnd?: () => void
  /** 无障碍标签 */
  label: string
  /** 显示断点：md（左栏）/ xl（右栏），与相邻栏的响应式显隐一致 */
  at: 'md' | 'xl'
}

/**
 * 三栏拖拽分隔条（v0.6 M4①）：原生 Pointer Events，零依赖。
 * 视觉 2px 线 + 8px 热区；hover/拖拽 primary 高亮；拖拽中禁选中文本；双击重置。
 */
export default function Resizer({ onMove, onReset, onEnd, label, at }: ResizerProps) {
  const draggingRef = useRef(false)
  const [dragging, setDragging] = useState(false)

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    draggingRef.current = true
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
    document.body.style.userSelect = 'none'
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    onMove(e.clientX)
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    setDragging(false)
    e.currentTarget.releasePointerCapture(e.pointerId)
    document.body.style.userSelect = ''
    /* 拖拽收敛即落盘（v0.9.3 P2-A②）：不等待 300ms 合并窗口，避免关页丢栏宽 */
    onEnd?.()
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={`${label}（拖拽调整 · 双击重置）`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      className={cn(
        'group relative hidden shrink-0 cursor-col-resize touch-none',
        at === 'md' ? 'md:block' : 'xl:block',
        dragging && 'z-10',
      )}
      style={{ width: 8 }}
    >
      <div
        className={cn(
          'absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full transition-colors',
          dragging ? 'bg-primary' : 'bg-line group-hover:bg-primary',
        )}
      />
    </div>
  )
}
