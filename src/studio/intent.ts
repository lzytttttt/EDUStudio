/**
 * v1.2 M1 · 一句话委托的待消费槽（主 chunk）
 *
 * 问题：顶栏 IntentBar 在主 chunk，真正的拆解（`directorStore.planMission`）在 Director chunk。
 * 事件总线只在「监听者已挂载」时可靠，而 CommandCenter 是懒加载的 —— 先提交、后挂载会丢意图。
 * 解法：提交时写入本模块的待消费槽（只存一行文本 + 来源，不存实体），CommandCenter 挂载后
 * `consumePendingIntent()` 取走；同时仍发 `intent.submitted` 供已挂载的消费者即时响应。
 */
import type { StudioEvent } from './contracts'
import { studioBus } from './bus'

export type IntentSource = Extract<StudioEvent, { type: 'intent.submitted' }>['source']

export interface PendingIntent {
  intent: string
  source: IntentSource
  at: number
}

let pending: PendingIntent | null = null

/** IntentBar 提交：去空白后写槽 + 广播事件；空文本忽略 */
export function submitIntent(intent: string, source: IntentSource = 'inbox'): void {
  const text = intent.trim()
  if (!text) return
  pending = { intent: text, source, at: Date.now() }
  studioBus.emit({ type: 'intent.submitted', intent: text, source })
}

/** CommandCenter 挂载 / 事件到达时取走待消费意图（只允许消费一次） */
export function consumePendingIntent(): PendingIntent | null {
  const current = pending
  pending = null
  return current
}

/** 只读查看（诊断 / 测试） */
export function peekPendingIntent(): PendingIntent | null {
  return pending
}

/** 清空（单测 / 重置演示用） */
export function clearPendingIntent(): void {
  pending = null
}
