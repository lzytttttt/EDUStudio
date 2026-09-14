import type { ProviderMode } from './types'

/**
 * Harness 默认配置（独立模块，避免 settingsStore ↔ providerRegistry 循环依赖）。
 * ACTIVE_MODE 仅作为 settingsStore 的初始默认值；运行时切换由设置页驱动。
 */
export const ACTIVE_MODE: ProviderMode = 'mock'

/** 默认 LLM 配置（OpenAI 兼容端点） */
export const DEFAULT_LLM_BASEURL = 'https://opencode.ai/zen/v1'
export const DEFAULT_LLM_MODEL = 'deepseek-v4-flash'

/**
 * 构建时注入的轻后端代理地址（静态托管环境变量 `VITE_PROXY_URL`，如
 * `https://edustudio-proxy.<account>.workers.dev/v1`）。
 *
 * 非空时前端首次启动即为代理模式，用户无需在设置页手填；缺省空串 = 沿用直连模式。
 * 用户在设置页显式修改 / 清空后以用户值为准（持久化于 localStorage）。
 */
export const DEFAULT_PROXY_URL = (import.meta.env.VITE_PROXY_URL ?? '').trim().replace(/\/+$/, '')

/** 默认远端数据源地址：优先 `VITE_SOURCE_URL`，其次由代理地址推导（同域 `/api/sources`），最后回落本地代理 */
export const DEFAULT_SOURCE_URL =
  (import.meta.env.VITE_SOURCE_URL ?? '').trim().replace(/\/+$/, '') ||
  (DEFAULT_PROXY_URL
    ? `${DEFAULT_PROXY_URL.replace(/\/v1\/?$/, '')}/api/sources`
    : 'http://localhost:8787/api/sources')
