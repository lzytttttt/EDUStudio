/**
 * 战队视图壳（v1.2 M1-B，总指挥 lazy chunk）
 *
 * 挂载旧整屏的 `TeamSurface`。
 *
 * 深链（最小实现）：`?view=team&agent=analyst` → target={kind:'team', agentId}
 * - TeamSurface 的成员详情是**内部 state**（`activeId` + Sheet），既无外部 props 也禁止改
 *   `apps/director/**`，因此这里只依赖旧的公开 DOM 契约：
 *   滚到成员卡（`team-agent-<id>`）后触发一次 click，让详情 Sheet 自然打开；
 * - agentId 非法 / 成员卡不存在时静默忽略（不报错，只停在战队页）；
 * - 用 try/catch 兜住一切 DOM 异常，深链失败不影响正常渲染。
 */
import { useEffect } from 'react'
import type { SurfaceProps } from '../../shell/SurfaceHost'
import TeamSurface from '../director/TeamSurface'

/** 首帧 d-rise 入场后再定位，避免点未布局的卡片 */
const DEEPLINK_DELAY_MS = 80

export default function TeamView({ target }: SurfaceProps): JSX.Element {
  const agentId = target?.kind === 'team' ? target.agentId : undefined

  useEffect(() => {
    if (!agentId) return
    const timer = window.setTimeout(() => {
      try {
        const el = document.querySelector<HTMLElement>(`[data-testid="team-agent-${agentId}"]`)
        if (!el) return
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        /* 打开成员详情：走 TeamSurface 自己的 onClick（setActiveId），不复制其内部逻辑 */
        el.click()
      } catch (error) {
        console.error('[TeamView] 深链 agent 定位失败:', error)
      }
    }, DEEPLINK_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [agentId])

  return (
    <div data-testid="command-view-team" className="h-full">
      <TeamSurface />
    </div>
  )
}
