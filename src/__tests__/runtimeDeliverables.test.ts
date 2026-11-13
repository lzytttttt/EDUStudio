import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  installMissionDeliverablesBridge,
  publishRuntimeArtifacts,
  RUNTIME_PENDING_SECTION,
  RUNTIME_PENDING_TITLE_PREFIX,
  runtimeArtifactDocId,
  toVerifySummary,
  type RuntimeArtifactDraft,
} from '../integrations/director/deliverables'
import { freezeFacts } from '../harness/director/facts'
import { MISSION_TEMPLATES } from '../harness/director/data'
import type { Fact, MissionState, MissionStatus } from '../harness/director/types'
import { useArtifactStore } from '../stores/artifactStore'
import { useDirectorStore } from '../stores/directorStore'
import { useUiStore } from '../stores/uiStore'
import { studioBus } from '../studio/bus'
import type { StudioEvent } from '../studio/contracts'
import { verifyCitations } from '../harness/director/verifyCitations'
import type { ArtifactProvenanceInfo, RoleId } from '../harness/types'

/**
 * v1.2 M3b · 真执行交付物发布前的证据链校验（roadmap §4.5 / §4.6）：
 * - verifyCitations 通过 → 原文发布 + provenance（citations / verification）；
 * - unverified / conflict > 0 → 标题「待核 · 」+ 正文【待核】段，数字不静默改写；
 * - docId 稳定 `doc-rt-<missionId>-<taskId>`，重放幂等（不新增版本 / 不重复发事件）；
 * - includeTemplates=false 时模板交付物不发布（M3 真执行由 runner 产物替代）。
 */

type PublishedEvent = Extract<StudioEvent, { type: 'artifact.published' }>

const facts = freezeFacts()

let events: PublishedEvent[] = []
let offBus: (() => void) | null = null
let cleanups: (() => void)[] = []

function installBridge(options: Parameters<typeof installMissionDeliverablesBridge>[0] = {}): () => void {
  const cleanup = installMissionDeliverablesBridge(options)
  cleanups.push(cleanup)
  return cleanup
}

function artifact(overrides: Partial<RuntimeArtifactDraft> = {}): RuntimeArtifactDraft {
  return {
    taskId: 't1',
    agentId: 'analyst',
    title: '学情简报',
    markdown: '# 学情简报\n\n物理均分 **{{82.4~学情库 · 单元考}}**',
    kindCn: '简报',
    ...overrides,
  }
}

function input(overrides: Partial<Parameters<typeof publishRuntimeArtifacts>[0]> = {}) {
  return {
    missionId: 'm-3000',
    role: 'teacher' as RoleId,
    facts,
    artifacts: [artifact()],
    ...overrides,
  }
}

function docOf(id: string) {
  return useArtifactStore.getState().docs.find((doc) => doc.id === id)
}

function provenanceOf(id: string): ArtifactProvenanceInfo | undefined {
  return docOf(id)?.provenance
}

function missionState(kind: 'parent_meeting' | 'exam_loop' = 'exam_loop', status: MissionStatus = 'done'): MissionState {
  const template = MISSION_TEMPLATES[kind]
  return {
    status,
    kind,
    title: template.title,
    progress: status === 'done' ? 100 : 0,
    feed: [],
    plan: template.plan.map((task) => ({ ...task })),
    doneTasks: [],
    gate: null,
    planSource: 'template',
    startedAt: 4000,
  }
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
  useDirectorStore.setState({ mission: { ...missionState('exam_loop', 'planning'), startedAt: undefined } })
  events = []
  offBus = studioBus.onAny((event) => {
    if (event.type === 'artifact.published') events.push(event)
  })
  cleanups = []
})

afterEach(() => {
  offBus?.()
  offBus = null
  cleanups.forEach((fn) => fn())
  cleanups = []
})

