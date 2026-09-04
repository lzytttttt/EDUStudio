import type { AgentProvider, AgentTaskInput, AgentTraceEvent, ArtifactProvider } from '../types'
import { matchScript } from '../scripts/agent'
import { runScript, type StepContext } from './stepRunner'

/**
 * MockOrchestrator —— Plan→Act→Reflect 剧本驱动编排。
 * 按角色+目标匹配剧本，逐步 emit trace 事件；artifact 步骤委托 ArtifactProvider 流式生成。
 * 步骤执行器已抽取至 stepRunner（与 API Orchestrator 的 Plan-JSON 降级共用）。
 */
export class MockOrchestrator implements AgentProvider {
  constructor(private artifacts: ArtifactProvider) {}

  async runTask(input: AgentTaskInput, emit: (e: AgentTraceEvent) => void): Promise<void> {
    const { role, goal, signal } = input
    const script = matchScript(role, goal)
    const ctx: StepContext = { role, goal, artifacts: this.artifacts, emit, signal }

    try {
      await runScript(script.steps, ctx)
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        emit({ kind: 'done', text: '任务已取消。' })
        return
      }
      console.error('[MockOrchestrator] step failed:', err)
      emit({ kind: 'done', text: '执行中遇到问题，已停止。请重试或换个说法描述你的目标。' })
    }
  }
}
