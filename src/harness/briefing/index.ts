import type { BriefingProvider, ProviderMode } from '../types'
import type { DeepSeekConfig } from '../llm/adapter'
import { MockBriefingProvider } from './MockBriefingProvider'
import { ApiBriefingProvider } from './ApiBriefingProvider'

/** mock → Mock 剧本；api → LLM 生成骨架（失败自动回退 Mock），签名对齐 getArtifactProvider */
export function getBriefingProvider(mode: ProviderMode, config?: DeepSeekConfig): BriefingProvider {
  if (mode === 'api') {
    if (config) return new ApiBriefingProvider(config)
    console.warn('[briefing] API 模式缺少模型配置，回退 Mock 剧本')
  }
  return new MockBriefingProvider()
}

export { MockBriefingProvider, ApiBriefingProvider }
