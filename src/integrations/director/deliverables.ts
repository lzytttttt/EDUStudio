/**
 * v1.2 M2 · mission 交付物发布桥（Director chunk，roadmap §4.5 的 M2 前置段）
 *
 * 职责：把总指挥 mission 完成时产出的交付物（Director 模板 ArtifactTile）
 * 发布进旧 `artifactStore`（占位 → 内容 → 定稿，带 provenance 与 citations），
 * 从而复用旧的版本 / 导出 / 分享 / 自评能力，**不在 Director 里复制第二套文档实体**。
 *
 * 约定（§3.5「端口为何不是共享 store」）：本文件是唯一同时认识 Director 与旧 store 的桥；
 * 只由 Director chunk（CommandCenter）在挂载时调用 `installMissionDeliverablesBridge()`，
 * 主 chunk 不 import 本文件。M2 采用幂等发布（同一 missionId + 交付物标题只发一次）。
 */
import { missionTemplate } from '../../harness/director/data'
import type { ArtifactKindCn, DirectorAgentId, Fact, MissionState } from '../../harness/director/types'
import { verifyCitations, type CitationReport } from '../../harness/director/verifyCitations'
import type { ArtifactProvenanceInfo, RoleId } from '../../harness/types'
import { useArtifactStore } from '../../stores/artifactStore'
import { useDirectorStore } from '../../stores/directorStore'
import { studioBus } from '../../studio/bus'
import type { ArtifactProvenance, Citation, VerifySummary } from '../../studio/contracts'
import { toArtifactKind } from '../../studio/mapping'

export interface MissionDeliverablesBridgeOptions {
  /** 注入用（测试）：缺省读取真实 directorStore 与 artifactStore */
  now?: () => number
  /**
   * v1.2 M3：false = 只安装桥、不发布模板交付物（真执行由 runner 产物经
   * `publishRuntimeArtifacts` 发布，执行控制器会传 false）；缺省 true = M2 行为。
   */
  includeTemplates?: boolean
}

/**
 * mission 交付物在 artifactStore 里的稳定 docId：
 * `doc-<missionId>-<tileId>`（同一 mission + 同一交付物只对应一份文档，重放/reload 幂等）。
 */
export function missionDeliverableDocId(missionId: string, tileId: string): string {
  return `doc-${missionId}-${tileId}`
}

/** `{{值~来源}}` 溯源标记（与旧渲染器同一口径） */
const CITATION_PATTERN = /\{\{([^{}~]+)~([^{}]+)\}\}/g

/**
 * 从 Markdown 提取 citations：值 / 来源去空白、按出现顺序去重。
 * 交付物正文里的统计型数字必须可回溯（roadmap §4.5 / §8.1 第 5 条）。
 */
export function extractMissionCitations(markdown: string): Citation[] {
  const seen = new Set<string>()
  const citations: Citation[] = []
  for (const match of markdown.matchAll(CITATION_PATTERN)) {
    const value = match[1].trim()
    const source = match[2].trim()
    if (!value || !source) continue
    const key = `${value}\u0000${source}`
    if (seen.has(key)) continue
    seen.add(key)
    citations.push({ value, source })
  }
  return citations
}

/**
 * 安装交付物发布桥（幂等；返回卸载函数）。
 *
 * 订阅 `useDirectorStore`：mission 变 done → 把 `MISSION_TEMPLATES[mission.kind].artifacts`
 * 逐件 `artifactStore.publishDeliverable`（不抢焦点），每件发一条 `artifact.published`。
 * 幂等判定：目标 docId 已存在（本会话重复事件 / 重复安装 / reload 后从持久化恢复的文档）
 * 即跳过——不覆盖用户编辑过的正文，也不重复发事件。
 */
export function installMissionDeliverablesBridge(options: MissionDeliverablesBridgeOptions = {}): () => void {
  const now = options.now ?? (() => Date.now())
  const includeTemplates = options.includeTemplates !== false

  /** 发布 mission 当前交付物；非 done 状态 / 已发布过的交付物直接跳过 */
  const publishMission = (mission: MissionState): void => {
    /* M3 真执行：模板件由 runner 产物替代，不重复发（执行控制器传 includeTemplates=false） */
    if (!includeTemplates) return
    if (mission.status !== 'done') return
    /* missionId 口径（roadmap §3.7）：done 时用 startedAt 标识本次 mission；缺省为 m-0 */
    const missionId = `m-${mission.startedAt ?? 0}`
    const template = missionTemplate(mission.kind)
    for (const tile of template.artifacts) {
      const docId = missionDeliverableDocId(missionId, tile.id)
      const alreadyPublished = useArtifactStore.getState().docs.some((doc) => doc.id === docId)
      if (alreadyPublished) continue

      const citations = extractMissionCitations(tile.markdown)
      /* core 同时满足旧 store 的 ArtifactProvenanceInfo 与 StudioBus 的 ArtifactProvenance */
      const core = {
        missionId,
        agentId: tile.owner,
        citations,
        createdAt: now(),
      }
      useArtifactStore.getState().publishDeliverable({
        id: docId,
        title: tile.title,
        kind: toArtifactKind(tile.kind),
        role: 'teacher',
        markdown: tile.markdown,
        provenance: { ...core },
        docKindCn: tile.kind,
        source: 'mission',
      })
      const provenance: ArtifactProvenance = { ...core }
      studioBus.emit({ type: 'artifact.published', docId, title: tile.title, provenance })
    }
  }

  const safePublish = (mission: MissionState): void => {
    try {
      publishMission(mission)
    } catch (error) {
      /* 订阅回调里抛错会打断 directorStore.setState 的其余订阅者：隔离并记录 */
      console.error('[deliverables] mission 交付物发布失败:', error)
    }
  }

  /* 挂载即补发：reload 后 directorStore 已恢复 done 的场景；已存在的文档由幂等判定跳过 */
  safePublish(useDirectorStore.getState().mission)
  const unsubscribe = useDirectorStore.subscribe((state) => safePublish(state.mission))
  return () => unsubscribe()
}

