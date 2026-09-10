/**
 * 简报决策键守卫（v0.9.3 P0-B）
 *
 * 简报页在 window 上监听 ←/↑/→ 做卡片决策（跳过 / 收藏 / 采纳）。
 * 卡片正文编辑、弹窗表单输入与输入法组词时，方向键属于输入行为，绝不能触发决策。
 * 本模块把判定抽为纯函数，守卫矩阵由单测固化。
 */

export interface DecisionKeyGuardContext {
  /** 是否有弹层（操作引导 / 重新生成 / 导入文档 / 后台任务浮层）打开 */
  overlayOpen?: boolean
}

/** 可编辑元素标签（input / textarea / select） */
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** KeyboardEvent 的最小结构（便于单测直接构造，不依赖 DOM） */
export interface DecisionKeyEventLike {
  /** 输入法组词中 */
  isComposing?: boolean
  /** 输入法组词的兜底 keyCode（部分浏览器不置位 isComposing） */
  keyCode?: number
  /** 事件源元素 */
  target?: EventTarget | null
}

/** 方向键是否应被忽略：弹层打开 / 输入法组词 / 事件源为可编辑元素时不触发卡片决策 */
export function shouldIgnoreDecisionKey(e: DecisionKeyEventLike, ctx: DecisionKeyGuardContext = {}): boolean {
  if (ctx.overlayOpen) return true
  if (e.isComposing || e.keyCode === 229) return true
  const target = e.target as (HTMLElement & { tagName?: string }) | null
  if (!target) return false
  if (typeof target.tagName === 'string' && EDITABLE_TAGS.has(target.tagName)) return true
  if (target.isContentEditable) return true
  return false
}
