import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  captureOutput,
  isLoomRunning,
  resumeCheckpoint,
  runLoom,
  stopLoom,
} from '../harness/loom/runner'
import { cancelLoomPersist, useLoomStore } from '../stores/loomStore'
import { useChatStore, type ChatEntry, type ChatSession, type SendMessageOptions } from '../stores/chatStore'
import { useAuthStore } from '../stores/authStore'
import { getProviders } from '../harness/providerRegistry'
import type { AgentTraceEvent, LoomUpstreamRef, RoleId } from '../harness/types'
import type { LoomBoard, LoomNode, LoomNodeType } from '../harness/loom/types'

/* v0.9.4 M5：LoomRunner（校验 / 串行拓扑 / 上游注入 / 单飞回队 / checkpoint / 停止 / 输出采集）
 * + chatStore context 透传（旧路径零破坏） */

const realSendMessage = useChatStore.getState().sendMessage

const asst = (id: string, patch: Partial<ChatEntry> = {}): ChatEntry => ({
  id,
  role: 'assistant',
  content: 'ok',
  trace: [],
  ...patch,
})

function seedSession(id: string, entries: ChatEntry[] = [], role: RoleId = 'teacher'): void {
  const session: ChatSession = { id, title: '会话', role, entries, createdAt: 0, updatedAt: 0 }
  useChatStore.setState({ sessions: [session], activeId: id, streaming: false })
}

function board(): LoomBoard {
  return useLoomStore.getState().activeBoard() as LoomBoard
}

function nodeOf(id: string): LoomNode | undefined {
  return board().nodes.find((n) => n.id === id)
}

/** 建节点并绑定任务会话（一节点一会话），便于 sendMessage 返回的条目可被采集 */
function addTask(title: string, type: LoomNodeType = 'task', extra: Partial<LoomNode> = {}): string {
  const id = useLoomStore.getState().addNode({ type, title, ...extra }) as string
  useLoomStore.getState().updateNode(id, { sessionId: 's1' })
  return id
}

/** 覆写 sendMessage：记录调用并返回指定条目 id（null = 单飞被占用） */
function mockSend(result: string | null | ((goal: string, opts?: SendMessageOptions) => string | null)) {
  const calls: { goal: string; opts?: SendMessageOptions }[] = []
  useChatStore.setState({
    sendMessage: async (goal: string, opts?: SendMessageOptions) => {
      calls.push({ goal, opts })
      return typeof result === 'function' ? result(goal, opts) : result
    },
  })
  return calls
}

