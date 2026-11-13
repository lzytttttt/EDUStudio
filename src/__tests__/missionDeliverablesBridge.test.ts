import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  extractMissionCitations,
  installMissionDeliverablesBridge,
  missionDeliverableDocId,
} from '../integrations/director/deliverables'
import { MISSION_TEMPLATES } from '../harness/director/data'
import type { MissionKind, MissionState, MissionStatus } from '../harness/director/types'
import { useArtifactStore } from '../stores/artifactStore'
import { useDirectorStore } from '../stores/directorStore'
import { useUiStore } from '../stores/uiStore'
import { studioBus } from '../studio/bus'
import type { StudioEvent } from '../studio/contracts'
import { toArtifactKind } from '../studio/mapping'

/**
 * v1.2 M2 mission 交付物发布桥（roadmap §4.5）：mission done → artifactStore + artifact.published。
 *
 * 全部用例用 `useDirectorStore.setState` 直接构造 done 状态（不依赖 directorStore 的演示时间线），
 * 因此不需要 fake timers；幂等/重复安装/reload 恢复是重点。
 */

type PublishedEvent = Extract<StudioEvent, { type: 'artifact.published' }>

const NOW = 1_700_000_000_000

let events: PublishedEvent[] = []
let offBus: (() => void) | null = null
let uninstalls: (() => void)[] = []

function missionState(kind: MissionKind, status: MissionStatus = 'done', startedAt = 1000): MissionState {
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
    ...(startedAt === undefined ? {} : { startedAt }),
  }
}

function setMission(kind: MissionKind, status: MissionStatus = 'done', startedAt = 1000): void {
  useDirectorStore.setState({ mission: missionState(kind, status, startedAt) })
}

/** 安装桥并登记卸载（用例结束统一清理） */
function installBridge(options: { now?: () => number } = {}): () => void {
  const uninstall = installMissionDeliverablesBridge({ now: () => NOW, ...options })
  uninstalls.push(uninstall)
  return uninstall
}

function publishedDoc(id: string) {
  return useArtifactStore.getState().docs.find((doc) => doc.id === id)
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
  useDirectorStore.setState({ mission: missionState('parent_meeting', 'planning') })
  events = []
  offBus = studioBus.onAny((event) => {
    if (event.type === 'artifact.published') events.push(event)
  })
  uninstalls = []
})

afterEach(() => {
  offBus?.()
  offBus = null
  uninstalls.forEach((fn) => fn())
  uninstalls = []
})

