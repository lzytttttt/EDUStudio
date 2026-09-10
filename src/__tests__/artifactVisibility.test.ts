import { beforeEach, describe, expect, it } from 'vitest'
import { useArtifactStore } from '../stores/artifactStore'
import { useUiStore } from '../stores/uiStore'
import { DEFAULT_RIGHT_TAB } from '../lib/rightPanel'

/**
 * v0.9.3 P0-A 文档流可见性：生成中/未读标识（artifactStore）与「占位即切文档」联动（uiStore）。
 * 单测固化 store 语义，组件级表现（自动可见、正文增长）由 e2e 覆盖。
 */

const artifact = () => useArtifactStore.getState()
const ui = () => useUiStore.getState()

beforeEach(() => {
  useArtifactStore.setState({ docs: [], revisions: {}, activeId: null, generatingIds: [], unreadDocIds: [] })
  useUiStore.setState({ rightTab: 'board', rightTabRole: 'teacher', docFocusRequest: 0, docNoticeDismissed: true })
})

describe('占位即切「文档」（P0-A①）', () => {
  it('agent 占位：进入生成中 + 请求切文档并复位回退提示', () => {
    artifact().createPlaceholder('a1', '教案 · 函数单调性', 'lessonPlan', 'teacher', 'agent')
    expect(artifact().generatingIds).toEqual(['a1'])
    expect(ui().rightTab).toBe('doc')
    expect(ui().docFocusRequest).toBe(1)
    expect(ui().docNoticeDismissed).toBe(false)
    ui().consumeDocFocus()
    expect(ui().docFocusRequest).toBe(0)
  })

  it('手动创建：不抢当前 tab，也不进入生成中', () => {
    artifact().createPlaceholder('m1', '试题组', 'analysis', 'teacher', 'manual')
    expect(artifact().generatingIds).toEqual([])
    expect(ui().rightTab).toBe('board')
    expect(ui().docFocusRequest).toBe(0)
  })

  it('仅新占位触发一次：流式期间手动切走后不再回退', () => {
    artifact().createPlaceholder('a1', '教案', 'lessonPlan', 'teacher', 'agent')
    ui().setRightTab('board')
    artifact().appendChunk('a1', '# 教案')
    expect(ui().rightTab).toBe('board')
  })

  it('角色口径：同角色不回退手动选择，换角色落到角色默认', () => {
    ui().syncRightTabRole('teacher')
    expect(ui().rightTab).toBe(DEFAULT_RIGHT_TAB.teacher)
    ui().setRightTab('doc')
    ui().syncRightTabRole('teacher')
    expect(ui().rightTab).toBe('doc')
    ui().syncRightTabRole('bureau')
    expect(ui().rightTab).toBe(DEFAULT_RIGHT_TAB.bureau)
  })
})

describe('生成中 / 未读标识（P0-A②）', () => {
  it('流式收敛：清生成中并留未读点，进入文档 tab 后清除', () => {
    artifact().createPlaceholder('a1', '教案', 'lessonPlan', 'teacher', 'agent')
    artifact().appendChunk('a1', '# 教案')
    artifact().finalize('a1', '教案 · 函数单调性', 'lessonPlan')
    expect(artifact().generatingIds).toEqual([])
    expect(artifact().unreadDocIds).toEqual(['a1'])
    artifact().markDocsRead()
    expect(artifact().unreadDocIds).toEqual([])
  })

  it('手动路径 finalize（出题工作台插入到文档）不产生未读点', () => {
    artifact().createPlaceholder('m1', '试题组', 'analysis', 'teacher', 'manual')
    artifact().appendChunk('m1', '# 试题组')
    artifact().finalize('m1', '试题组', 'analysis')
    expect(artifact().unreadDocIds).toEqual([])
  })

  it('非流式整体写入（文档合并工具）立即脱离生成中且不留未读点', () => {
    artifact().createPlaceholder('k1', '合并文档', 'report', 'schoolAdmin', 'agent')
    artifact().updateContent('k1', '# 合并文档')
    expect(artifact().generatingIds).toEqual([])
    artifact().finalize('k1', '合并文档', 'report')
    expect(artifact().unreadDocIds).toEqual([])
  })

  it('空产出的生成不指向空文档：无内容 finalize 不留未读点', () => {
    artifact().createPlaceholder('a2', '教案', 'lessonPlan', 'teacher', 'agent')
    artifact().finalize('a2', '教案', 'lessonPlan')
    expect(artifact().generatingIds).toEqual([])
    expect(artifact().unreadDocIds).toEqual([])
  })

  it('删除文档：生成中与未读清单同步清理', () => {
    artifact().createPlaceholder('a1', '教案', 'lessonPlan', 'teacher', 'agent')
    artifact().appendChunk('a1', '# 教案')
    artifact().finalize('a1', '教案', 'lessonPlan')
    expect(artifact().unreadDocIds).toEqual(['a1'])
    artifact().remove('a1')
    expect(artifact().generatingIds).toEqual([])
    expect(artifact().unreadDocIds).toEqual([])
  })
})
