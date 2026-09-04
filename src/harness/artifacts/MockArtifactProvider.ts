import type { ArtifactProvider, ArtifactKind, RoleId } from '../types'
import { typewriter } from '../../lib/typewriter'
import { matchTemplate } from '../scripts/artifacts'

export class MockArtifactProvider implements ArtifactProvider {
  async generate(
    input: { role: RoleId; goal: string; kindHint?: ArtifactKind; signal?: AbortSignal },
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
