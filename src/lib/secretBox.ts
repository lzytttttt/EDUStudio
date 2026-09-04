/**
 * API Key 混淆存储（v0.4 M5③）
 *
 * 威胁模型：本地落盘明文易被截图/误窥/浏览器同步泄露；XOR+base64 混淆使其不再「一眼可读」。
 * 注意：这是混淆而非强加密（密钥在前端包内，本就防不住有心人）；生产环境应走轻后端代理（proxy/），
 * Key 只存服务端，浏览器侧零 Key。
 */
const SALT = 'edustudio:v1'
const PREFIX = 'enc1:'

const saltBytes = new TextEncoder().encode(SALT)

function xor(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ saltBytes[i % saltBytes.length]
  return out
}

/** 明文 → 混淆串（enc1:base64）。空串原样返回。 */
export function conceal(plain: string): string {
  if (!plain) return ''
  const bytes = xor(new TextEncoder().encode(plain))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return PREFIX + btoa(bin)
}

/** 混淆串 → 明文。兼容历史明文（无前缀原样返回）；损坏输入返回空串。 */
export function reveal(boxed: string): string {
  if (!boxed) return ''
  if (!boxed.startsWith(PREFIX)) return boxed
  try {
    const bin = atob(boxed.slice(PREFIX.length))
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder().decode(xor(bytes))
  } catch {
    return ''
  }
}