describe('publishRuntimeArtifacts：验证通过', () => {
  it('原文发布 + provenance（citations / verification）+ 稳定 docId', () => {
    const result = publishRuntimeArtifacts(input())

    expect(result).toEqual({ docIds: ['doc-rt-m-3000-t1'], verified: 1, pendingReview: 0 })
    const docId = runtimeArtifactDocId('m-3000', 't1')
    expect(runtimeArtifactDocId('m-3000', 't1')).toBe('doc-rt-m-3000-t1')

    const doc = docOf(docId)
    expect(doc).toBeTruthy()
    expect(doc?.title).toBe('学情简报')
    expect(doc?.content).toBe(artifact().markdown)
    expect(doc?.kind).toBe('analysis') // 简报 → analysis（toArtifactKind 全表）
    expect(doc?.docKindCn).toBe('简报')
    expect(doc?.role).toBe('teacher')
    expect(doc?.source).toBe('mission')

    const provenance = provenanceOf(docId)
    expect(provenance).toMatchObject({
      missionId: 'm-3000',
      taskId: 't1',
      agentId: 'analyst',
      citations: [{ value: '82.4', source: '学情库 · 单元考' }],
    })
    expect(provenance?.verification).toEqual({
      total: 1,
      verified: 1,
      derived: 0,
      conflict: 0,
      unverified: 0,
      structural: 0,
    })
    expect(useArtifactStore.getState().revisions[docId]?.[0]?.label).toBe('生成完成')
    expect(useArtifactStore.getState().unreadDocIds).toContain(docId)
  })

  it('每条发布 emit artifact.published（docId / title / provenance）', () => {
    publishRuntimeArtifacts(input())
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'artifact.published',
      docId: 'doc-rt-m-3000-t1',
      title: '学情简报',
    })
    expect(events[0].provenance?.missionId).toBe('m-3000')
    expect(events[0].provenance?.taskId).toBe('t1')
  })

  it('结构性数字（题 / 分钟）不参与溯源，仍算通过', () => {
    const result = publishRuntimeArtifacts(
      input({ artifacts: [artifact({ taskId: 't-struct', title: '练习说明', markdown: '共 12 题，约 25 分钟。' })] }),
    )
    expect(result.pendingReview).toBe(0)
    const doc = docOf(runtimeArtifactDocId('m-3000', 't-struct'))
    expect(doc?.title).toBe('练习说明')
    expect(doc?.content).toBe('共 12 题，约 25 分钟。')
    expect(doc?.provenance?.verification?.structural).toBeGreaterThanOrEqual(2)
  })

  it('无 kindCn 时回落到 generic；verification 映射口径与 verifyCitations 一致', () => {
    const markdown = '物理均分 **{{82.4~学情库}}**，作业完成率 **{{93%~学情库}}**'
    publishRuntimeArtifacts(input({ artifacts: [artifact({ taskId: 't-kinds', markdown, kindCn: undefined })] }))
    const docId = runtimeArtifactDocId('m-3000', 't-kinds')
    const doc = docOf(docId)
    expect(doc?.kind).toBe('generic')
    expect(doc?.docKindCn).toBeUndefined()
    expect(doc?.provenance?.citations).toHaveLength(2)
    expect(doc?.provenance?.verification).toEqual(toVerifySummary(verifyCitations(markdown, facts)))
  })
})

describe('publishRuntimeArtifacts：待核分流（不静默改数字）', () => {
  it('unverified > 0 → 标题「待核 · 」+ 正文末尾【待核】段，原数字保留', () => {
    const markdown = '# 学情简报\n\n本次均分 84 分。'
    const result = publishRuntimeArtifacts(input({ artifacts: [artifact({ taskId: 't-unverified', markdown })] }))

    expect(result).toEqual({ docIds: ['doc-rt-m-3000-t-unverified'], verified: 0, pendingReview: 1 })
    const doc = docOf('doc-rt-m-3000-t-unverified')
    expect(doc?.title).toBe(`${RUNTIME_PENDING_TITLE_PREFIX}学情简报`)
    expect(doc?.title.startsWith('待核 · ')).toBe(true)
    /* 原文数字保持不动（只加标注） */
    expect(doc?.content).toContain('84 分')
    expect(doc?.content.startsWith(markdown)).toBe(true)
    expect(doc?.content).toContain(RUNTIME_PENDING_SECTION)
    expect(doc?.provenance?.verification?.unverified).toBeGreaterThan(0)
    expect(events[0]?.title.startsWith('待核 · ')).toBe(true)
  })

  it('conflict > 0 → 待核分支，verification.conflict 计数可见', () => {
    const markdown = '# 学情简报\n\n数学均分 82.4 分。'
    const result = publishRuntimeArtifacts(input({ artifacts: [artifact({ taskId: 't-conflict', markdown })] }))

    expect(result.pendingReview).toBe(1)
    const doc = docOf('doc-rt-m-3000-t-conflict')
    expect(doc?.title).toContain('待核 · ')
    expect(doc?.content).toContain(RUNTIME_PENDING_SECTION)
    expect(doc?.provenance?.verification?.conflict).toBeGreaterThan(0)
    /* 正文数字不改写：仍是作者写的 82.4 */
    expect(doc?.content).toContain('82.4')
  })

  it('混合批次：通过 / 待核分别计数，docIds 与 artifacts 一一对应', () => {
    const result = publishRuntimeArtifacts(
      input({
        artifacts: [
          artifact({ taskId: 't-ok' }),
          artifact({ taskId: 't-pending', title: '错题分析', markdown: '平均分 84 分。' }),
        ],
      }),
    )
    expect(result.verified).toBe(1)
    expect(result.pendingReview).toBe(1)
    expect(result.docIds).toEqual(['doc-rt-m-3000-t-ok', 'doc-rt-m-3000-t-pending'])
    expect(useArtifactStore.getState().docs).toHaveLength(2)
    expect(docOf('doc-rt-m-3000-t-ok')?.title).toBe('学情简报')
    expect(docOf('doc-rt-m-3000-t-pending')?.title).toBe('待核 · 错题分析')
  })
})

