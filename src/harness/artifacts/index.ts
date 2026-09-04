import type { ArtifactProvider, ProviderMode } from '../types'
import { MockArtifactProvider } from './MockArtifactProvider'
import { ArtifactApiAdapter } from './adapter'

export function getArtifactProvider(mode: ProviderMode): ArtifactProvider {
  if (mode === 'api') return new ArtifactApiAdapter()
  return new MockArtifactProvider()
}

export { MockArtifactProvider, ArtifactApiAdapter }
