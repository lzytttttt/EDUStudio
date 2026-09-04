import type { BriefingProvider, ProviderMode } from '../types'
import { MockBriefingProvider } from './MockBriefingProvider'

export function getBriefingProvider(mode: ProviderMode): BriefingProvider {
  if (mode === 'api') {
    console.warn('[briefing] API 模式未接入，回退 Mock 剧本')
  }
  return new MockBriefingProvider()
}

export { MockBriefingProvider }
