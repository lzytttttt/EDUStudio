/** SSE 流解析纯函数：按事件边界切分，半包留存 buffer，便于单测（见 v0.2 专项 ⑥） */

export interface SSEParseResult {
  /** 本次缓冲区中完整事件的 data 载荷（已去除 'data:' 前缀与首尾空白） */
  events: string[]
  /** 未形成完整事件的剩余半包（无换行结尾），需与下次数据拼接 */
  rest: string
}

/**
 * 解析一段可能不完整的 SSE 文本：
 * - 兼容 \n 与 \r\n 行尾
 * - 忽略空行、注释行（: 开头）与 event:/id:/retry: 等字段行
 * - 仅提取 data: 行载荷；`data: [DONE]` 原样返回由调用方判断
 */
export function parseSSEChunk(buffer: string): SSEParseResult {
  const events: string[] = []
  const lines = buffer.split(/\r?\n/)
  const rest = lines.pop() ?? ''
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(':')) continue
    if (!trimmed.startsWith('data:')) continue
    events.push(trimmed.slice(5).trim())
  }
  return { events, rest }
}
