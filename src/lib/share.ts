/**
 * 文档分享快照（v0.4 M2①②：纯前端零后端）
 *
 * 原理：文档内容 + 批注序列化为 JSON → deflate 压缩 → base64url → hash 路由
 * `#share=1.<data>`（1=压缩，0=未压缩 fallback）。接收方打开链接即得只读视图，
 * 校长/局角色可添加批注后「复制带批注的链接」回传，形成评审闭环。
 *
 * 长度保护：主流浏览器 URL 安全上限约 8K 字符，超限返回 too-long，
 * 调用方降级提示「导出文件分享」。
 */

export interface ShareAnnotation {
  id: string
  /** 批注人显示名 */
  author: string
  /** 批注人角色（bureau/schoolAdmin/teacher/guest） */
  role: string
  /** 批注锚定的原文片段 */
  quote: string
  /** 批注内容 */
  text: string
  createdAt: number
}

export interface ShareSnapshot {
  v: 1
  title: string
  kind: string
  role: string
  content: string
  createdAt: number
  author?: string
  annotations?: ShareAnnotation[]
}

/** 分享 URL 总长上限（含 `#share=` 前缀），留足浏览器兼容余量 */
export const MAX_SHARE_URL_CHARS = 8000

const SHARE_PREFIX = '#share='

/* ---------- base64url ---------- */

function bytesToB64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(padded)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/* ---------- 压缩（CompressionStream 不可用时自动降级为不压缩） ---------- */

async function deflate(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null
  try {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}

async function inflate(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null
  try {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}

/* ---------- 编解码 ---------- */

export type ShareLinkResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'too-long' | 'encode-failed' }

/** 生成分享链接（相对当前 origin；调用方可再拼绝对地址） */
export async function buildShareUrl(snapshot: ShareSnapshot): Promise<ShareLinkResult> {
  try {
    const json = JSON.stringify(snapshot)
    const raw = new TextEncoder().encode(json)
    const packed = await deflate(raw)
    const payload = packed ? `1.${bytesToB64Url(packed)}` : `0.${bytesToB64Url(raw)}`
    const url = `${location.origin}${location.pathname}${SHARE_PREFIX}${payload}`
    if (url.length > MAX_SHARE_URL_CHARS) return { ok: false, reason: 'too-long' }
    return { ok: true, url }
  } catch (err) {
    console.error('[share] encode failed:', err)
    return { ok: false, reason: 'encode-failed' }
  }
}

/** 从 hash 解析快照；无效返回 null */
export async function parseShareUrl(hash: string): Promise<ShareSnapshot | null> {
  if (!hash.startsWith(SHARE_PREFIX)) return null
  const payload = hash.slice(SHARE_PREFIX.length)
  const dot = payload.indexOf('.')
  if (dot <= 0) return null
  const mode = payload.slice(0, dot)
  const data = payload.slice(dot + 1)
  try {
    let bytes: Uint8Array
    if (mode === '1') {
      const inflated = await inflate(b64UrlToBytes(data))
      if (!inflated) return null
      bytes = inflated
    } else if (mode === '0') {
      bytes = b64UrlToBytes(data)
    } else {
      return null
    }
    const obj = JSON.parse(new TextDecoder().decode(bytes)) as ShareSnapshot
    if (obj?.v !== 1 || typeof obj.content !== 'string' || typeof obj.title !== 'string') return null
    return obj
  } catch (err) {
    console.error('[share] decode failed:', err)
    return null
  }
}

/** 快照稳定 key（批注本地存储用）：标题 + 内容 + 创建时间 */
export function snapshotKey(snapshot: ShareSnapshot): string {
  const src = `${snapshot.title}|${snapshot.createdAt}|${snapshot.content}`
  let h = 5381
  for (let i = 0; i < src.length; i++) h = ((h << 5) + h + src.charCodeAt(i)) >>> 0
  return h.toString(36)
}

/** 生成批注 id */
export function newAnnotationId(): string {
  return `anno-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}
