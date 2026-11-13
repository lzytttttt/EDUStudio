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
import type { MissionState } from '../../harness/director/types'
import { useArtifactStore } from '../../stores/artifactStore'
import { useDirectorStore } from '../../stores/directorStore'
import { studioBus } from '../../studio/bus'
import type { ArtifactProvenance, Citation } from '../../studio/contracts'
import { toArtifactKind } from '../../studio/mapping'

export interface MissionDeliverablesBridgeOptions {
  /** 注入用（测试）：缺省读取真实 directorStore 与 artifactStore */
  now?: () => number
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

  /** 发布 mission 当前交付物；非 done 状态 / 已发布过的交付物直接跳过 */
  const publishMission = (mission: MissionState): void => {
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
