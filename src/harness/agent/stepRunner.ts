import type { AgentTraceEvent, ArtifactProvider, RoleId } from '../types'
import type { ScriptStep } from '../scripts/agent'
import { toolRegistry } from './ToolRegistry'
import { jitterDelay } from '../../lib/delay'

let seq = 0
export function nextId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq}`
}

/** 剧本步骤执行上下文：Mock 与 API Orchestrator 共用 */
export interface StepContext {
  role: RoleId
  goal: string
  artifacts: ArtifactProvider
  emit: (e: AgentTraceEvent) => void
  signal?: AbortSignal
}

/**
 * 执行单个剧本步骤（Plan/Tool/Reflect/Artifact/Text/Done）。
 * 从 MockOrchestrator 抽取，供 Mock 剧本与 API Plan-JSON 降级复用。
 */
export async function runScriptStep(step: ScriptStep, ctx: StepContext): Promise<void> {
  const { emit, signal, role, goal, artifacts } = ctx
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
      const { title, kind } = await artifacts.generate(
        { role, goal, kindHint: step.kind, signal },
        (chunk) => emit({ kind: 'artifact_chunk', artifactId, chunk }),
      )
      emit({ kind: 'artifact_done', artifactId, title, docKind: kind })
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

/** 顺序执行整份剧本；signal 触发 abort 时抛出 AbortError 由调用方处理 */
export async function runScript(steps: ScriptStep[], ctx: StepContext): Promise<void> {
  for (const step of steps) {
    if (ctx.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    await runScriptStep(step, ctx)
  }
}
