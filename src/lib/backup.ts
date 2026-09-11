/**
 * 全量备份 / 恢复（v0.9 M2①）
 *
 * 背景：会话 / 文档 / 收藏 / 技能 / 成绩 CSV 全存 LocalStorage，换设备或清缓存即全部丢失。
 * 本模块提供「一个文件救所有数据」的 JSON 全量快照：导出即下载、恢复即覆盖 + reload。
 *
 * 安全边界：
 * - apiKey 落盘已是 `enc1:` 混淆串（lib/secretBox），导出按混淆态原样携带，恢复侧 reveal 兼容；
 * - 恢复侧键名白名单过滤：旧文件新键 / 新文件旧键均安全降级（跨版本前向兼容）；
 * - 仅本地备份，不做服务端同步（v0.9 范围决策）。
 */
import { getDataProvider } from './dataProvider'

const NS = 'edustudio:'

/** 备份文件格式版本（结构变更时 +1，恢复侧按版本兼容） */
export const BACKUP_FORMAT_VERSION = 1

/** 允许恢复的键名白名单（不含 edustudio: 前缀；与各 store 的 saveJSON 键对齐） */
export const BACKUP_KEY_WHITELIST: readonly string[] = [
  'settings',
  'auth',
  'briefing',
  'chat',
  'artifacts',
  'quiz',
  'skills',
  'taskFlows',
  'notifications',
  'importedData',
  'importedDocs',
  'memory',
  'loom',
]

/** 分享批注为动态键（share-anno-<snapshotKey>），按前缀放行 */
const SHARE_ANNO_PREFIX = 'share-anno-'

/** 备份文件结构：app 标识用于拒绝非本应用文件 */
export interface BackupFile {
  app: 'edustudio'
  version: number
  exportedAt: string
  /** 键名（不含 edustudio: 前缀）→ JSON 值 */
  data: Record<string, unknown>
}

export interface ImportResult {
  ok: boolean
  message: string
  /** 实际恢复的键数量 */
  restored: number
  /** 被白名单过滤跳过的未知键数量 */
  skipped: number
}

/** 遍历 edustudio: 前缀全部键，收集为 data 映射（损坏 JSON 的键跳过） */
export function collectBackupData(): { data: Record<string, unknown>; keys: number } {
  const provider = getDataProvider()
  const data: Record<string, unknown> = {}
  let keys = 0
  for (const full of provider.keys()) {
    if (!full.startsWith(NS)) continue
    const raw = provider.getItem(full)
    if (raw == null) continue
    try {
      data[full.slice(NS.length)] = JSON.parse(raw)
      keys++
    } catch {
      /* 损坏键不进备份 */
    }
  }
  return { data, keys }
}

/** 组装备份文件（now 可注入，测试用） */
export function buildBackupFile(now = new Date()): BackupFile {
  const { data } = collectBackupData()
  return {
    app: 'edustudio',
    version: BACKUP_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    data,
  }
}

/** 备份文件名：edustudio-backup-YYYYMMDD-HHmm.json */
export function backupFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `edustudio-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}.json`
  )
}

/** 触发浏览器下载备份 JSON */
export function downloadBackup(file: BackupFile, now = new Date()): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = backupFileName(now)
  a.click()
  URL.revokeObjectURL(url)
}

/** 校验备份文件：JSON 可解析 + app 标识 + data 结构 */
export function parseBackupFile(raw: string): { ok: true; file: BackupFile } | { ok: false; message: string } {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return { ok: false, message: '文件不是有效的 JSON，无法恢复' }
  }
  const f = json as Partial<BackupFile>
  if (!f || f.app !== 'edustudio' || typeof f.version !== 'number' || !f.data || typeof f.data !== 'object') {
    return { ok: false, message: '不是 EDUStudio 备份文件（缺少应用标识），请检查是否选错文件' }
  }
  return { ok: true, file: json as BackupFile }
}

/**
 * 全量覆盖恢复：先清空本机 edustudio: 数据，再按白名单写入。
 * 不自动 reload——由调用方在确认后执行（保持纯逻辑可测）。
 */
export function importAll(file: BackupFile): ImportResult {
  const provider = getDataProvider()
  let restored = 0
  let skipped = 0
  for (const full of provider.keys()) {
    if (full.startsWith(NS)) provider.removeItem(full)
  }
  for (const [key, value] of Object.entries(file.data)) {
    const allowed = BACKUP_KEY_WHITELIST.includes(key) || key.startsWith(SHARE_ANNO_PREFIX)
    if (!allowed) {
      skipped++
      continue
    }
    try {
      provider.setItem(NS + key, JSON.stringify(value))
      restored++
    } catch {
      skipped++
    }
  }
  return {
    ok: true,
    message: restored > 0 ? `已恢复 ${restored} 项数据` : '备份中没有可恢复的数据',
    restored,
    skipped,
  }
}
