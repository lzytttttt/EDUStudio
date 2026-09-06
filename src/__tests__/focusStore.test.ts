import { beforeEach, describe, expect, it } from 'vitest'
import { useFocusStore } from '../stores/focusStore'
import { useAuthStore } from '../stores/authStore'
import { useChatStore, type ChatSession, type SendMessageOptions } from '../stores/chatStore'
import type { BriefingCard } from '../harness/types'

/* focusStore v0.7：后台任务入队、泵顺序执行、done/failed 判定、单飞占用回队
 * 追加：一卡一任务（采纳即建/复用本卡专属任务会话） */

const card: BriefingCard = {
  id: 't1', role: 'teacher', type: 'creation', tag: '创作', title: '生成讲稿',
  body: '', confidence: 2, source: '', action: { kind: 'openTask', goal: '生成家长会讲稿' },
}

const session = (entries: ChatSession['entries']): ChatSession => ({
  id: 's1', title: '会话', role: 'teacher', entries, createdAt: 0, updatedAt: 0,
})

const resetChat = (sessions: ChatSession[] = []) => {
  useChatStore.setState({ sessions, activeId: sessions[0]?.id ?? null, streaming: false })
}

beforeEach(() => {
  resetChat()
  useFocusStore.setState({ tasks: [] })
})

const waitUntil = async (pred: () => boolean, timeout = 2000): Promise<void> => {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeout) throw new Error('waitUntil timeout')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('focusStore 后台任务泵', () => {
  it('acceptTask 入队并顺序执行，成功判定为 done', async () => {
    const sent: string[] = []
    useChatStore.setState({
      sendMessage: async (goal: string) => {
        sent.push(goal)
        return 'entry-1'
      },
    })
    resetChat([session([{ id: 'entry-1', role: 'assistant', content: 'ok', trace: [] }])])

    useFocusStore.getState().acceptTask(card, '目标A')
    useFocusStore.getState().acceptTask({ ...card, id: 't2', title: '第二张' }, '目标B')

    await waitUntil(() => useFocusStore.getState().tasks.every((t) => t.status === 'done'))
    expect(sent).toEqual(['目标A', '目标B']) // 顺序执行
    expect(useFocusStore.getState().tasks.map((t) => t.entryId)).toEqual(['entry-1', 'entry-1'])
  })

  it('条目带 error → 判定为 failed', async () => {
    useChatStore.setState({ sendMessage: async () => 'entry-err' })
    resetChat([session([{ id: 'entry-err', role: 'assistant', content: '', trace: [], error: '模型超时' }])])

    useFocusStore.getState().acceptTask(card, '目标')
    await waitUntil(() => useFocusStore.getState().tasks[0]?.status === 'failed')
    expect(useFocusStore.getState().tasks[0].status).toBe('failed')
  })

  it('单飞被占用（sendMessage 返回 null）→ 任务回队等待，泵退出不忙等', async () => {
    useChatStore.setState({ sendMessage: async () => null })
    useFocusStore.getState().acceptTask(card, '目标')
    await new Promise((r) => setTimeout(r, 50))
    const task = useFocusStore.getState().tasks[0]
    expect(task.status).toBe('queued')
  })

  it('clearTasks 清空队列', () => {
    useFocusStore.getState().acceptTask(card, '目标')
    expect(useFocusStore.getState().tasks.length).toBe(1)
    useFocusStore.getState().clearTasks()
    expect(useFocusStore.getState().tasks.length).toBe(0)
  })
})

describe('focusStore 一卡一任务', () => {
  beforeEach(() => {
    useAuthStore.setState({ role: 'teacher' })
  })

  it('采纳不同卡片 → 各建独立任务会话，标题取卡片标题', () => {
    useFocusStore.getState().acceptTask(card, '目标A')
    useFocusStore.getState().acceptTask({ ...card, id: 't2', title: '第二张' }, '目标B')

    const sessions = useChatStore.getState().sessions
    expect(sessions.length).toBe(2)
    expect(sessions.map((s) => s.cardId).sort()).toEqual(['t1', 't2'])
    expect(sessions.find((s) => s.cardId === 't1')?.title).toBe('生成讲稿')

    /* 每条后台任务绑定各自会话 */
    const tasks = useFocusStore.getState().tasks
    expect(new Set(tasks.map((t) => t.sessionId)).size).toBe(2)
    expect(tasks.map((t) => t.sessionId).sort()).toEqual(sessions.map((s) => s.id).sort())
  })

  it('后台建会话不抢当前焦点', () => {
    const manual = useChatStore.getState().newSession('teacher', '手动任务')
    useFocusStore.getState().acceptTask(card, '目标A')
    expect(useChatStore.getState().activeId).toBe(manual)
  })

  it('同一张卡重复采纳 → 复用同一会话', () => {
    useFocusStore.getState().acceptTask(card, '目标A')
    const first = useChatStore.getState().sessions[0].id
    useFocusStore.getState().acceptTask(card, '目标A')
    expect(useChatStore.getState().sessions.length).toBe(1)
    expect(useFocusStore.getState().tasks[1].sessionId).toBe(first)
  })

  it('泵执行时按任务自带会话落点，各任务互不串会话', async () => {
    const seen: Array<{ goal: string; sessionId?: string }> = []
    useChatStore.setState({
      sendMessage: async (goal: string, opts?: SendMessageOptions) => {
        seen.push({ goal, sessionId: opts?.sessionId })
        return 'entry-1'
      },
    })

    useFocusStore.getState().acceptTask(card, '目标A')
    useFocusStore.getState().acceptTask({ ...card, id: 't2', title: '第二张' }, '目标B')
    await waitUntil(() => useFocusStore.getState().tasks.every((t) => t.status === 'done'))

    expect(seen.map((s) => s.goal)).toEqual(['目标A', '目标B'])
    expect(seen[0].sessionId).toBeTruthy()
    expect(seen[0].sessionId).not.toBe(seen[1].sessionId)
  })
})
