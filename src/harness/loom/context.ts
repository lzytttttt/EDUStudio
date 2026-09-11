/**
 * Loom 上游结果组装（v0.9.4 M5）——纯函数，无 store / DOM 依赖。
 *
 * 语义（见 v0.9.4-01 决策 2 / roadmap 第十节）：
 * - 边 = dependency/context，执行子节点时把父节点输出注入上下文；
 * - Mock 走 reflect 文案展示，API Orchestrator 把文本拼进 user 消息；
 * - 无上游（空数组）时格式化为空串，保证旧路径调用零副作用。
 */
import type { LoomUpstreamRef } from '../types'

/**
 * 组装「上游任务结果」段落（不含当前目标）；
 * 无上游时返回空串，调用方据此决定是否注入。
 */
export function formatUpstreamResults(upstream?: LoomUpstreamRef[]): string {
  if (!upstream || upstream.length === 0) return ''
  const lines = upstream.map((u) => `- ${u.title}：${u.output || '（暂无文本输出）'}`)
  return `上游任务结果：\n${lines.join('\n')}`
}

/**
 * 组装「上游任务结果：… 当前目标：…」完整文本（roadmap 第十节示例格式）。
 * 无上游时退化为「当前目标：goal」，便于统一调用。
 */
export function formatUpstreamContext(upstream: LoomUpstreamRef[], goal: string): string {
  const results = formatUpstreamResults(upstream)
  return results ? `${results}\n\n当前目标：${goal}` : `当前目标：${goal}`
}

/** reflect 文案：已接收上游 N 项结果（Mock 演示视图用） */
export function upstreamReflectText(upstream: LoomUpstreamRef[]): string {
  const titles = upstream.map((u) => u.title).join('、')
  return `已接收上游 ${upstream.length} 项结果：${titles}，将据此生成`
}
