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

/* ---------- 短链模式（v0.5 M2①）：内容存轻后端，URL 只带 id + 服务地址 ---------- */

export const SHORT_SHARE_PREFIX = '#s='

/** 短链 payload：`<id>.<base64url(apiBase)>`，接收方无需任何配置即可拉取 */
export function encodeShortPayload(id: string, apiBase: string): string {
  return `${id}.${bytesToB64Url(new TextEncoder().encode(apiBase))}`
}

export function decodeShortPayload(payload: string): { id: string; apiBase: string } | null {
  const dot = payload.indexOf('.')
  if (dot <= 0) return null
  const id = payload.slice(0, dot)
  try {
    const apiBase = new TextDecoder().decode(b64UrlToBytes(payload.slice(dot + 1)))
    if (!id || !/^https?:\/\//i.test(apiBase)) return null
    return { id, apiBase }
  } catch {
    return null
  }
}

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
  | { ok: true; url: string; mode: 'short' | 'inline'; shareId?: string }
  | { ok: false; reason: 'too-long' | 'encode-failed' }

/**
 * 生成分享链接（相对当前 origin；调用方可再拼绝对地址）。
 * v0.5 M2①：传入 apiBase 时优先走「短链」——快照存轻后端，URL 只带 id + 服务地址，
 * 彻底摆脱 URL 长度限制；服务不可用自动降级为压缩内联链接。
 */
export async function buildShareUrl(
  snapshot: ShareSnapshot,
  opts: { apiBase?: string | null } = {},
): Promise<ShareLinkResult> {
  const apiBase = opts.apiBase ?? null
  if (apiBase) {
    try {
      const res = await fetch(`${apiBase}/v1/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-EDU-Client': 'web' },
        body: JSON.stringify(snapshot),
      })
      if (res.ok) {
        const j = (await res.json()) as { id?: string }
        if (j.id) {
          const payload = encodeShortPayload(j.id, apiBase)
          return {
            ok: true,
            url: `${location.origin}${location.pathname}${SHORT_SHARE_PREFIX}${payload}`,
            mode: 'short',
            shareId: j.id,
          }
        }
      }
    } catch {
      /* 服务不可用 → 降级为内联压缩链接 */
    }
  }
  try {
    const json = JSON.stringify(snapshot)
    const raw = new TextEncoder().encode(json)
    const packed = await deflate(raw)
    const payload = packed ? `1.${bytesToB64Url(packed)}` : `0.${bytesToB64Url(raw)}`
    const url = `${location.origin}${location.pathname}${SHARE_PREFIX}${payload}`
    if (url.length > MAX_SHARE_URL_CHARS) return { ok: false, reason: 'too-long' }
    return { ok: true, url, mode: 'inline' }
  } catch (err) {
    console.error('[share] encode failed:', err)
    return { ok: false, reason: 'encode-failed' }
  }
}

/** 从 hash 解析快照；无效返回 null。支持短链（#s=）与内联压缩（#share=）两种形态 */
export async function parseShareUrl(hash: string): Promise<ShareSnapshot | null> {
  if (hash.startsWith(SHORT_SHARE_PREFIX)) {
    const decoded = decodeShortPayload(hash.slice(SHORT_SHARE_PREFIX.length))
    if (!decoded) return null
    try {
      const res = await fetch(`${decoded.apiBase}/v1/share/${encodeURIComponent(decoded.id)}`, {
        headers: { 'X-EDU-Client': 'web' },
      })
      if (!res.ok) return null
      const j = (await res.json()) as { snapshot?: ShareSnapshot; annotations?: ShareAnnotation[] }
      const snap = j.snapshot
      if (!snap || snap.v !== 1 || typeof snap.content !== 'string' || typeof snap.title !== 'string') return null
      // 服务端批注优先（评审闭环：作者端/接收端都能看到回传的最新批注）
      return { ...snap, annotations: j.annotations ?? snap.annotations ?? [] }
    } catch (err) {
      console.error('[share] short link fetch failed:', err)
      return null
    }
  }
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

/** 批注回传到轻后端（v0.5 M2②）；服务不可用返回 false（本地仍已保存，不丢数据） */
export async function pushShareAnnotations(
  apiBase: string,
  shareId: string,
  annotations: ShareAnnotation[],
): Promise<boolean> {
  try {
    const res = await fetch(`${apiBase}/v1/share/${encodeURIComponent(shareId)}/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-EDU-Client': 'web' },
      body: JSON.stringify({ annotations }),
    })
    return res.ok
  } catch {
    return false
  }
}
