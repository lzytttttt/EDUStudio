/**
 * 作战室视图壳（v1.2 M1-B，总指挥 lazy chunk）
 *
 * 挂载旧整屏的 `MissionSurface`；route↔directorStore.screen 的同步在 CommandCenter：
 * `?view=mission` 时 route 先到、screen 后到（effect 内 setScreen('mission')），因此本视图
 * 往往在 mission 屏已就绪后才渲染，任务状态由 store 持久化恢复，无需额外引导。
 *
 * 深链（最小实现）：`?view=mission&task=t-2` → target={kind:'mission', taskId}
 * - MissionSurface 未暴露 per-task 行的 DOM 契约（动态流按 feed 顺序渲染，无 taskId testid），
 *   本任务又禁止改 `apps/director/**`，所以**不做单行高亮**；
 * - 能做到的最小语义：滚动到作战主体（计划卡 / live 动态流 / 完成态），保证深链落地可见；
 * - `target.id`（missionId）同理：v1.2 单活跃 mission，没有可按 id 切换的第二条 mission，
 *   找不到即忽略，不报错。
 */
import { useEffect } from 'react'
import type { SurfaceProps } from '../../shell/SurfaceHost'
import MissionSurface from '../director/MissionSurface'

const DEEPLINK_DELAY_MS = 80

/** 作战主体块（任一存在即说明视图已就绪；顺序 = 用户最可能关心的落点） */
const MISSION_BODY_SELECTOR = [
  '[data-testid="mission-live"]',
  '[data-testid="mission-plan"]',
  '[data-testid="mission-done"]',
  '[data-testid="mission-idle"]',
].join(', ')

export default function MissionView({ target }: SurfaceProps): JSX.Element {
  const taskId = target?.kind === 'mission' ? target.taskId : undefined

  useEffect(() => {
    if (!taskId) return
    const timer = window.setTimeout(() => {
      try {
        const el = document.querySelector<HTMLElement>(MISSION_BODY_SELECTOR)
        el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      } catch {
        /* 忽略：深链降级为「只到作战室」 */
      }
    }, DEEPLINK_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [taskId])

  return (
    <div data-testid="command-view-mission" className="h-full">
      <MissionSurface />
    </div>
  )
}
