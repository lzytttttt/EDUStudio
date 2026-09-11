import type { ArtifactProvider, ArtifactKind, LoomUpstreamRef, RoleId } from '../types'
import { typewriter } from '../../lib/typewriter'
import { matchTemplate } from '../scripts/artifacts'

export class MockArtifactProvider implements ArtifactProvider {
  async generate(
    /* v0.9.4-03：upstream 契约兼容（Mock 模板渲染不消费，仅保持签名一致） */
    input: { role: RoleId; goal: string; kindHint?: ArtifactKind; signal?: AbortSignal; upstream?: LoomUpstreamRef[] },
    onChunk: (chunk: string) => void,
  ): Promise<{ title: string; kind: ArtifactKind }> {
    const tpl = matchTemplate(input.goal, input.role)
    const md = tpl.render(input.goal)
    for await (const chunk of typewriter(md, { minChunk: 3, maxChunk: 8, minDelay: 8, maxDelay: 22, signal: input.signal })) {
      onChunk(chunk)
    }
    return { title: tpl.title(input.goal), kind: tpl.kind }
  }
}
