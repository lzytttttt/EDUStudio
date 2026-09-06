import type {
  AgentProvider,
  BriefingProvider,
  ArtifactProvider,
  Evaluator,
  LLMProvider,
  MemoryProvider,
  ProviderMode,
} from './types'
import { getLLMProvider, type DeepSeekConfig } from './llm'
import { getAgentProvider } from './agent'
import { getBriefingProvider } from './briefing'
import { getArtifactProvider } from './artifacts'
import { getMemoryProvider } from './memory'
import { getEvaluator } from './eval'
import { useSettingsStore } from '../stores/settingsStore'

export { ACTIVE_MODE } from './defaults'

export interface Providers {
  llm: LLMProvider
  agent: AgentProvider
  briefing: BriefingProvider
  artifacts: ArtifactProvider
  /** v0.9.1 记忆分层：本地实现不分 mode，随配置缓存构建 */
  memory: MemoryProvider
  /** v0.9.1 产出自评：规则版零 LLM 成本，本地实现不分 mode */
  eval: Evaluator
}

/**
 * 统一注册中心（v0.2 起运行时切换）：
 * getProviders() 按 settingsStore 当前配置惰性构建并缓存 providers；
 * 配置（mode/baseUrl/model/apiKey/proxyUrl）任一变化 → 缓存自动失效重建。
 * 业务代码只依赖 harness/types 契约，Mock ↔ API 切换零业务改动。
 */
let cached: { key: string; providers: Providers } | null = null

function buildProviders(s: {
  mode: ProviderMode
  baseUrl: string
  model: string
  apiKey: string
  proxyUrl: string
}): Providers {
  const config: DeepSeekConfig = {
    baseUrl: s.baseUrl,
    apiKey: s.apiKey,
    model: s.model,
    proxyUrl: s.proxyUrl || undefined,
  }
  return {
    llm: getLLMProvider(s.mode, 'teacher', config),
    agent: getAgentProvider(s.mode, config),
    briefing: getBriefingProvider(s.mode, config),
    artifacts: getArtifactProvider(s.mode, config),
    // v0.9.1：记忆 / 自评为本地实现，mock / api 共用（mode 参数预留二期分流）
    memory: getMemoryProvider(),
    eval: getEvaluator(),
  }
}

export function getProviders(): Providers {
  const s = useSettingsStore.getState()
  const key = `${s.mode}|${s.baseUrl}|${s.model}|${s.apiKey}|${s.proxyUrl}`
  if (cached?.key === key) return cached.providers
  cached = { key, providers: buildProviders(s) }
  return cached.providers
}

/** 手动失效缓存（一般无需调用：getProviders 的 key 已含全部配置） */
export function invalidateProviders(): void {
  cached = null
}