beforeEach(() => {
  cancelLoomPersist()
  useLoomStore.setState({
    boards: [],
    activeBoardId: null,
    runProgress: { running: false, total: 0, done: 0, failed: 0 },
  })
  useChatStore.setState({ sessions: [], activeId: null, streaming: false, sendMessage: realSendMessage })
  useAuthStore.setState({ role: 'teacher' })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LoomRunner 校验与拓扑执行', () => {
  it('校验失败（空画布）不发任何请求', async () => {
    const calls = mockSend('e1')
    useLoomStore.getState().ensureBoard('teacher')
    await runLoom()
    expect(calls).toHaveLength(0)
  })

  it('校验失败（成环）不发任何请求', async () => {
    const calls = mockSend('e1')
    const b = useLoomStore.getState().ensureBoard('teacher')
    const mk = (id: string): LoomNode => ({
      id, type: 'task', title: id, position: { x: 0, y: 0 }, status: 'idle', createdAt: 0, updatedAt: 0,
    })
    useLoomStore.setState({
      boards: [
        {
          ...b,
          nodes: [mk('a'), mk('b')],
          edges: [
            { id: 'e1', from: 'a', to: 'b', type: 'dependency', createdAt: 0 },
            { id: 'e2', from: 'b', to: 'a', type: 'dependency', createdAt: 0 },
          ],
        },
      ],
    })
    await runLoom()
    expect(calls).toHaveLength(0)
  })

  it('拓扑顺序：A→B→C 串行执行，顺序正确且全部 done', async () => {
    const calls = mockSend('e1')
    seedSession('s1', [asst('e1')])
    useLoomStore.getState().ensureBoard('teacher')
    const a = addTask('A')
    const b = addTask('B')
    const c = addTask('C')
    expect(useLoomStore.getState().connect(a, b).ok).toBe(true)
    expect(useLoomStore.getState().connect(b, c).ok).toBe(true)

    await runLoom()

    expect(calls.map((x) => x.goal)).toEqual(['A', 'B', 'C'])
    expect([nodeOf(a)?.status, nodeOf(b)?.status, nodeOf(c)?.status]).toEqual(['done', 'done', 'done'])
  })

  it('上游输出注入到 context（B 收到 A 的 runOutput）', async () => {
    const calls = mockSend('e1')
    seedSession('s1', [asst('e1')])
    useLoomStore.getState().ensureBoard('teacher')
    const a = addTask('学情分析')
    const b = addTask('生成分层练习', 'agent', { instruction: '依据上游结果生成三档练习' })
    expect(useLoomStore.getState().connect(a, b).ok).toBe(true)
    /* A 已产出：模拟已完成节点 */
    useLoomStore.getState().setNodeRunOutput(a, '函数概念失分率 31%')
    useLoomStore.getState().setNodeStatus(a, 'done')

    await runLoom()

    expect(calls).toHaveLength(1)
    expect(calls[0].goal).toBe('依据上游结果生成三档练习')
    const upstream = calls[0].opts?.context?.upstream as LoomUpstreamRef[]
    expect(upstream).toHaveLength(1)
    expect(upstream[0]).toMatchObject({ nodeId: a, title: '学情分析', output: '函数概念失分率 31%' })
    expect(calls[0].opts?.context?.loomNodeId).toBe(b)
  })

  it('父未完成时子不执行（父失败 → 子保持 queued）', async () => {
    const calls = mockSend('eA')
    seedSession('s1', [asst('eA', { content: '', error: '模型超时' })])
    useLoomStore.getState().ensureBoard('teacher')
    const a = addTask('A')
    const b = addTask('B')
    useLoomStore.getState().connect(a, b)

    await runLoom()

    expect(calls).toHaveLength(1)
    expect(nodeOf(a)?.status).toBe('error')
    expect(nodeOf(b)?.status).toBe('queued')
  })
})

describe('LoomRunner 单飞与结果判定', () => {
  it('sendMessage 返回 null → 节点回 queued 且不递归忙等', async () => {
    const calls = mockSend(null)
    seedSession('s1', [asst('e1')])
    useLoomStore.getState().ensureBoard('teacher')
    const a = addTask('A')

    await runLoom()

    expect(calls).toHaveLength(1)
    expect(nodeOf(a)?.status).toBe('queued')
    expect(useLoomStore.getState().runProgress.running).toBe(false)
  })

  it('entry.error 非空 → 判定为 error 并计入 failed', async () => {
    mockSend('eErr')
    seedSession('s1', [asst('eErr', { content: '', error: '接口失败' })])
    useLoomStore.getState().ensureBoard('teacher')
    const a = addTask('A')

    await runLoom()

    expect(nodeOf(a)?.status).toBe('error')
    expect(useLoomStore.getState().runProgress.failed).toBe(1)
    expect(useLoomStore.getState().runProgress.done).toBe(0)
  })

  it('stopLoom 停止本轮：仅执行当前节点，后续不再执行', async () => {
    const calls = mockSend('e1')
    seedSession('s1', [asst('e1')])
    useLoomStore.getState().ensureBoard('teacher')
    addTask('A')
    addTask('B')

    const run = runLoom()
    stopLoom()
    await run

    expect(calls).toHaveLength(1)
    expect(isLoomRunning()).toBe(false)
  })
})