describe('install 即补发（reload 后 mission 已 done）', () => {
  it('mission 已 done → 立即发布 exam_loop 的 4 件交付物（字段完整）', () => {
    setMission('exam_loop', 'done', 1000)
    installBridge()

    const template = MISSION_TEMPLATES.exam_loop
    expect(useArtifactStore.getState().docs).toHaveLength(template.artifacts.length)

    for (const tile of template.artifacts) {
      const docId = missionDeliverableDocId('m-1000', tile.id)
      const doc = publishedDoc(docId)
      expect(doc, `缺少交付物 ${tile.title}`).toBeTruthy()
      expect(doc?.title).toBe(tile.title)
      expect(doc?.kind).toBe(toArtifactKind(tile.kind))
      expect(doc?.role).toBe('teacher')
      expect(doc?.source).toBe('mission')
      expect(doc?.docKindCn).toBe(tile.kind)
      expect(doc?.content).toBe(tile.markdown)
      expect(doc?.provenance?.missionId).toBe('m-1000')
      expect(doc?.provenance?.agentId).toBe(tile.owner)
      expect(doc?.provenance?.createdAt).toBe(NOW)
      expect(doc?.provenance?.citations?.length).toBeGreaterThan(0)
      /* 每件交付物都写「生成完成」版本（导出/自评/版本历史的旧口径） */
      expect(useArtifactStore.getState().revisions[docId]?.[0]?.label).toBe('生成完成')
    }
  })

  it('citations 从 `{{值~来源}}` 提取：值 / 来源正确、重复标记去重', () => {
    setMission('exam_loop')
    installBridge()

    const brief = publishedDoc(missionDeliverableDocId('m-1000', 'a-brief'))
    expect(brief?.provenance?.citations).toHaveLength(11)
    expect(brief?.provenance?.citations?.[0]).toEqual({
      value: '82.4',
      source: '学情库 · 高一（3）班 · 单元考',
    })
    expect(brief?.provenance?.citations?.some((c) => c.value === '80.4' && c.source.includes('派生值'))).toBe(true)

    /* 单件交付物（只有 1 处引用）也正确 */
    const drill = publishedDoc(missionDeliverableDocId('m-1000', 'a-drill'))
    expect(drill?.provenance?.citations).toEqual([{ value: '61%', source: '学情库 · 近两周测验' }])
  })

  it('extractMissionCitations：去空白 / 去重 / 忽略非法片段', () => {
    const citations = extractMissionCitations(
      '{{82.4~学情库}} 与 {{ 82.4 ~ 学情库 }} 重复；{{~缺值}} {{x~}} 无标记的 {{非标记}} 内容',
    )
    expect(citations).toEqual([{ value: '82.4', source: '学情库' }])
    expect(extractMissionCitations('没有引用')).toEqual([])
  })

  it('每件交付物发一条 artifact.published（docId / title / provenance）', () => {
    setMission('exam_loop')
    installBridge()

    const template = MISSION_TEMPLATES.exam_loop
    expect(events).toHaveLength(template.artifacts.length)
    expect(new Set(events.map((e) => e.docId))).toEqual(
      new Set(template.artifacts.map((tile) => missionDeliverableDocId('m-1000', tile.id))),
    )
    for (const event of events) {
      const tile = template.artifacts.find((t) => t.title === event.title)
      expect(tile, `事件标题应来自模板：${event.title}`).toBeTruthy()
      expect(event.provenance?.missionId).toBe('m-1000')
      expect(event.provenance?.agentId).toBe(tile?.owner)
      expect(event.provenance?.citations?.length).toBeGreaterThan(0)
    }
  })

  it('startedAt 缺省（旧持久化数据）→ missionId 回落 m-0', () => {
    setMission('exam_loop', 'done', undefined as unknown as number)
    /* missionState 的 spread 会跳过 undefined，这里显式去掉 startedAt */
    const mission = { ...useDirectorStore.getState().mission }
    delete (mission as { startedAt?: number }).startedAt
    useDirectorStore.setState({ mission })
    installBridge()

    expect(useArtifactStore.getState().docs).toHaveLength(4)
    expect(useArtifactStore.getState().docs[0].provenance?.missionId).toBe('m-0')
    expect(events[0]?.provenance?.missionId).toBe('m-0')
  })
})

describe('状态订阅：只在 done 时发布', () => {
  it('非 done 状态（planning/running/waiting/paused）不发布；变 done 才发布', () => {
    installBridge()
    for (const status of ['planning', 'running', 'waiting', 'paused'] as MissionStatus[]) {
      setMission('exam_loop', status)
      expect(useArtifactStore.getState().docs).toHaveLength(0)
      expect(events).toHaveLength(0)
    }

    setMission('exam_loop', 'done')
    expect(useArtifactStore.getState().docs).toHaveLength(4)
    expect(events).toHaveLength(4)
  })

  it('done 后其它状态变化（toast / 授权等）不重复发布', () => {
    installBridge()
    setMission('exam_loop', 'done')
    expect(useArtifactStore.getState().docs).toHaveLength(4)

    useDirectorStore.setState({ toasts: [{ id: 't1', text: '已交付 · 可导出', tone: 'mint' }] })
    useDirectorStore.setState({ autonomy: { ...useDirectorStore.getState().autonomy, chief: 'L3' } })

    expect(useArtifactStore.getState().docs).toHaveLength(4)
    expect(events).toHaveLength(4)
  })

  it('发布过程不抢右栏焦点、不进生成中，并留未读 + 版本', () => {
    installBridge()
    setMission('exam_loop', 'done')

    expect(useUiStore.getState().docFocusRequest).toBe(0)
    expect(useUiStore.getState().rightTab).toBe('board')
    expect(useUiStore.getState().docNoticeDismissed).toBe(true)
    expect(useArtifactStore.getState().generatingIds).toEqual([])

    const docs = useArtifactStore.getState().docs
    expect(useArtifactStore.getState().unreadDocIds).toHaveLength(4)
    for (const doc of docs) {
      expect(useArtifactStore.getState().unreadDocIds).toContain(doc.id)
      expect(useArtifactStore.getState().revisions[doc.id]?.some((r) => r.label === '生成完成')).toBe(true)
    }
  })
})

