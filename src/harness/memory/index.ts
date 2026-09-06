import type { MemoryProvider, MemoryProviderConfig, ProviderMode } from '../types'
import { MockMemoryProvider } from './MockMemoryProvider'

/**
 * 记忆 Provider 工厂（v0.9.1）：本地单实现，mock / api 共用（纯前端轻定位，不做服务端同步）。
 * ProviderMode 参数预留：后续接 LLM 版偏好提炼 / 云端记忆时按 mode 分流。
 */
export function getMemoryProvider(_mode?: ProviderMode, config?: MemoryProviderConfig): MemoryProvider {
  return new MockMemoryProvider(config)
}

export { MockMemoryProvider } from './MockMemoryProvider'
export { formatEpisodicLines, formatMemoryBlock, formatSemanticLines } from './format'