describe('LoomRunner checkpoint 人工确认', () => {
  function chainWithCheckpoint() {
    seedSession('s1', [asst('e1')])
    useLoomStore.getState().ensureBoard('teacher')
    const a = addTask('A')
    const cp = addTask('确认', 'checkpoint')
    const b = addTask('B', 'agent', { instruction: 'B 目标' })
    useLoomStore.getState().connect(a, cp)
    useLoomStore.getState().connect(cp, b)
    return { a, cp, b }
  }

  it('遇 checkpoint 置 waiting 并暂停本轮，下游不执行', async () => {
    const calls = mockSend('e1')
    const { a, cp, b } = chainWithCheckpoint()

    await runLoom()

    expect(calls.map((x) => x.goal)).toEqual(['A'])
    expect(nodeOf(a)?.status).toBe('done')
    expect(nodeOf(cp)?.status).toBe('waiting')
    expect(nodeOf(b)?.status).toBe('queued')
  })

  it('resumeCheckpoint(continue) → checkpoint done 且继续执行下游', async () => {
    const calls = mockSend('e1')
    const { cp, b } = chainWithCheckpoint()
    await runLoom()

    await resumeCheckpoint(cp, 'continue')

    expect(nodeOf(cp)?.status).toBe('done')
    expect(nodeOf(b)?.status).toBe('done')
    expect(calls.map((x) => x.goal)).toEqual(['A', 'B 目标'])
  })

  it('resumeCheckpoint(cancel) → checkpoint 回 idle 且不执行下游', async () => {
    const calls = mockSend('e1')
    const { cp, b } = chainWithCheckpoint()
    await runLoom()

    await resumeCheckpoint(cp, 'cancel')

    expect(nodeOf(cp)?.status).toBe('idle')
    expect(nodeOf(b)?.status).toBe('queued')
    expect(calls).toHaveLength(1)
  })
})

describe('LoomRunner 进度与输出采集', () => {
  it('runProgress 计数：total / done / running', async () => {
    mockSend('e1')
    seedSession('s1', [asst('e1')])
    useLoomStore.getState().ensureBoard('teacher')
    const a = addTask('A')
    const b = addTask('B')
    const c = addTask('C')
    useLoomStore.getState().connect(a, b)
    useLoomStore.getState().connect(b, c)

    await runLoom()

    expect(useLoomStore.getState().runProgress).toEqual({ running: false, total: 3, done: 3, failed: 0 })
  })

  it('runOutput 采集：正文截断 1200 字符且 tool_result 摘要最多 6 条', async () => {
    mockSend('eLong')
    const trace: AgentTraceEvent[] = Array.from({ length: 7 }, (_, i) => ({
      kind: 'tool_result' as const,
      id: `t${i}`,
      tool: 'query',
      summary: `摘要${i}`,
    }))
    seedSession('s1', [asst('eLong', { content: 'x'.repeat(1300), trace })])
    useLoomStore.getState().ensureBoard('teacher')
    const a = addTask('A')

    await runLoom()

    const out = nodeOf(a)?.runOutput as string
    expect(out.startsWith('x'.repeat(1200))).toBe(true)
    expect(out).not.toContain('x'.repeat(1201))
    expect(out).toContain('工具结果：')
    const bullets = out.split('\n').filter((l) => l.startsWith('- '))
    expect(bullets).toHaveLength(6)
    expect(bullets[0]).toContain('摘要0')
    expect(bullets).not.toContain('- 摘要6')
  })

  it('captureOutput：纯正文无 trace 时严格截断到 1200 字符', () => {
    const out = captureOutput(asst('e', { content: 'y'.repeat(1500) }))
    expect(out).toHaveLength(1200)
  })
})

