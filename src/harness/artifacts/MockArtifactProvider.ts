import type { ArtifactProvider, ArtifactKind, LoomUpstreamRef, RoleId } from '../types'
import { typewriter } from '../../lib/typewriter'
import { matchTemplate } from '../scripts/artifacts'
import { buildRenderContext } from '../sources/dataContext'

export class MockArtifactProvider implements ArtifactProvider {
  async generate(
    /* v0.9.4-03：upstream 契约兼容（Mock 模板渲染不消费，仅保持签名一致） */
    input: { role: RoleId; goal: string; kindHint?: ArtifactKind; signal?: AbortSignal; upstream?: LoomUpstreamRef[] },
    onChunk: (chunk: string) => void,
  ): Promise<{ title: string; kind: ArtifactKind }> {
    const tpl = matchTemplate(input.goal, input.role)
    /* v0.9.5 P0-A：报告按真实数据渲染，而非誊抄模板里的固定数字。
       渲染器动态 import：它只在生成报告时用得上，不该占首屏主 chunk 预算。 */
    const md =
      tpl.kind === 'report'
        ? (await import('../scripts/report')).renderReport(input.goal, await buildRenderContext())
        : tpl.render(input.goal)
    for await (const chunk of typewriter(md, { minChunk: 3, maxChunk: 8, minDelay: 8, maxDelay: 22, signal: input.signal })) {
      onChunk(chunk)
    }
    return { title: tpl.title(input.goal), kind: tpl.kind }
  }
}
