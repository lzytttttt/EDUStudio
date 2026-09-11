import { beforeEach, describe, expect, it } from 'vitest'
import { useAuthStore } from '../stores/authStore'
import { useChatStore } from '../stores/chatStore'
import { useFocusStore } from '../stores/focusStore'
import { cancelLoomPersist, useLoomStore } from '../stores/loomStore'
import type { BriefingCard } from '../harness/types'

/* v0.9.4 M4：简报任务空间化——采纳入口幂等、墓碑保护、画布按角色隔离 */

const card = (id: string, title: string): BriefingCard => ({
  id,
  role: 'teacher',
  type: 'creation',
  tag: '教学',
  title,
  body: '',
  confidence: 2,
  source: '',
  action: { kind: 'openTask', goal: `${title}目标` },
})

function resetAll(): void {
  cancelLoomPersist()
  useLoomStore.setState({ boards: [], activeBoardId: null })
  useChatStore.setState({ sessions: [], activeId: null, streaming: false })
  useFocusStore.setState({ tasks: [] })
  useAuthStore.setState({ role: 'teacher' })
}

beforeEach(resetAll)

const board = () => useLoomStore.getState().activeBoard()

describe('简报采纳 → 空间任务台', () => {
  it('采纳建任务节点并绑定会话（幂等：重复采纳不重复建）', () => {
    const role = 'teacher'
    const sessionId = useChatStore.getState().ensureCardSession(role, 'c1', '函数薄弱点分析', { focus: false })
    const first = useLoomStore.getState().ensureTaskNode({
      role, cardId: 'c1', title: '函数薄弱点分析', description: '来自今日简报', sessionId,
    })
    expect(first).toBeTruthy()
    expect(board()?.nodes).toHaveLength(1)
    expect(board()?.nodes[0].sessionId).toBe(sessionId)
    expect(board()?.nodes[0].type).toBe('task')

    const second = useLoomStore.getState().ensureTaskNode({
      role, cardId: 'c1', title: '函数薄弱点分析', sessionId,
    })
    expect(second).toBe(first)
    expect(board()?.nodes).toHaveLength(1)
  })

  it('专注模式后台采纳同样建节点（focusStore 接线）', () => {
    useFocusStore.getState().acceptTask(card('c2', '分层练习'), '为目标生成分层练习')
    const nodes = board()?.nodes ?? []
    expect(nodes).toHaveLength(1)
    expect(nodes[0].cardId).toBe('c2')
    expect(nodes[0].sessionId).toBe(useFocusStore.getState().tasks[0].sessionId)
  })

  it('同一张卡两次采纳（前台 + 后台）仍只有 1 个会话与 1 个节点', () => {
    useFocusStore.getState().acceptTask(card('c3', '家长会发言稿'), '写发言稿')
    const role = 'teacher'
    const sessionId = useChatStore.getState().ensureCardSession(role, 'c3', '家长会发言稿', { focus: false })
    useLoomStore.getState().ensureTaskNode({ role, cardId: 'c3', title: '家长会发言稿', sessionId })

    expect(useChatStore.getState().sessions.filter((s) => s.cardId === 'c3')).toHaveLength(1)
    expect(board()?.nodes.filter((n) => n.cardId === 'c3')).toHaveLength(1)
  })

  it('从画布移除后再次采纳不复活（墓碑）', () => {
    useFocusStore.getState().acceptTask(card('c4', '教学总结'), '整理总结')
    const node = board()?.nodes[0]
    useLoomStore.getState().removeNode(node?.id as string)
    expect(board()?.nodes).toHaveLength(0)

    useFocusStore.getState().acceptTask(card('c4', '教学总结'), '整理总结')
    expect(board()?.nodes).toHaveLength(0)
  })

  it('不同角色画布隔离：教师与区域任务不串台', () => {
    useAuthStore.setState({ role: 'teacher' })
    useFocusStore.getState().acceptTask(card('c5', '教师任务'), '目标')
    useAuthStore.setState({ role: 'bureau' })
    useChatStore.getState().ensureCardSession('bureau', 'c6', '区域任务', { focus: false })
    useLoomStore.getState().ensureTaskNode({ role: 'bureau', cardId: 'c6', title: '区域任务' })

    const boards = useLoomStore.getState().boards
    expect(boards.find((b) => b.role === 'teacher')?.nodes.map((n) => n.cardId)).toEqual(['c5'])
    expect(boards.find((b) => b.role === 'bureau')?.nodes.map((n) => n.cardId)).toEqual(['c6'])
  })
})
