import { afterEach, describe, expect, it } from 'vitest'
import {
  BACKUP_FORMAT_VERSION,
  backupFileName,
  buildBackupFile,
  importAll,
  parseBackupFile,
} from '../lib/backup'
import { localStorageProvider, setDataProvider, type DataProvider } from '../lib/dataProvider'

/* 全量备份 / 恢复（v0.9 M2①）：导出→恢复往返、白名单过滤、文件校验（M8①） */

/** 内存后端（测试隔离：不污染真实 localStorage） */
function memoryProvider(): DataProvider & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, v)
    },
    removeItem: (k) => {
      store.delete(k)
    },
    keys: () => [...store.keys()],
  }
}

afterEach(() => setDataProvider(localStorageProvider))

describe('backup 导出/恢复往返（v0.9 M2①/M8①）', () => {
  it('导出→恢复往返：键值一致；恢复前清空既有数据（覆盖语义）', () => {
    const p = memoryProvider()
    setDataProvider(p)
    p.setItem('edustudio:settings', JSON.stringify({ mode: 'mock' }))
    p.setItem('edustudio:importedDocs', JSON.stringify([{ id: 'd1' }]))

    const file = buildBackupFile(new Date('2026-09-06T12:00:00Z'))
    expect(file.app).toBe('edustudio')
    expect(file.version).toBe(BACKUP_FORMAT_VERSION)
    expect(file.data.settings).toEqual({ mode: 'mock' })
    expect(file.data.importedDocs).toEqual([{ id: 'd1' }])

    p.setItem('edustudio:chat', JSON.stringify({ stale: true })) // 恢复前应被清空
    const res = importAll(file)
    expect(res.ok).toBe(true)
    expect(res.restored).toBe(2)
    expect(JSON.parse(p.store.get('edustudio:settings')!)).toEqual({ mode: 'mock' })
    expect(p.store.has('edustudio:chat')).toBe(false)
  })

  it('白名单过滤：未知键跳过并计数；share-anno- 前缀放行', () => {
    const p = memoryProvider()
    setDataProvider(p)
    const res = importAll({
      app: 'edustudio',
      version: 1,
      exportedAt: new Date().toISOString(),
      data: { settings: { a: 1 }, 'unknown-key': { x: 1 }, 'share-anno-abc': { note: 1 } },
    })
    expect(res.restored).toBe(2)
    expect(res.skipped).toBe(1)
    expect(p.store.has('edustudio:unknown-key')).toBe(false)
    expect(p.store.get('edustudio:share-anno-abc')).toBe('{"note":1}')
  })

  it('损坏 JSON 的键不进备份（导出侧容错）', () => {
    const p = memoryProvider()
    setDataProvider(p)
    p.setItem('edustudio:settings', '{"ok":1}')
    p.setItem('edustudio:broken', 'not-json{')
    const file = buildBackupFile()
    expect(file.data.settings).toEqual({ ok: 1 })
    expect(file.data.broken).toBeUndefined()
  })
})

describe('parseBackupFile 校验（v0.9 M2①/M8①）', () => {
  it('非 JSON / 缺 app 标识 → 拒绝并给出中文提示', () => {
    expect(parseBackupFile('not json').ok).toBe(false)
    const bad = parseBackupFile(JSON.stringify({ app: 'other', version: 1, data: {} }))
    if (!bad.ok) expect(bad.message).toContain('EDUStudio')
    else expect.unreachable('应拒绝非本应用文件')
  })

  it('合法文件通过校验', () => {
    const good = parseBackupFile(
      JSON.stringify({ app: 'edustudio', version: 1, exportedAt: 'x', data: { settings: {} } }),
    )
    expect(good.ok).toBe(true)
  })
})

describe('backupFileName 格式（v0.9 M2①/M8①）', () => {
  it('edustudio-backup-YYYYMMDD-HHmm.json（两位补零）', () => {
    expect(backupFileName(new Date(2026, 8, 6, 9, 5))).toBe('edustudio-backup-20260906-0905.json')
  })
})