/* ------------------------------------------------------------------ */
/* v1.2 M3 · 真执行产物发布（发布前证据链校验，roadmap §4.5 / §4.6）      */
/* ------------------------------------------------------------------ */

/** runner 单任务产出（Markdown + 中文类型；与 harness/team/types 的 RunnerArtifact 同形） */
export interface RuntimeArtifactDraft {
  taskId: string
  agentId: DirectorAgentId
  title: string
  /** 支持 `{{值~来源}}` 溯源标记（复用旧渲染器） */
  markdown: string
  kindCn?: ArtifactKindCn
}

export interface PublishRuntimeArtifactsInput {
  missionId: string
  role: RoleId
  /** 本次 mission 冻结的事实快照（verifyCitations 的唯一数字来源） */
  facts: Fact[]
  artifacts: RuntimeArtifactDraft[]
}

export interface PublishRuntimeArtifactsResult {
  docIds: string[]
  /** 通过证据链校验的交付物件数 */
  verified: number
  /** 被标「待核」的交付物件数（未核 / 冲突 > 0） */
  pendingReview: number
}

/** 待核标题前缀 / 正文待核段：可见标注，**不静默改写数字** */
export const RUNTIME_PENDING_TITLE_PREFIX = '待核 · '
export const RUNTIME_PENDING_SECTION = '【待核】引用未经证据链校验'

/** 真执行交付物稳定 docId：同一 mission + task 重放幂等 */
export function runtimeArtifactDocId(missionId: string, taskId: string): string {
  return `doc-rt-${missionId}-${taskId}`
}

/** CitationReport → Studio 契约 VerifySummary（口径对齐：conflicts → conflict） */
export function toVerifySummary(report: CitationReport): VerifySummary {
  return {
    total: report.total,
    verified: report.verified,
    derived: report.derived,
    conflict: report.conflicts,
    unverified: report.unverified,
    structural: report.structural,
  }
}

/** 未核 / 冲突时追加的可见待核段（原文数字保持不动） */
function pendingReviewSection(report: CitationReport): string {
  return `\n\n---\n\n> ${RUNTIME_PENDING_SECTION}：未溯源 ${report.unverified} 处、冲突 ${report.conflicts} 处。数字保持原文未改动，请复核后再使用。`
}

/**
 * 发布真执行产物（roadmap §4.5 发布链路）：逐件 `verifyCitations` →
 * - 通过：发布原文 + provenance（citations / verification）；
 * - 未核或冲突：标题加「待核 · 」并在正文末尾追加待核段（**不静默改数字**）；
 *
 * docId 稳定 `doc-rt-<missionId>-<taskId>`；同内容重放不覆盖版本、不重复发事件。
 */
export function publishRuntimeArtifacts(input: PublishRuntimeArtifactsInput): PublishRuntimeArtifactsResult {
  const docIds: string[] = []
  let verified = 0
  let pendingReview = 0
  const createdAt = Date.now()

  for (const artifact of input.artifacts) {
    const report = verifyCitations(artifact.markdown, input.facts)
    const pending = report.conflicts > 0 || report.unverified > 0
    const title = pending ? `${RUNTIME_PENDING_TITLE_PREFIX}${artifact.title}` : artifact.title
    const content = pending ? `${artifact.markdown}${pendingReviewSection(report)}` : artifact.markdown
    const docId = runtimeArtifactDocId(input.missionId, artifact.taskId)
    const citations = extractMissionCitations(artifact.markdown)
    const verification = toVerifySummary(report)

    const provenance: ArtifactProvenanceInfo = {
      missionId: input.missionId,
      taskId: artifact.taskId,
      agentId: artifact.agentId,
      citations,
      verification,
      createdAt,
    }

    /* 幂等：同 id 且标题/正文都一致 = 已发布过（reload / 重放），不再写版本、不重复发事件 */
    const prev = useArtifactStore.getState().docs.find((doc) => doc.id === docId)
    const unchanged = !!prev && prev.title === title && prev.content === content
    if (!unchanged) {
      useArtifactStore.getState().publishDeliverable({
        id: docId,
        title,
        kind: artifact.kindCn ? toArtifactKind(artifact.kindCn) : 'generic',
        role: input.role,
        markdown: content,
        provenance,
        docKindCn: artifact.kindCn,
        source: 'mission',
      })
      const busProvenance: ArtifactProvenance = {
        missionId: input.missionId,
        taskId: artifact.taskId,
        agentId: artifact.agentId,
        citations,
        createdAt,
      }
      studioBus.emit({ type: 'artifact.published', docId, title, provenance: busProvenance })
    }

    docIds.push(docId)
    if (pending) pendingReview += 1
    else verified += 1
  }

  return { docIds, verified, pendingReview }
}
