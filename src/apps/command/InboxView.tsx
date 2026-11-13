/**
 * 战情台视图壳（v1.2 M1-B，总指挥 lazy chunk）
 *
 * 统一外壳只认识 `SurfaceProps`；本文件把旧整屏的 `InboxSurface`（默认导出、无 props）
 * 挂进 SurfaceHost，不复制其内部实现，也不改旧文件。
 *
 * 深链（最小实现）：`?view=inbox&id=dec-1` → target={kind:'decision', id}
 * - 位移到对应决策卡（`director-decision-*`），只滚动、不自动展开 Sheet —— 深链只负责
 *   「落在正确位置」，具体动作留给用户，避免打开页面就触发副作用；
 * - 卡片不存在（已处理 / snoozed / id 非法）静默忽略，不报错。
 */
import { useEffect } from 'react'
import type { SurfaceProps } from '../../shell/SurfaceHost'
import InboxSurface from '../director/InboxSurface'

/** 首帧 d-rise 入场（≤420ms）后再定位，避免滚到未布局的元素 */
const DEEPLINK_DELAY_MS = 80

export default function InboxView({ target }: SurfaceProps): JSX.Element {
  const decisionId = target?.kind === 'decision' ? target.id : null

  useEffect(() => {
    if (!decisionId) return
    const timer = window.setTimeout(() => {
      try {
        const el = document.querySelector<HTMLElement>(`[data-testid="director-decision-${decisionId}"]`)
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      } catch {
        /* 非法 id（含引号等）选择器会抛错：深链降级为「只到战情台」，不打扰用户 */
      }
    }, DEEPLINK_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [decisionId])

  return (
    <div data-testid="command-view-inbox" className="h-full">
      <InboxSurface />
    </div>
  )
}
