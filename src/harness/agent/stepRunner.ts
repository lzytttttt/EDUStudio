import type { AgentTraceEvent, ArtifactProvider, LoomUpstreamRef, RoleId } from '../types'
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
  /** v0.9.4-03：Loom 上游结果（文档生成步骤引用其内容；缺省时旧路径零变化） */
  upstream?: LoomUpstreamRef[]
}

/**
 * 执行单个剧本步骤（Plan/Tool/Parallel/Reflect/Artifact/Text/Done）。
 * 从 MockOrchestrator 抽取，供 Mock 剧本与 API Plan-JSON 降级复用。
 * v0.4 M1②：parallel 步骤组内 Promise.all 并行执行，trace 事件标注同一并行组。
 */
export async function runScriptStep(step: ScriptStep, ctx: StepContext): Promise<void> {
  const { emit, signal, role, goal, artifacts, upstream } = ctx
  switch (step.type) {
    case 'plan': {
      await jitterDelay(400, 800, signal)
      emit({ kind: 'plan', steps: step.steps })
      return
    }
    case 'tool': {
      await jitterDelay(300, 600, signal)
      await execToolStep(step.tool, step.args, undefined, ctx)
      return
    }
    case 'parallel': {
      await jitterDelay(300, 600, signal)
      const group = nextId('grp')
      emit({ kind: 'reflect', text: `并行执行 ${step.label}（${step.steps.length} 项同时进行）` })
      await Promise.all(step.steps.map((s) => execToolStep(s.tool, s.args, group, ctx)))
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
        {
          role,
          goal,
          kindHint: step.kind,
          signal,
          /* v0.9.4-03：文档内容承接上游任务结果（缺省时入参与旧版逐字节一致） */
          ...(upstream?.length ? { upstream } : {}),
        },
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

/** 执行单个工具调用并 emit tool_call/tool_result（group 非空时标注并行组） */
async function execToolStep(
  toolName: string,
  args: Record<string, unknown>,
  group: string | undefined,
  ctx: StepContext,
): Promise<void> {
  const { emit, signal } = ctx
  const callId = nextId('call')
  emit({ kind: 'tool_call', id: callId, tool: toolName, args, group })
  const tool = toolRegistry.get(toolName)
  if (!tool) {
    emit({ kind: 'tool_result', id: callId, tool: toolName, summary: `工具 ${toolName} 未注册`, group })
    return
  }
  const result = await tool.run(args)
  await jitterDelay(200, 500, signal)
  emit({
    kind: 'tool_result',
    id: callId,
    tool: toolName,
    summary: result.summary,
    payload: result.payload,
    group,
  })
}

/** 顺序执行整份剧本；signal 触发 abort 时抛出 AbortError 由调用方处理 */
export async function runScript(steps: ScriptStep[], ctx: StepContext): Promise<void> {
  for (const step of steps) {
    if (ctx.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    await runScriptStep(step, ctx)
  }
}
