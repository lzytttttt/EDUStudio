import type { LLMProvider, ProviderMode, RoleId } from '../types'
import { MockLLMProvider } from './MockLLMProvider'
import { DeepSeekAdapter } from './adapter'

export function getLLMProvider(mode: ProviderMode, role: RoleId = 'teacher'): LLMProvider {
  if (mode === 'api') return new DeepSeekAdapter()
  const p = new MockLLMProvider(role)
  return p
}

export { MockLLMProvider, DeepSeekAdapter }
