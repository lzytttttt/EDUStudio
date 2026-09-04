import type { AgentProvider, AgentTaskInput, AgentTraceEvent, ProviderMode } from '../types'
import { MockOrchestrator } from './MockOrchestrator'
import { Orchestrator } from './Orchestrator'
import { MockArtifactProvider } from '../artifacts/MockArtifactProvider'
import { toolRegistry } from './ToolRegistry'
import type { DeepSeekConfig } from '../llm/adapter'

/** 连续 API 失败达到该次数才向用户报错（此前每次失败均回退 Mock 剧本） */
const API_FAIL_LIMIT = 2

let consecutiveApiFails = 0

/**
 * FallbackAgent —— API 失败自动回退 Mock 的包装。
 * 首次失败：emit reflect 说明「已切换 Mock 剧本」→ 用 MockOrchestrator 重跑同一 goal；
 * 连续失败达上限：抛出错误交由上层向用户报错；API 成功后计数清零。
 */
class FallbackAgent implements AgentProvider {
  constructor(private primary: AgentProvider, private fallback: AgentProvider) {}

  async runTask(input: AgentTaskInput, emit: (e: AgentTraceEvent) => void): Promise<void> {
    try {
      await this.primary.runTask(input, emit)
      consecutiveApiFails = 0
      return
    } catch (err) {
      if (input.signal?.aborted) throw err
      consecutiveApiFails += 1
      if (consecutiveApiFails >= API_FAIL_LIMIT) throw err
      console.warn('[FallbackAgent] API failed, falling back to Mock:', (err as Error)?.message)
      emit({
        kind: 'reflect',
        text: `真实模型调用失败（${((err as Error)?.message ?? '未知错误').slice(0, 60)}），已自动切换 Mock 剧本继续执行。`,
      })
      await this.fallback.runTask(input, emit)
    }
  }
}

export function getAgentProvider(mode: ProviderMode, config?: DeepSeekConfig): AgentProvider {
  if (mode === 'api') {
    return new FallbackAgent(
      new Orchestrator(config),
      new MockOrchestrator(new MockArtifactProvider()),
    )
  }
  return new MockOrchestrator(new MockArtifactProvider())
}

export { MockOrchestrator, Orchestrator, toolRegistry }
