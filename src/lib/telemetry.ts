/**
 * 前端错误上报（v0.5 M4⑤）
 *
 * 全局捕获 error / unhandledrejection，采样上报到轻后端 /v1/telemetry。
 * 未配置代理（直连模式）时静默跳过；上报内容仅含错误摘要与来源，不含对话内容。
 */
import { getApiBase } from './api'

let installed = false

function send(payload: Record<string, unknown>): void {
  const base = getApiBase()
  if (!base) return
  try {
    void fetch(`${base}/v1/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-EDU-Client': 'web' },
      body: JSON.stringify({ ...payload, url: location.href, t: Date.now() }),
      keepalive: true,
    }).catch(() => {
      /* 上报失败静默 */
    })
  } catch {
    /* 上报失败静默 */
  }
}

export function installTelemetry(): void {
  if (installed) return
  installed = true
  window.addEventListener('error', (e) => {
    send({
      type: 'error',
      message: String(e.message ?? 'unknown').slice(0, 500),
      source: `${e.filename ?? ''}:${e.lineno ?? 0}:${e.colno ?? 0}`,
    })
  })
  window.addEventListener('unhandledrejection', (e) => {
    send({ type: 'unhandledrejection', message: String(e.reason ?? 'unknown').slice(0, 500), source: '' })
  })
}
