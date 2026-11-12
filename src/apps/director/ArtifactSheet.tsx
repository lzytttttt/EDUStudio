/** 作战包交付物预览（Markdown 复用现有自研渲染器，含 {{值~来源}} 溯源 hover） */
import { ShieldCheck } from 'lucide-react'
import { AGENT_MAP, MISSION_TEMPLATES } from '../../harness/director/data'
import { freezeFacts } from '../../harness/director/facts'
import { verifyCitations } from '../../harness/director/verifyCitations'
import { renderMarkdown } from '../../lib/markdown'
import { useDirectorStore } from '../../stores/directorStore'
import { Sheet, AgentAvatar, Chip } from './shared'

export default function ArtifactSheet() {
  const artifactId = useDirectorStore((s) => s.artifactId)
  const missionKind = useDirectorStore((s) => s.mission.kind)
  const facts = useDirectorStore((s) => s.facts)
  const close = useDirectorStore((s) => s.closeArtifact)
  /* v1.1：交付物按剧本模板查；兜底跨模板查（门卡的缩略行在开战前也可能被点开） */
  const current = MISSION_TEMPLATES[missionKind]
  const artifact =
    current.artifacts.find((a) => a.id === artifactId) ??
    Object.values(MISSION_TEMPLATES)
      .flatMap((t) => t.artifacts)
      .find((a) => a.id === artifactId)
  const agent = artifact ? AGENT_MAP[artifact.owner] : null
  /* P0-3 落点：预览时按冻结事实快照校验统计型数字，只标「待核/冲突」不阻上屏 */
  const report = artifact ? verifyCitations(artifact.markdown, facts.length > 0 ? facts : freezeFacts()) : null

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
          {report && (
            <p
              data-testid="citation-report"
              className="mt-3 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-center text-[0.6875rem] text-ink-soft"
              title="统计型数字对照本次计划冻结的事实快照；结构性数字走白名单"
            >
              <ShieldCheck size={12} strokeWidth={1.8} className="text-mint" aria-hidden />
              数字溯源 {report.verified + report.derived}/{report.total}
              {report.derived > 0 && <span className="text-ink-mute">（含派生 {report.derived}）</span>}
              {report.conflicts > 0 && <span className="text-amber-ink">· 冲突 {report.conflicts}</span>}
              {report.unverified > 0 && <span className="text-amber-ink">· 待核 {report.unverified}</span>}
              {report.ok && <span className="text-mint-ink">· 全部可回溯</span>}
            </p>
          )}
          <p className="mt-1.5 text-center text-[0.625rem] text-ink-mute">AI 生成 · 已人工复核 · 演示未真实外发</p>
        </div>
      )}
    </Sheet>
  )
}