describe('幂等 / 重复安装 / 卸载', () => {
  it('重复安装不重复发布（同一 missionId + 交付物一次）', () => {
    const uninstall = installBridge()
    setMission('exam_loop', 'done')
    expect(useArtifactStore.getState().docs).toHaveLength(4)
    expect(events).toHaveLength(4)

    uninstall()
    installBridge()
    /* 第二次安装：mission 仍 done，但文档已存在 → 一条都不重复发 */
    expect(useArtifactStore.getState().docs).toHaveLength(4)
    expect(events).toHaveLength(4)
    setMission('exam_loop', 'done')
    expect(useArtifactStore.getState().docs).toHaveLength(4)
    expect(events).toHaveLength(4)
  })

  it('reload 后从持久化恢复：安装不覆盖、不重复发事件', () => {
    installBridge()
    setMission('exam_loop', 'done')
    const persistedRaw = localStorage.getItem('edustudio:artifacts')
    expect(persistedRaw).toBeTruthy()
    const persisted = JSON.parse(persistedRaw as string) as {
      docs: ReturnType<typeof useArtifactStore.getState>['docs']
      revisions: ReturnType<typeof useArtifactStore.getState>['revisions']
    }

    /* 模拟 reload：内存清空 → 用持久化载荷恢复 → 重新安装（mission 仍 done） */
    uninstalls.forEach((fn) => fn())
    uninstalls = []
    useArtifactStore.setState({ docs: persisted.docs, revisions: persisted.revisions, activeId: null })
    events = []
    installBridge()

    expect(useArtifactStore.getState().docs).toHaveLength(4)
    expect(events).toHaveLength(0)
    /* 用户编辑过的正文不会被重放覆盖（这里用原值等价性表达：恢复内容 = 原交付物正文） */
    expect(useArtifactStore.getState().docs[0].content).toBe(persisted.docs[0].content)
  })

  it('卸载后 mission 变 done 不再发布', () => {
    const uninstall = installBridge()
    uninstall()
    setMission('exam_loop', 'done')

    expect(useArtifactStore.getState().docs).toHaveLength(0)
    expect(events).toHaveLength(0)
  })

  it('新的 mission（新 startedAt）会重新发布一整套交付物', () => {
    installBridge()
    setMission('exam_loop', 'done', 1000)
    expect(useArtifactStore.getState().docs).toHaveLength(4)

    /* 重新开战：先回 planning，再以新 startedAt 完成 */
    setMission('exam_loop', 'planning', 2000)
    setMission('exam_loop', 'done', 2000)

    expect(useArtifactStore.getState().docs).toHaveLength(8)
    expect(events).toHaveLength(8)
    const newIds = events.slice(4).map((e) => e.docId)
    expect(newIds).toContain(missionDeliverableDocId('m-2000', 'a-brief'))
  })
})

describe('两种剧本 kind', () => {
  it('parent_meeting：4 件，中文 kind 按映射表落英文枚举（简报/讲稿/大纲/信件）', () => {
    setMission('parent_meeting', 'done')
    installBridge()

    const template = MISSION_TEMPLATES.parent_meeting
    expect(useArtifactStore.getState().docs).toHaveLength(template.artifacts.length)
    const mapped = template.artifacts.map((tile) => {
      const doc = publishedDoc(missionDeliverableDocId('m-1000', tile.id))
      return { kindCn: tile.kind, kind: doc?.kind, docKindCn: doc?.docKindCn }
    })
    expect(mapped).toEqual([
      { kindCn: '简报', kind: 'analysis', docKindCn: '简报' },
      { kindCn: '讲稿', kind: 'notice', docKindCn: '讲稿' },
      { kindCn: '大纲', kind: 'generic', docKindCn: '大纲' },
      { kindCn: '信件', kind: 'notice', docKindCn: '信件' },
    ])
    /* 4 件全部可追溯：家长会讲稿的 5 处引用都进 provenance */
    const speech = publishedDoc(missionDeliverableDocId('m-1000', 'a-speech'))
    expect(speech?.provenance?.citations).toHaveLength(5)
    expect(speech?.provenance?.agentId).toBe('curriculum')
  })

  it('exam_loop：练习单 → generic、教案 → lessonPlan（教案走旧自评/导出口径）', () => {
    setMission('exam_loop', 'done')
    installBridge()

    const drill = publishedDoc(missionDeliverableDocId('m-1000', 'a-drill'))
    const lesson = publishedDoc(missionDeliverableDocId('m-1000', 'a-lesson'))
    expect(drill?.kind).toBe('generic')
    expect(drill?.docKindCn).toBe('练习单')
    expect(lesson?.kind).toBe('lessonPlan')
    expect(lesson?.docKindCn).toBe('教案')
    expect(lesson?.provenance?.agentId).toBe('curriculum')
  })
})