describe('LoomRunner 非执行节点与文档收口（v0.9.4-03）', () => {
  it('便签不参与执行且不阻塞下游（A → 便签 → B 全链正常）', async () => {
    const calls = mockSend('e1')
    seedSession('s1', [asst('e1')])
    useLoomStore.getState().ensureBoard('teacher')
    const a = addTask('A')
    const note = useLoomStore.getState().addNode({ type: 'note', title: '随手记：周五前收作业' }) as string
    const b = addTask('B')
    useLoomStore.getState().connect(a, note)
    useLoomStore.getState().connect(note, b)

    await runLoom()

    expect(calls.map((x) => x.goal)).toEqual(['A', 'B'])
    expect(nodeOf(note)?.status).toBe('idle')
    expect([nodeOf(a)?.status, nodeOf(b)?.status]).toEqual(['done', 'done'])
  })

  it('文档节点不参与执行（即使状态未完成）', async () => {
    const calls = mockSend('e1')
    seedSession('s1', [asst('e1')])
    useLoomStore.getState().ensureBoard('teacher')
    const doc = useLoomStore
      .getState()
      .ensureArtifactOutputNode({ role: 'teacher', artifactId: 'art-1', title: '报告' }) as string
    addTask('A')

    await runLoom()

    expect(calls.map((x) => x.goal)).toEqual(['A'])
    expect(nodeOf(doc)?.status).toBe('running')
  })

  it('节点失败时未完成文档节点收口 error（artifact_meta 无 done）', async () => {
    mockSend('eFail')
    const trace: AgentTraceEvent[] = [
      { kind: 'artifact_meta', artifactId: 'art-9', title: '报告', docKind: 'report' },
    ]
    seedSession('s1', [asst('eFail', { content: '部分内容', error: '接口超时', trace })])
    useLoomStore.getState().ensureBoard('teacher')
    const a = addTask('A')
    useLoomStore.getState().ensureArtifactOutputNode({ role: 'teacher', artifactId: 'art-9', title: '报告' })

    await runLoom()

    expect(nodeOf(a)?.status).toBe('error')
    expect(board().nodes.find((n) => n.artifactId === 'art-9')?.status).toBe('error')
  })

  it('节点成功且文档已完成 → 文档节点保持 done（不被误伤）', async () => {
    mockSend('eOk')
    const trace: AgentTraceEvent[] = [
      { kind: 'artifact_meta', artifactId: 'art-7', title: '报告', docKind: 'report' },
      { kind: 'artifact_done', artifactId: 'art-7', title: '报告（终稿）', docKind: 'report' },
    ]
    seedSession('s1', [asst('eOk', { content: '完成', trace })])
    useLoomStore.getState().ensureBoard('teacher')
    addTask('A')
    useLoomStore.getState().ensureArtifactOutputNode({ role: 'teacher', artifactId: 'art-7', title: '报告' })
    useLoomStore.getState().setArtifactNodeStatus('art-7', 'done', '报告（终稿）')

    await runLoom()

    const doc = board().nodes.find((n) => n.artifactId === 'art-7')
    expect(doc?.status).toBe('done')
    expect(doc?.title).toBe('报告（终稿）')
  })
})

describe('chatStore context 透传', () => {
  const sess = (id: string, role: RoleId = 'teacher'): ChatSession => ({
    id, title: '会话', role, entries: [], createdAt: 0, updatedAt: 0,
  })

  it('旧路径 input 不含 context；带 context 时原样透传到 runTask', async () => {
    const spy = vi.spyOn(getProviders().agent, 'runTask').mockResolvedValue(undefined)
    useChatStore.setState({ sessions: [sess('s1')], activeId: 's1', streaming: false })

    await useChatStore.getState().sendMessage('旧路径目标')
    expect(spy.mock.calls[0][0]).not.toHaveProperty('context')

    const upstream: LoomUpstreamRef[] = [{ nodeId: 'a', title: '学情分析', output: '失分率 31%' }]
    await useChatStore.getState().sendMessage('新路径目标', { context: { loomNodeId: 'n1', upstream } })
    expect(spy.mock.calls[1][0].context).toEqual({ loomNodeId: 'n1', upstream })
  })

  it('带 loomNodeId 时不切换 activeId（后台执行不抢用户视图）', async () => {
    vi.spyOn(getProviders().agent, 'runTask').mockResolvedValue(undefined)
    /* 当前视图为其他角色会话 → 执行会另建会话，但结束后应恢复原视图 */
    useChatStore.setState({ sessions: [sess('sb', 'bureau')], activeId: 'sb', streaming: false })

    await useChatStore.getState().sendMessage('后台目标', { context: { loomNodeId: 'n1' } })

    expect(useChatStore.getState().activeId).toBe('sb')
  })
})
