/**
 * API Key 有效性检测（v0.5 M5②）
 *
 * 用 GET {base}/models 轻量探测（不消耗对话额度）：
 * - 401/403 → Key 无效或已过期；
 * - 其他非 2xx → 服务异常，暂无法验证；
 * - 网络错误 → 无法连接。
 */
export interface KeyCheckResult {
  ok: boolean
  message: string
}

export async function checkApiKey(baseUrl: string, apiKey: string): Promise<KeyCheckResult> {
  if (!apiKey.trim()) return { ok: false, message: '请先填写 API Key' }
  const base = baseUrl.trim().replace(/\/+$/, '')
  try {
    const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${apiKey}` } })
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: 'Key 无效或已过期（401）' }
    }
    if (!res.ok) {
      return { ok: false, message: `服务返回 ${res.status}，暂无法验证` }
    }
    return { ok: true, message: 'Key 有效' }
  } catch {
    return { ok: false, message: '网络错误，无法连接服务' }
  }
}
