import { describe, expect, it } from 'vitest'
import { conceal, reveal } from '../lib/secretBox'

describe('secretBox Key 混淆（v0.4 M5③）', () => {
  it('conceal → reveal 往返还原', () => {
    const key = 'sk-abc123XYZ中文密钥'
    expect(reveal(conceal(key))).toBe(key)
  })

  it('落盘串不再包含明文（防一眼可读）', () => {
    const key = 'sk-very-secret-key-9876'
    const boxed = conceal(key)
    expect(boxed).not.toContain(key)
    expect(boxed.startsWith('enc1:')).toBe(true)
  })

  it('空串原样返回', () => {
    expect(conceal('')).toBe('')
    expect(reveal('')).toBe('')
  })

  it('兼容历史明文（无前缀原样返回）', () => {
    expect(reveal('sk-legacy-plain')).toBe('sk-legacy-plain')
  })

  it('损坏输入返回空串不抛错', () => {
    expect(reveal('enc1:%%%not-base64%%%')).toBe('')
  })
})
