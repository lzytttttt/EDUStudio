import type { AgentProvider, AgentTaskInput, AgentTraceEvent } from '../types'
import { toolRegistry } from './ToolRegistry'

/**
 * Orchestrator —— API 模式编排骨架（Plan→Act→Reflect，function-calling 优先）。
 *
 * 接入步骤：
 * 1. 将角色 systemPrompt + 工具 JSON Schema 组装为 messages/tools
 * 2. 调用 LLMProvider（OpenAI 兼容），解析 delta.tool_calls 流式累积
 * 3. 执行工具 → 回填 tool 消息 → 循环直至无 tool_calls → 输出 done
 * 4. 模型不支持 tools 时降级：要求其输出 {steps:[{tool,args}]} Plan-JSON 并解析执行
 * 5. 在 providerRegistry 切换 ACTIVE_MODE
 */
export class Orchestrator implements AgentProvider {
  async runTask(_input: AgentTaskInput, _emit: (e: AgentTraceEvent) => void): Promise<void> {
    void toolRegistry
    throw new Error('[Orchestrator] API 模式尚未接入：请实现 function-calling 编排循环')
  }
}
