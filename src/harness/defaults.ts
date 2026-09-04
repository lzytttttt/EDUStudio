import type { ProviderMode } from './types'

/**
 * Harness 默认配置（独立模块，避免 settingsStore ↔ providerRegistry 循环依赖）。
 * ACTIVE_MODE 仅作为 settingsStore 的初始默认值；运行时切换由设置页驱动。
 */
export const ACTIVE_MODE: ProviderMode = 'mock'

/** 默认 LLM 配置（OpenAI 兼容端点） */
export const DEFAULT_LLM_BASEURL = 'https://opencode.ai/zen/v1'
export const DEFAULT_LLM_MODEL = 'deepseek-v4-flash'
