/**
 * 轻后端 API 访问（v0.5 M2①）
 *
 * 由设置中的代理地址推导 API 根地址：`http://host:8787/v1` → `http://host:8787`。
 * 未配置代理（直连模式）返回 null，调用方降级为纯前端方案（压缩链接 / 本地存储）。
 */
import { useSettingsStore } from '../stores/settingsStore'

export function getApiBase(): string | null {
  const proxy = useSettingsStore.getState().proxyUrl.trim()
  if (!proxy) return null
  return proxy.replace(/\/v1\/?$/, '').replace(/\/+$/, '')
}

/** 轻后端 JSON 请求封装：非 2xx 抛出带错误码的 Error（如 content_blocked:赌博） */
export async function apiJson<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-EDU-Client': 'web', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    let code = `http_${res.status}`
    try {
      const j = (await res.json()) as { error?: string }
      if (j?.error) code = j.error
    } catch {
      /* 非 JSON 响应体 */
    }
    throw new Error(code)
  }
  return (await res.json()) as T
}
