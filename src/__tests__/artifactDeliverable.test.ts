import { beforeEach, describe, expect, it } from 'vitest'
import { useArtifactStore, type ArtifactRevision } from '../stores/artifactStore'
import { useUiStore } from '../stores/uiStore'
import type { ArtifactDoc, ArtifactProvenanceInfo } from '../harness/types'

/**
 * v1.2 M2 交付物融合（roadmap §2.3 F3/F8、§3.5 deliverables 端口、§4.5 发布链路）：
 * `publishDeliverable` 的语义单测 —— 幂等、不抢右栏焦点、provenance 持久化、版本、未读。
 * 旧的 createPlaceholder / finalize 路径由既有 artifactVisibility/artifactStreaming 覆盖，
 * 这里补一条回归护栏，确保新增方法没有改变旧行为。
 */

const artifact = () => useArtifactStore.getState()
const ui = () => useUiStore.getState()

function provenance(overrides: Partial<ArtifactProvenanceInfo> = {}): ArtifactProvenanceInfo {
  return {
    missionId: 'm-1000',
    agentId: 'analyst',
    citations: [
      { value: '82.4', source: '学情库 · 高一（3）班 · 单元考' },
      { value: '93%', source: '学情库 · 高一（3）班 · 作业记录' },
    ],
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

function deliverableInput(overrides: Record<string, unknown> = {}) {
  return {
    title: '学情简报',
    kind: 'analysis' as const,
    role: 'teacher' as const,
    markdown: '# 高一（3）班 · 学情简报\n\n物理 **{{82.4~学情库 · 高一（3）班 · 单元考}}**',
    provenance: provenance(),
    docKindCn: '简报',
    ...overrides,
  }
}

/** 读取同步落盘的 artifacts 载荷（发布必须立刻持久化，供 reload 幂等） */
function persistedArtifacts(): { docs: ArtifactDoc[]; revisions: Record<string, ArtifactRevision[]> } {
  const raw = localStorage.getItem('edustudio:artifacts')
  expect(raw, 'publishDeliverable 后应已同步落盘 edustudio:artifacts').toBeTruthy()
  return JSON.parse(raw as string) as { docs: ArtifactDoc[]; revisions: Record<string, ArtifactRevision[]> }
}

beforeEach(() => {
  localStorage.clear()
  useArtifactStore.setState({
    docs: [],
    revisions: {},
    shareRefs: {},
    activeId: null,
    lastTemplate: {},
    generatingIds: [],
    unreadDocIds: [],
  })
  useUiStore.setState({ rightTab: 'board', rightTabRole: 'teacher', docFocusRequest: 0, docNoticeDismissed: true })
})

describe('publishDeliverable：写入 / 溯源 / 未读', () => {
  it('返回 docId，写入交付物字段（source=mission、provenance、docKindCn）且不进入生成中', () => {
    const docId = artifact().publishDeliverable(deliverableInput())

    expect(docId).toBeTruthy()
    expect(artifact().docs).toHaveLength(1)
    const doc = artifact().docs[0]
    expect(doc.id).toBe(docId)
    expect(doc.title).toBe('学情简报')
    expect(doc.kind).toBe('analysis')
    expect(doc.role).toBe('teacher')
    expect(doc.source).toBe('mission')
    expect(doc.docKindCn).toBe('简报')
    expect(doc.content).toContain('{{82.4~学情库')
    expect(doc.provenance).toEqual(provenance())
    /* 交付物是一次性定稿：不进 generatingIds（区别于流式占位） */
    expect(artifact().generatingIds).toEqual([])
    expect(docId in artifact().revisions).toBe(true)
  })

  it('完成后置未读（去重）；markDocsRead 后清除', () => {
    const docId = artifact().publishDeliverable(deliverableInput())
    expect(artifact().unreadDocIds).toEqual([docId])

    artifact().markDocsRead()
    expect(artifact().unreadDocIds).toEqual([])

    /* 重复发布同一交付物：未读只保留一个 id，不重复堆积 */
    artifact().publishDeliverable(deliverableInput())
    expect(artifact().unreadDocIds).toEqual([docId])
  })

  it('写入「生成完成」revision（内容 = 定稿正文，时间 = provenance.createdAt）', () => {
    const docId = artifact().publishDeliverable(deliverableInput())
    const revisions = artifact().revisions[docId]
    expect(revisions).toHaveLength(1)
    expect(revisions[0].label).toBe('生成完成')
    expect(revisions[0].content).toBe(deliverableInput().markdown)
    expect(revisions[0].createdAt).toBe(1_700_000_000_000)
  })

  it('同步持久化：docs 带 provenance/docKindCn/source，revisions 带「生成完成」', () => {
    const docId = artifact().publishDeliverable(deliverableInput())
    const persisted = persistedArtifacts()
    expect(persisted.docs).toHaveLength(1)
    const doc = persisted.docs[0]
    expect(doc.id).toBe(docId)
    expect(doc.source).toBe('mission')
    expect(doc.docKindCn).toBe('简报')
    expect(doc.provenance?.missionId).toBe('m-1000')
    expect(doc.provenance?.agentId).toBe('analyst')
    expect(doc.provenance?.citations).toHaveLength(2)
    expect(doc.provenance?.createdAt).toBe(1_700_000_000_000)
    expect(persisted.revisions[docId]?.[0]?.label).toBe('生成完成')
  })

  it('不抢右栏焦点：requestDocFocus 不增、rightTab / 轻提示状态不变', () => {
    artifact().publishDeliverable(deliverableInput())
    expect(ui().docFocusRequest).toBe(0)
    expect(ui().rightTab).toBe('board')
    expect(ui().docNoticeDismissed).toBe(true)
  })

  it('已有选中文档时不顶掉 activeId；空工作区才落到首个交付物', () => {
    const manualId = artifact().createManual('teacher')
    artifact().publishDeliverable(deliverableInput())
    expect(artifact().activeId).toBe(manualId)
    expect(artifact().docs.some((d) => d.id === manualId)).toBe(true)

    /* 空工作区（无 active）→ 首个交付物成为可展示文档，但依旧不触发 tab 抢占 */
    useArtifactStore.setState({ docs: [], activeId: null })
    const docId = artifact().publishDeliverable(deliverableInput())
    expect(artifact().activeId).toBe(docId)
    expect(ui().docFocusRequest).toBe(0)
  })
})

describe('publishDeliverable：幂等', () => {
  it('同一 id 重复发布：不新增文档，返回同一 docId，标题 / 正文更新', () => {
    const firstId = artifact().publishDeliverable(deliverableInput())
    /* 调用方（bridge）持有稳定 docId：同 id 重放即使标题也改，仍更新原文档而非新增 */
    const secondId = artifact().publishDeliverable(
      deliverableInput({
        id: firstId,
        title: '学情简报（修订）',
        markdown: '# 修订版\n\n作业完成率 **{{93%~学情库 · 作业记录}}**',
      }),
    )

    expect(secondId).toBe(firstId)
    expect(artifact().docs).toHaveLength(1)
    const doc = artifact().docs[0]
    expect(doc.title).toBe('学情简报（修订）')
    expect(doc.content).toContain('# 修订版')
    /* 内容变化：旧正文自动快照 + 新「生成完成」版本 */
    expect(artifact().revisions[firstId].map((r) => r.label)).toEqual(['生成完成', '重新生成前自动保存', '生成完成'])
  })

  it('同一 id 同内容重复发布：不新增版本，文档数不变（重放安全）', () => {
    const docId = artifact().publishDeliverable(deliverableInput())
    artifact().publishDeliverable(deliverableInput())

    expect(artifact().docs).toHaveLength(1)
    expect(artifact().revisions[docId]).toHaveLength(1)
  })

  it('未传 id 时按 provenance.missionId + 标题派生稳定 docId（重放不新增文档）', () => {
    const firstId = artifact().publishDeliverable(deliverableInput())
    const secondId = artifact().publishDeliverable(deliverableInput({ id: undefined }))
    expect(secondId).toBe(firstId)
    expect(artifact().docs).toHaveLength(1)
  })

  it('持久化恢复（reload）后再次发布同 id 仍不新增文档', () => {
    const docId = artifact().publishDeliverable(deliverableInput())
    const persisted = persistedArtifacts()

    /* 模拟 reload：内存 store 清空后用持久化载荷恢复，再重放一次发布 */
    useArtifactStore.setState({ docs: persisted.docs, revisions: persisted.revisions, activeId: null })
    const replayId = artifact().publishDeliverable(deliverableInput())

    expect(replayId).toBe(docId)
    expect(artifact().docs).toHaveLength(1)
    expect(artifact().revisions[docId]).toHaveLength(1)
  })

  it('多篇不同交付物：最新在前，版本表彼此隔离', () => {
    const first = artifact().publishDeliverable(deliverableInput({ title: '学情简报' }))
    const second = artifact().publishDeliverable(
      deliverableInput({ title: '分层练习单', kind: 'generic', docKindCn: '练习单' }),
    )
    expect(artifact().docs.map((d) => d.id)).toEqual([second, first])
    expect(artifact().revisions[first]).toHaveLength(1)
    expect(artifact().revisions[second]).toHaveLength(1)
  })
})

describe('旧行为零回归 / 交付物可继续编辑', () => {
  it('旧 createPlaceholder / finalize 路径不变：仍进生成中并请求文档焦点', () => {
    artifact().createPlaceholder('a1', '教案', 'lessonPlan', 'teacher', 'agent')
    expect(artifact().generatingIds).toEqual(['a1'])
    expect(ui().docFocusRequest).toBe(1)
    expect(ui().rightTab).toBe('doc')

    artifact().appendChunk('a1', '# 教案')
    artifact().finalize('a1', '教案 · 函数单调性', 'lessonPlan')
    expect(artifact().generatingIds).toEqual([])
    expect(artifact().unreadDocIds).toEqual(['a1'])
  })

  it('发布的交付物可用旧 updateContent 编辑，且「生成完成」基线仍在', () => {
    const docId = artifact().publishDeliverable(deliverableInput())
    artifact().updateContent(docId, '# 教师修改版')
    const doc = artifact().docs.find((d) => d.id === docId)
    expect(doc?.content).toBe('# 教师修改版')
    expect(artifact().revisions[docId].some((r) => r.label === '生成完成')).toBe(true)
  })
})
