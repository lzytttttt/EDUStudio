import type { ProviderMode } from './types'
import { getLLMProvider } from './llm'
import { getAgentProvider } from './agent'
import { getBriefingProvider } from './briefing'
import { getArtifactProvider } from './artifacts'

/**
 * 统一注册中心：切换 ACTIVE_MODE 即可在 Mock 与真实 API 间整体切换，
 * 业务代码只依赖 harness/types 契约，零改动。
 */
export const ACTIVE_MODE: ProviderMode = 'mock'

export const providers = {
  llm: getLLMProvider(ACTIVE_MODE),
  agent: getAgentProvider(ACTIVE_MODE),
  briefing: getBriefingProvider(ACTIVE_MODE),
  artifacts: getArtifactProvider(ACTIVE_MODE),
}
