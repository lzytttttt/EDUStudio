/** 作战包交付物预览（Markdown 复用现有自研渲染器，含 {{值~来源}} 溯源 hover） */
import { ARTIFACTS, AGENT_MAP } from '../../harness/director/data'
import { renderMarkdown } from '../../lib/markdown'
import { useDirectorStore } from '../../stores/directorStore'
import { Sheet, AgentAvatar, Chip } from './shared'

export default function ArtifactSheet() {
  const artifactId = useDirectorStore((s) => s.artifactId)
  const close = useDirectorStore((s) => s.closeArtifact)
  const artifact = ARTIFACTS.find((a) => a.id === artifactId)
  const agent = artifact ? AGENT_MAP[artifact.owner] : null

  return (
    <Sheet open={!!artifact} onClose={close} label="交付物" wide>
      {artifact && (
        <div>
          <div className="mb-4 flex items-center gap-2.5">
            <AgentAvatar agentId={artifact.owner} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-[0.9375rem] font-semibold leading-tight">{artifact.title}</p>
              <p className="mt-0.5 text-[0.625rem] text-ink-mute">{agent?.name} · {agent?.role}</p>
            </div>
            <Chip tone={agent?.tone ?? 'graphite'} className="ml-auto shrink-0">
              {artifact.kind}
            </Chip>
          </div>
          <div
            className="md-body d-fade max-h-[54vh] overflow-y-auto rounded-2xl border border-line bg-surface-2/60 px-4 py-3"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(artifact.markdown) }}
          />
          <p className="mt-3 text-center text-[0.625rem] text-ink-mute">AI 生成 · 已人工复核 · 演示未真实外发</p>
        </div>
      )}
    </Sheet>
  )
}
