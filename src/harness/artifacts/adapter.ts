import type { ArtifactKind, ArtifactProvider, RoleId } from '../types'

/**
 * ArtifactApiAdapter —— 接入真实 LLM 生成文档时的适配骨架。
 * 接入步骤：实现 generate（调用 LLMProvider.streamChat + 结构化 prompt），
 * 然后在 providerRegistry 切换 ACTIVE_MODE。
 */
export class ArtifactApiAdapter implements ArtifactProvider {
  async generate(
    _input: { role: RoleId; goal: string; kindHint?: ArtifactKind; signal?: AbortSignal },
    _onChunk: (chunk: string) => void,
  ): Promise<{ title: string; kind: ArtifactKind }> {
    throw new Error('[ArtifactApiAdapter] API 模式尚未接入')
  }
}
