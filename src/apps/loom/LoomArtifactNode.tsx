/**
 * Loom 文档（Artifact）节点（v0.9.4 M6）
 *
 * 展示由 `artifact_meta` 占位生成的文档节点：
 *   正在生成（amber 呼吸）→ 已生成（mint）；
 * 提供「打开」回调，由主线接到 uiStore.requestDocFocus() / artifactStore.setActive。
 *
 * 只做展示 + 回调，不改任何 store 逻辑。
 */
import { Check, ExternalLink, FileText, Loader2 } from 'lucide-react'
import { useReducedMotion } from './LoomTraceSubgraph'

/** 文档节点的展示输入（与 LoomNode 解耦，便于画布与投影两处复用） */
export interface LoomArtifactItem {
  id: string
  title: string
  generating: boolean
  done: boolean
  failed?: boolean
  /** 绑定 ArtifactDoc 时可打开右栏「文档」 */
  artifactId?: string
}

interface LoomArtifactNodeProps {
  item: LoomArtifactItem
  /** 打开文档（主线接右栏「文档」tab） */
  onOpen?: (nodeId: string, artifactId: string) => void
}

export function LoomArtifactNode({ item, onOpen }: LoomArtifactNodeProps) {
  const reduced = useReducedMotion()
  const { id, title, generating, done, failed, artifactId } = item

  return (
    <div data-testid="loom-artifact-node" className="mt-1.5 rounded-xl border border-line bg-white/70 px-2 py-1.5">
      <p className="flex items-center gap-1">
        <FileText size={10} className="shrink-0 text-primary" />
        <span className="truncate text-[0.6875rem] font-semibold text-ink">{title}</span>
      </p>
      <div className="mt-1 flex items-center gap-1.5 text-[0.625rem] font-medium">
        {generating ? (
          <>
            {reduced ? (
              <span className="h-2 w-2 shrink-0 rounded-full bg-amber" />
            ) : (
              <Loader2 size={10} className="shrink-0 animate-spin text-amber" />
            )}
            <span className="text-amber">正在生成</span>
          </>
        ) : done ? (
          <>
            <Check size={10} className="text-mint" />
            <span className="text-mint">已生成</span>
          </>
        ) : failed ? (
          <span className="text-danger">生成失败</span>
        ) : (
          <span className="text-ink-mute">待生成</span>
        )}

        {artifactId && onOpen && (
          <button
            type="button"
            data-testid="loom-artifact-open"
            onClick={(e) => {
              e.stopPropagation()
              onOpen(id, artifactId)
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-full border border-line px-1.5 py-0.5 text-[0.5625rem] text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <ExternalLink size={9} />
            打开
          </button>
        )}
      </div>
    </div>
  )
}
