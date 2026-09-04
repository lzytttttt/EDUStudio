import type { AgentProvider, ProviderMode } from '../types'
import { MockOrchestrator } from './MockOrchestrator'
import { Orchestrator } from './Orchestrator'
import { MockArtifactProvider } from '../artifacts/MockArtifactProvider'
import { toolRegistry } from './ToolRegistry'

export function getAgentProvider(mode: ProviderMode): AgentProvider {
  if (mode === 'api') return new Orchestrator()
  return new MockOrchestrator(new MockArtifactProvider())
}

export { MockOrchestrator, Orchestrator, toolRegistry }
