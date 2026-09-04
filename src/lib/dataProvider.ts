/**
 * 存储后端抽象（v0.4 M5①）
 *
 * 所有持久化经由 DataProvider 转发：默认 localStorageProvider；
 * 未来切换 IndexedDB / 云端同步 / 多设备漫游时，只需实现接口并 setDataProvider，
 * 业务层（storage.ts 与各 store）零改动。
 */
export interface DataProvider {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  /** 当前后端中的全部 key（供 clearAll 等批量操作） */
  keys(): string[]
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch (err) {
    console.error('[storage] provider op failed:', err)
    return fallback
  }
}

/** 默认实现：浏览器 localStorage（隐私模式/超配额时静默降级为内存行为） */
export const localStorageProvider: DataProvider = {
  getItem: (key) => safe(() => localStorage.getItem(key), null),
  setItem: (key, value) => safe(() => localStorage.setItem(key, value), undefined),
  removeItem: (key) => safe(() => localStorage.removeItem(key), undefined),
  keys: () => safe(() => Object.keys(localStorage), []),
}

let active: DataProvider = localStorageProvider

/** 注入自定义后端（应用启动早期调用一次；测试中可注入内存实现） */
export function setDataProvider(provider: DataProvider): void {
  active = provider
}

export function getDataProvider(): DataProvider {
  return active
}
