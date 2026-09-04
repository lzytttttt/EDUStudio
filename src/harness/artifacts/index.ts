import type { ArtifactProvider, ProviderMode } from '../types'
import { MockArtifactProvider } from './MockArtifactProvider'
import { ArtifactApiAdapter } from './adapter'
import type { DeepSeekConfig } from '../llm/adapter'

export function getArtifactProvider(mode: ProviderMode, config?: DeepSeekConfig): ArtifactProvider {
  if (mode === 'api') return new ArtifactApiAdapter(config ?? { baseUrl: 'https://api.deepseek.com/v1', apiKey: '', model: 'deepseek-chat' })
  return new MockArtifactProvider()
}

export { MockArtifactProvider, ArtifactApiAdapter }
