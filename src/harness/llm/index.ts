import type { LLMProvider, ProviderMode, RoleId } from '../types'
import { MockLLMProvider } from './MockLLMProvider'
import { DeepSeekAdapter, type DeepSeekConfig } from './adapter'

export function getLLMProvider(
  mode: ProviderMode,
  role: RoleId = 'teacher',
  config?: DeepSeekConfig,
): LLMProvider {
  if (mode === 'api') {
    return new DeepSeekAdapter(
      config ?? { baseUrl: 'https://api.deepseek.com/v1', apiKey: '', model: 'deepseek-chat' },
    )
  }
  return new MockLLMProvider(role)
}

export { MockLLMProvider, DeepSeekAdapter }
export type { DeepSeekConfig }
