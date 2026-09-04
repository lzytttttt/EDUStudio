import type { AgentProvider, AgentTaskInput, AgentTraceEvent, ArtifactProvider } from '../types'
import { matchScript, type ScriptStep } from '../scripts/agent'
import { toolRegistry } from './ToolRegistry'
import { jitterDelay } from '../../lib/delay'

let seq = 0
function nextId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq}`
}

/**
 * MockOrchestrator —— Plan→Act→Reflect 剧本驱动编排。
 * 按角色+目标匹配剧本，逐步 emit trace 事件；artifact 步骤委托 ArtifactProvider 流式生成。
 */
export class MockOrchestrator implements AgentProvider {
  constructor(private artifacts: ArtifactProvider) {}

  async runTask(input: AgentTaskInput, emit: (e: AgentTraceEvent) => void): Promise<void> {
    const { role, goal, signal } = input
    const script = matchScript(role, goal)

    try {
      for (const step of script.steps) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        await this.runStep(step, role, goal, emit, signal)
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        emit({ kind: 'done', text: '任务已取消。' })
        return
      }
      console.error('[MockOrchestrator] step failed:', err)
      emit({ kind: 'done', text: '执行中遇到问题，已停止。请重试或换个说法描述你的目标。' })
    }
  }

  private async runStep(
    step: ScriptStep,
    role: AgentTaskInput['role'],
    goal: string,
    emit: (e: AgentTraceEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    switch (step.type) {
      case 'plan': {
        await jitterDelay(400, 800, signal)
        emit({ kind: 'plan', steps: step.steps })
        return
      }
      case 'tool': {
        await jitterDelay(300, 600, signal)
        const callId = nextId('call')
        emit({ kind: 'tool_call', id: callId, tool: step.tool, args: step.args })
        const tool = toolRegistry.get(step.tool)
        if (!tool) {
          emit({ kind: 'tool_result', id: callId, tool: step.tool, summary: `工具 ${step.tool} 未注册` })
          return
        }
        const result = await tool.run(step.args)
        await jitterDelay(200, 500, signal)
        emit({
          kind: 'tool_result',
          id: callId,
          tool: step.tool,
          summary: result.summary,
          payload: result.payload,
        })
        return
      }
      case 'reflect': {
        await jitterDelay(400, 700, signal)
        emit({ kind: 'reflect', text: step.text })
        return
      }
      case 'artifact': {
        await jitterDelay(300, 500, signal)
        const artifactId = nextId('art')
        emit({ kind: 'artifact_meta', artifactId, title: goal, docKind: step.kind })
        await this.artifacts.generate({ role, goal, kindHint: step.kind, signal }, (chunk) => {
          emit({ kind: 'artifact_chunk', artifactId, chunk })
        })
        return
      }
      case 'text': {
        await jitterDelay(300, 500, signal)
        emit({ kind: 'text', text: step.text })
        return
      }
      case 'done': {
        await jitterDelay(200, 400, signal)
        emit({ kind: 'done', text: step.text })
        return
      }
    }
  }
}
