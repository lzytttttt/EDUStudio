import type { MemoryEntry, MemoryProvider, MemoryProviderConfig, RoleId } from '../types'
import {
  EPISODIC_LIMIT,
  extractPrefs as extractPrefsPure,
  selectEpisodicRole,
  selectSemanticRole,
  useMemoryStore,
} from '../../stores/memoryStore'

/**
 * MemoryProvider 契约的本地实现（v0.9.1）：mock / api 共用（纯前端轻定位，不做服务端同步）。
 * 委托 memoryStore 完成持久化、环形裁剪与语义合并；自身只做契约适配 + 裁剪参数注入（测试可配）。
 * 记录一律按 role 隔离——读取侧 select* 已按角色前缀过滤，跨角色记忆不互见。
 */
export class MockMemoryProvider implements MemoryProvider {
  private readonly episodicLimit: number

  constructor(config?: MemoryProviderConfig) {
    this.episodicLimit = config?.episodicLimit ?? EPISODIC_LIMIT
  }

  async record(input: MemoryEntry): Promise<void> {
    if (input.kind === 'semantic') {
      if (input.key) useMemoryStore.getState().upsertSemantic(input)
      return
    }
    // L2 情景记忆入环形队列（超限淘汰最旧）
    useMemoryStore.getState().recordEpisodic(input, this.episodicLimit)
    // 反馈收割：采纳/拒绝等结果提炼 L3 语义偏好（规则版，零 LLM 成本）
    for (const pref of extractPrefsPure(input)) useMemoryStore.getState().upsertSemantic(pref)
  }

  async recentEpisodic(role: RoleId, limit = 3): Promise<MemoryEntry[]> {
    try {
      return selectEpisodicRole(useMemoryStore.getState().episodic, role, limit)
    } catch {
      return []
    }
  }

  async semanticFor(role: RoleId): Promise<MemoryEntry[]> {
    try {
      return selectSemanticRole(useMemoryStore.getState().semantic, role)
    } catch {
      return []
    }
  }

  async extractPrefs(entry: MemoryEntry): Promise<MemoryEntry[]> {
    return extractPrefsPure(entry)
  }
}
