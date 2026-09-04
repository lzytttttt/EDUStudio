import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setDataProvider, getDataProvider, type DataProvider } from '../lib/dataProvider'
import { loadJSON, saveJSON, removeKey, clearAll } from '../lib/storage'

/** 内存后端：模拟未来 IndexedDB / 云端同步实现 */
function memoryProvider(): DataProvider {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    keys: () => [...map.keys()],
  }
}

const original = getDataProvider()

describe('dataProvider 抽象（v0.4 M5①）', () => {
  beforeEach(() => setDataProvider(memoryProvider()))
  afterEach(() => setDataProvider(original))

  it('loadJSON/saveJSON 经注入的后端读写', () => {
    saveJSON('foo', { a: 1 })
    expect(loadJSON<{ a: number }>('foo', { a: 0 })).toEqual({ a: 1 })
    expect(loadJSON('missing', 'fb')).toBe('fb')
  })

  it('removeKey / clearAll 只清理命名空间内 key', () => {
    saveJSON('a', 1)
    saveJSON('b', 2)
    removeKey('a')
    expect(loadJSON('a', null)).toBeNull()
    clearAll()
    expect(loadJSON('b', null)).toBeNull()
  })

  it('切换回 localStorage 后端后互不串数据', () => {
    saveJSON('only-mem', 'x')
    setDataProvider(original)
    expect(loadJSON('only-mem', null)).toBeNull()
  })
})