describe('publishRuntimeArtifacts：幂等 / 事件 / 焦点', () => {
  it('同内容重放：docId 不变、不新增文档/版本、不重复发事件', () => {
    const payload = input({
      artifacts: [artifact(), artifact({ taskId: 't2', title: '练习单', markdown: '函数单调性掌握率 61%。' })],
    })
    const first = publishRuntimeArtifacts(payload)
    expect(events).toHaveLength(2)
    expect(useArtifactStore.getState().docs).toHaveLength(2)

    const second = publishRuntimeArtifacts(payload)
    expect(second.docIds).toEqual(first.docIds)
    expect(useArtifactStore.getState().docs).toHaveLength(2)
    expect(events).toHaveLength(2)
    for (const docId of first.docIds) {
      expect(useArtifactStore.getState().revisions[docId]).toHaveLength(1)
    }
  })

  it('内容变化时原位更新（同一 docId），不复制第二份文档', () => {
    publishRuntimeArtifacts(input())
    publishRuntimeArtifacts(input({ artifacts: [artifact({ title: '学情简报（修订）', markdown: '作业完成率 **{{93%~学情库}}**' })] }))

    expect(useArtifactStore.getState().docs).toHaveLength(1)
    const doc = docOf('doc-rt-m-3000-t1')
    expect(doc?.title).toBe('学情简报（修订）')
    expect(doc?.content).toContain('93%')
    expect(events).toHaveLength(2)
  })

  it('空批次：无文档 / 无事件，返回零计数', () => {
    expect(publishRuntimeArtifacts(input({ artifacts: [] }))).toEqual({ docIds: [], verified: 0, pendingReview: 0 })
    expect(useArtifactStore.getState().docs).toHaveLength(0)
    expect(events).toHaveLength(0)
  })

  it('发布不抢右栏焦点、不进 generatingIds', () => {
    publishRuntimeArtifacts(input())
    expect(useUiStore.getState().docFocusRequest).toBe(0)
    expect(useUiStore.getState().rightTab).toBe('board')
    expect(useArtifactStore.getState().generatingIds).toEqual([])
  })

  it('不同 taskId → 各自独立稳定 docId', () => {
    const result = publishRuntimeArtifacts(
      input({
        artifacts: [
          artifact({ taskId: 't-a', title: 'A', markdown: '作业完成率 **{{93%~学情库}}**' }),
          artifact({ taskId: 't-b', title: 'B', markdown: '课堂专注度 **{{86~学情库}}**' }),
        ],
      }),
    )
    expect(new Set(result.docIds).size).toBe(2)
    expect(result.docIds).toEqual(['doc-rt-m-3000-t-a', 'doc-rt-m-3000-t-b'])
  })
})

describe('installMissionDeliverablesBridge：includeTemplates', () => {
  it('includeTemplates=false：mission done 不发布模板交付物、不发事件', () => {
    installBridge({ includeTemplates: false })
    useDirectorStore.setState({ mission: missionState('exam_loop', 'done') })

    expect(useArtifactStore.getState().docs).toHaveLength(0)
    expect(events).toHaveLength(0)
  })

  it('缺省 includeTemplates=true：保持 M2 行为（done 发布模板 4 件）', () => {
    installBridge()
    useDirectorStore.setState({ mission: missionState('exam_loop', 'done') })

    expect(useArtifactStore.getState().docs).toHaveLength(MISSION_TEMPLATES.exam_loop.artifacts.length)
    expect(events).toHaveLength(MISSION_TEMPLATES.exam_loop.artifacts.length)
  })

  it('includeTemplates=false 时真执行产物仍可独立发布（两条链路不互相复制）', () => {
    installBridge({ includeTemplates: false })
    useDirectorStore.setState({ mission: missionState('exam_loop', 'done') })
    publishRuntimeArtifacts(input())

    expect(useArtifactStore.getState().docs).toHaveLength(1)
    expect(docOf('doc-rt-m-3000-t1')?.source).toBe('mission')
    expect(events).toHaveLength(1)
  })
})

describe('导出常量 / 工具', () => {
  it('待核文案常量可直接被 UI 复用', () => {
    expect(RUNTIME_PENDING_TITLE_PREFIX).toBe('待核 · ')
    expect(RUNTIME_PENDING_SECTION).toBe('【待核】引用未经证据链校验')
  })

  it('toVerifySummary：CitationReport → VerifySummary（conflicts → conflict）', () => {
    const report = verifyCitations('物理均分 91.2 分，作业完成率 **{{93%~学情库}}**，共 3 封。', facts)
    const summary = toVerifySummary(report)
    expect(summary).toEqual({
      total: report.total,
      verified: report.verified,
      derived: report.derived,
      conflict: report.conflicts,
      unverified: report.unverified,
      structural: report.structural,
    })
  })

  it('facts 为空时：统计型数字全部待核（发布链不静默放行）', () => {
    const result = publishRuntimeArtifacts(
      input({ facts: [] as Fact[], artifacts: [artifact({ markdown: '物理均分 82.4 分。' })] }),
    )
    expect(result.pendingReview).toBe(1)
    expect(docOf('doc-rt-m-3000-t1')?.title.startsWith('待核 · ')).toBe(true)
  })
})
