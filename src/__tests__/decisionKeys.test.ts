import { describe, expect, it } from 'vitest'
import { shouldIgnoreDecisionKey, type DecisionKeyEventLike } from '../lib/decisionKeys'

/** 构造最小键盘事件结构（不依赖 DOM） */
function evt(target: unknown, extra: Partial<DecisionKeyEventLike> = {}): DecisionKeyEventLike {
  return { isComposing: false, keyCode: 37, target: target as EventTarget, ...extra }
}

const el = (tagName: string, isContentEditable = false) => ({ tagName, isContentEditable })

describe('shouldIgnoreDecisionKey（v0.9.3 P0-B 决策键守卫矩阵）', () => {
  it('正常态（body / 卡片舞台）→ 不忽略，方向键照常决策', () => {
    expect(shouldIgnoreDecisionKey(evt(el('BODY')))).toBe(false)
    expect(shouldIgnoreDecisionKey(evt(el('DIV')))).toBe(false)
    expect(shouldIgnoreDecisionKey(evt(el('BUTTON')))).toBe(false)
    expect(shouldIgnoreDecisionKey(evt(null))).toBe(false)
  })

  it('输入元素（input / textarea / select）→ 忽略', () => {
    expect(shouldIgnoreDecisionKey(evt(el('INPUT')))).toBe(true)
    expect(shouldIgnoreDecisionKey(evt(el('TEXTAREA')))).toBe(true)
    expect(shouldIgnoreDecisionKey(evt(el('SELECT')))).toBe(true)
  })

  it('contenteditable 富文本 → 忽略', () => {
    expect(shouldIgnoreDecisionKey(evt(el('DIV', true)))).toBe(true)
    expect(shouldIgnoreDecisionKey(evt(el('P', true)))).toBe(true)
  })

  it('输入法组词中（isComposing / keyCode 229）→ 忽略', () => {
    expect(shouldIgnoreDecisionKey(evt(el('BODY'), { isComposing: true }))).toBe(true)
    expect(shouldIgnoreDecisionKey(evt(el('BODY'), { keyCode: 229 }))).toBe(true)
  })

  it('弹层打开（引导 / 重新生成 / 导入 / 任务浮层）→ 忽略', () => {
    expect(shouldIgnoreDecisionKey(evt(el('BODY')), { overlayOpen: true })).toBe(true)
  })

  it('边界：tagName 缺失或非字符串 → 回退到 contenteditable 判定', () => {
    expect(shouldIgnoreDecisionKey(evt({}))).toBe(false)
    expect(shouldIgnoreDecisionKey(evt({ tagName: 'textarea' }))).toBe(false) // 小写不匹配 HTML 大写标签
    expect(shouldIgnoreDecisionKey(evt({ isContentEditable: true }))).toBe(true)
  })
})
