/**
 * 战队视图壳（v1.2 M1-B，总指挥 lazy chunk；v1.2 M2 追加只读「已学会」）
 *
 * 挂载旧整屏的 `TeamSurface`，下方追加只读「已学会」摘要（roadmap §2.3 F5）：
 * - 数据源 = `useMemoryStore` 的 semantic / episodic，按 `agentId` 聚合（不复制实体、只读）；
 * - 显示「N 位成员已积累经验」+ 最近一条经验 key（无数据「暂无」）；
 * - 不改旧 `TeamSurface`（授权编辑仍只在那里，语义不同不混）。
 *
 * 深链（最小实现）：`?view=team&agent=analyst` → target={kind:'team', agentId}
 * - TeamSurface 的成员详情是**内部 state**（`activeId` + Sheet），既无外部 props 也禁止改
 *   `apps/director/**`，因此这里只依赖旧的公开 DOM 契约：
 *   滚到成员卡（`team-agent-<id>`）后触发一次 click，让详情 Sheet 自然打开；
 * - agentId 非法 / 成员卡不存在时静默忽略（不报错，只停在战队页）；
 * - 用 try/catch 兜住一切 DOM 异常，深链失败不影响正常渲染。
 */
import { useEffect, useMemo } from 'react'
import { Sparkles } from 'lucide-react'
import type { SurfaceProps } from '../../shell/SurfaceHost'
import { summarizeAgentLearning, useMemoryStore } from '../../stores/memoryStore'
import TeamSurface from '../director/TeamSurface'

/** 首帧 d-rise 入场后再定位，避免点未布局的卡片 */
const DEEPLINK_DELAY_MS = 80

export default function TeamView({ target }: SurfaceProps): JSX.Element {
  const agentId = target?.kind === 'team' ? target.agentId : undefined
  /* 已学会：语义 / 情景按 agentId 聚合（只读派生；无数据 = 0 位 / 暂无） */
  const semantic = useMemoryStore((s) => s.semantic)
  const episodic = useMemoryStore((s) => s.episodic)
  const learned = useMemo(() => summarizeAgentLearning(semantic, episodic), [semantic, episodic])

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
    <div data-testid="command-view-team" className="flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-hidden">
        <TeamSurface />
      </div>

      {/* 只读「已学会」：成员经验聚合；不提供编辑/授权入口 */}
      <section
        data-testid="command-team-learned"
        aria-label="战队已学会"
        className="shrink-0 border-t border-line bg-surface/85 px-4 py-2.5 backdrop-blur-sm sm:px-6"
      >
        <div className="mx-auto flex w-full max-w-[1120px] items-center gap-2 text-xs">
          <Sparkles size={13} className="shrink-0 text-primary" aria-hidden />
          <span className="shrink-0 font-medium text-ink-soft">已学会</span>
          <span data-testid="command-team-learned-count" className="shrink-0 text-ink">
            {learned.agents > 0 ? `${learned.agents} 位成员已积累经验` : '暂无'}
          </span>
          {learned.recent && (
            <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-ink-mute" title={learned.recent}>
              最近：{learned.recent}
            </span>
          )}
        </div>
      </section>
    </div>
  )
}
