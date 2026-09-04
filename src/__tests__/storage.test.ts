import { describe, expect, it } from 'vitest'
import { loadJSON, saveJSON, removeKey, clearAll } from '../lib/storage'

describe('storage', () => {
  it('save/load 往返一致', () => {
    saveJSON('t-key', { a: 1, list: [1, 2] })
    expect(loadJSON('t-key', null)).toEqual({ a: 1, list: [1, 2] })
  })

  it('缺失 key 返回 fallback', () => {
    expect(loadJSON('t-missing', '默认值')).toBe('默认值')
  })

  it('损坏 JSON 返回 fallback 而不抛错', () => {
    localStorage.setItem('edustudio:t-broken', '{oops')
    expect(loadJSON('t-broken', '兜底')).toBe('兜底')
  })

  it('removeKey 删除指定键', () => {
    saveJSON('t-rm', 1)
    removeKey('t-rm')
    expect(loadJSON('t-rm', null)).toBeNull()
  })

  it('clearAll 仅清理命名空间内键', () => {
    saveJSON('t-c1', 1)
    localStorage.setItem('other-app', 'keep')
    clearAll()
    expect(loadJSON('t-c1', null)).toBeNull()
    expect(localStorage.getItem('other-app')).toBe('keep')
    localStorage.removeItem('other-app')
  })
})
