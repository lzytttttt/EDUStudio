/**
 * v1.2 M3a · MissionRunner 执行内核单测（roadmap §4.2 / §4.6）
 *
 * 覆盖：拓扑调度与并发上限、计划校验（环/空/未知成员/缺依赖）、超时重试后 partial、
 * 失败继续与上游失败跳过、门 continue/cancel/缺省、abort cancelled、产物收集与类型映射、
 * handoffs/facts 注入与 history 恒空、事件 seq/种类/顺序、sink 异常隔离、两种剧本复用、注入覆盖。
 * 全部用 fake AgentProvider（脚本化 emit/延迟/抛错/挂起），不触网。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentProvider, AgentTaskInput, AgentTraceEvent } from '../harness/types'
import type {
  ApprovalGate,
  ExecutionPlan,
  FactSnapshot,
  MissionPlanTask,
  MissionRunEvent,
} from '../studio/contracts'
import type { DirectorAgentId } from '../harness/director/types'
import type { MissionGateWaiter, MissionRunnerDeps } from '../harness/team/types'
import {
  DEFAULT_CONCURRENCY,
  DEFAULT_MAX_TASK_RETRIES,
  DEFAULT_TASK_TIMEOUT_MS,
  runMission,
} from '../harness/team/runner'
import { MISSION_AGENT_SPECS } from '../harness/team/agents'
import { toolRegistry } from '../harness/agent/ToolRegistry'

/* ------------------------------------------------------------------ */
/* 夹具                                                                */
/* ------------------------------------------------------------------ */

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const abortError = (): Error => {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

const SNAPSHOT: FactSnapshot = {
  missionId: 'm-1',
  role: 'teacher',
  takenAt: 1_760_000_000_000,
  dataVersion: 'v1',
  facts: [
    {
      factId: 'f-avg',
      key: 'physics.avg',
      value: 80.4,
      unit: '分',
      label: '物理单元考均分',
      source: '学情库 · 高一（3）班',
      asOf: '2026-11-06',
      derived: true,
    },
  ],
}

const makeTask = (id: string, patch: Partial<MissionPlanTask> = {}): MissionPlanTask => ({
  id,
  agentId: 'analyst',
  title: `任务 ${id}`,
  seconds: 5,
  deps: [],
  ...patch,
})

const makePlan = (tasks: MissionPlanTask[], patch: Partial<ExecutionPlan> = {}): ExecutionPlan => ({
  missionId: 'm-1',
  kind: 'parent_meeting',
  execution: 'mock',
  tasks,
  facts: SNAPSHOT,
  agentSpecs: MISSION_AGENT_SPECS,
  ...patch,
})

interface FakeStep {
  events?: AgentTraceEvent[]
  delayMs?: number
  throws?: string
  /** 永不 resolve，直到 input.signal abort（用于超时 / abort 用例） */
  hang?: boolean
}
type FakeScript = (input: AgentTaskInput, callIndex: number) => FakeStep

interface FakeProviderHandle {
  provider: AgentProvider
  calls: AgentTaskInput[]
  stats(): { calls: number; maxActive: number }
}

function createFakeProvider(script: FakeScript = () => ({})): FakeProviderHandle {
  const calls: AgentTaskInput[] = []
  let active = 0
  let maxActive = 0
  const provider: AgentProvider = {
    async runTask(input, emit) {
      calls.push(input)
      active += 1
      maxActive = Math.max(maxActive, active)
      try {
        const step = script(input, calls.length - 1)
        for (const event of step.events ?? []) emit(event)
        if (step.delayMs) await delay(step.delayMs)
        if (step.hang) {
          await new Promise<void>((_, reject) => {
            if (input.signal?.aborted) {
              reject(abortError())
              return
            }
            input.signal?.addEventListener('abort', () => reject(abortError()), { once: true })
          })
        }
        if (step.throws) throw new Error(step.throws)
      } finally {
        active -= 1
      }
    },
  }
  return { provider, calls, stats: () => ({ calls: calls.length, maxActive }) }
}

const artifactEvents = (artifactId: string, title: string, docKind: string, markdown: string): AgentTraceEvent[] => [
  { kind: 'artifact_meta', artifactId, title, docKind },
  { kind: 'artifact_chunk', artifactId, chunk: markdown.slice(0, 4) },
  { kind: 'artifact_chunk', artifactId, chunk: markdown.slice(4) },
  { kind: 'artifact_done', artifactId, title, docKind },
]

const textEvent = (text: string): AgentTraceEvent => ({ kind: 'text', text })

/** 启动 mission（返回事件数组与 promise；abort 用例可拿 controller 中断） */
function startMission(
  plan: ExecutionPlan,
  agent: AgentProvider,
  deps: Omit<MissionRunnerDeps, 'agent'> = {},
  signal?: AbortSignal,
): { events: MissionRunEvent[]; controller: AbortController; promise: Promise<Awaited<ReturnType<typeof runMission>>> } {
  const events: MissionRunEvent[] = []
  const controller = new AbortController()
  const promise = runMission(plan, { agent, ...deps }, (event) => events.push(event), signal ?? controller.signal)
  return { events, controller, promise }
}

const kindsOf = (events: MissionRunEvent[]): string[] => events.map((event) => event.kind)

const agentOf = (input: AgentTaskInput): NonNullable<AgentTaskInput['agent']> => {
  if (!input.agent) throw new Error('缺少 agent 上下文')
  return input.agent
}

function createGateWaiter(resolution: 'continue' | 'cancel' | 'hang' = 'continue') {
  const gates: ApprovalGate[] = []
  const signals: AbortSignal[] = []
  const waiter: MissionGateWaiter = {
    async wait(gate, signal) {
      gates.push(gate)
      signals.push(signal)
      if (resolution === 'hang') return new Promise<'continue' | 'cancel'>(() => {})
      return resolution
    },
  }
  return { waiter, gates, signals }
}

/** 可外部 resolve 的 Promise（门串行化用例控制「门何时被点」） */
interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

/** 按门到达顺序脚本化的等待器（第 n 个门返回脚本值 / Promise） */
function createScriptedGateWaiter(
  script: (gate: ApprovalGate, index: number) => 'continue' | 'cancel' | Promise<'continue' | 'cancel'>,
) {
  const gates: ApprovalGate[] = []
  const signals: AbortSignal[] = []
  const waiter: MissionGateWaiter = {
    async wait(gate, signal) {
      const index = gates.length
      gates.push(gate)
      signals.push(signal)
      return script(gate, index)
    },
  }
  return { waiter, gates, signals }
}

afterEach(() => {
  vi.restoreAllMocks()
})

/* ------------------------------------------------------------------ */
/* 调度：拓扑 / 并发 / FIFO                                             */
/* ------------------------------------------------------------------ */

describe('调度：拓扑顺序与并发上限', () => {
  it('串行链 A→B→C 按拓扑顺序执行，全部完成且并发为 1', async () => {
    const handle = createFakeProvider((input) => ({ events: [textEvent(`完成 ${agentOf(input).taskId}`)] }))
    const plan = makePlan([makeTask('t1'), makeTask('t2', { deps: ['t1'] }), makeTask('t3', { deps: ['t2'] })])
    const { promise } = startMission(plan, handle.provider)
    const result = await promise

    expect(handle.calls.map((call) => agentOf(call).taskId)).toEqual(['t1', 't2', 't3'])
    expect(handle.stats().maxActive).toBe(1)
    expect(result.status).toBe('done')
    expect(result.completedTasks).toEqual(['t1', 't2', 't3'])
    expect(result.failedTasks).toEqual([])
    expect(result.attempts).toBe(3)
  })

  it('4 个独立任务并发执行，并发上限 ≤2 且实际用满 2', async () => {
    const handle = createFakeProvider(() => ({ delayMs: 20 }))
    const plan = makePlan([makeTask('a'), makeTask('b'), makeTask('c'), makeTask('d')])
    const { promise } = startMission(plan, handle.provider)
    const result = await promise

    expect(handle.stats().maxActive).toBe(DEFAULT_CONCURRENCY)
    expect(handle.stats().maxActive).toBe(2)
    expect(result.status).toBe('done')
    expect(result.completedTasks).toHaveLength(4)
  })

  it('deps.concurrency=1 时串行执行（注入更小上限生效）', async () => {
    const handle = createFakeProvider(() => ({ delayMs: 10 }))
    const plan = makePlan([makeTask('a'), makeTask('b'), makeTask('c')])
    const { promise } = startMission(plan, handle.provider, { concurrency: 1 })
    const result = await promise

    expect(handle.stats().maxActive).toBe(1)
    expect(result.completedTasks).toHaveLength(3)
  })

  it('分支拓扑：B/C 都在 A 之后启动，独立任务 D 不限顺序', async () => {
    const handle = createFakeProvider(() => ({ delayMs: 10 }))
    const plan = makePlan([
      makeTask('a'),
      makeTask('b', { deps: ['a'] }),
      makeTask('c', { deps: ['a'] }),
      makeTask('d'),
    ])
    const { promise } = startMission(plan, handle.provider)
    const order = await promise.then(() => handle.calls.map((call) => agentOf(call).taskId))

    expect(order).toHaveLength(4)
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'))
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'))
  })

  it('同优先级按 plan 顺序 FIFO 发起（并发 2 时先发起前两个就绪任务）', async () => {
    const handle = createFakeProvider(() => ({ delayMs: 15 }))
    const plan = makePlan([makeTask('a'), makeTask('b'), makeTask('c'), makeTask('d')])
    const { promise } = startMission(plan, handle.provider)
    await promise
    expect(handle.calls.slice(0, 2).map((call) => agentOf(call).taskId)).toEqual(['a', 'b'])
  })
})

/* ------------------------------------------------------------------ */
/* 计划校验：非法计划拒绝执行                                            */
/* ------------------------------------------------------------------ */

describe('计划校验：非法计划不执行', () => {
  it('成环计划被拒绝：不发起任何请求，status=partial 且原因含「循环依赖」', async () => {
    const handle = createFakeProvider()
    const plan = makePlan([makeTask('t1', { deps: ['t2'] }), makeTask('t2', { deps: ['t1'] })])
    const { promise, events } = startMission(plan, handle.provider)
    const result = await promise

    expect(handle.calls).toHaveLength(0)
    expect(result.status).toBe('partial')
    expect(result.completedTasks).toEqual([])
    expect(result.failedTasks.some((failed) => failed.reason.includes('循环依赖'))).toBe(true)
    expect(kindsOf(events)).toContain('error')
    expect(kindsOf(events)).toContain('partial')
  })

  it('空计划被拒绝：原因含「计划为空」', async () => {
    const handle = createFakeProvider()
    const { promise } = startMission(makePlan([]), handle.provider)
    const result = await promise

    expect(handle.calls).toHaveLength(0)
    expect(result.status).toBe('partial')
    expect(result.failedTasks[0].reason).toContain('计划为空')
    expect(result.attempts).toBe(0)
  })

  it('未知执行成员被拒绝：原因含成员 id', async () => {
    const handle = createFakeProvider()
    const plan = makePlan([makeTask('t1', { agentId: 'hacker' as DirectorAgentId })])
    const result = await startMission(plan, handle.provider).promise

    expect(handle.calls).toHaveLength(0)
    expect(result.status).toBe('partial')
    expect(result.failedTasks[0].reason).toContain('未知执行成员')
    expect(result.failedTasks[0].reason).toContain('hacker')
  })

  it('依赖 id 不存在被拒绝：原因含缺失的依赖 id', async () => {
    const handle = createFakeProvider()
    const plan = makePlan([makeTask('t1', { deps: ['ghost'] })])
    const result = await startMission(plan, handle.provider).promise

    expect(handle.calls).toHaveLength(0)
    expect(result.status).toBe('partial')
    expect(result.failedTasks[0].reason).toContain('依赖任务不存在')
    expect(result.failedTasks[0].reason).toContain('ghost')
  })
})

/* ------------------------------------------------------------------ */
/* 容错：重试 / 超时 / 失败分支                                          */
/* ------------------------------------------------------------------ */

describe('容错：重试、超时与失败分支', () => {
  it('首次抛错、重试成功 → status=done，attempts=2，failedTasks 为空', async () => {
    const handle = createFakeProvider((_input, callIndex) => (callIndex === 0 ? { throws: '一次性失败' } : {}))
    const { promise } = startMission(makePlan([makeTask('t1')]), handle.provider)
    const result = await promise

    expect(result.status).toBe('done')
    expect(result.attempts).toBe(2)
    expect(handle.calls).toHaveLength(2)
    expect(result.failedTasks).toEqual([])
    expect(result.completedTasks).toEqual(['t1'])
  })

  it('持续超时：重试 1 次后标记 partial，原因含「超时」，独立任务照常完成', async () => {
    const handle = createFakeProvider((input) => (agentOf(input).taskId === 'slow' ? { hang: true } : {}))
    const plan = makePlan([makeTask('slow'), makeTask('fast')])
    const { promise } = startMission(plan, handle.provider, { taskTimeoutMs: 15, maxTaskRetries: 1 })
    const result = await promise

    expect(result.status).toBe('partial')
    expect(result.completedTasks).toEqual(['fast'])
    const failure = result.failedTasks.find((failed) => failed.taskId === 'slow')
    expect(failure?.reason).toContain('超时')
    expect(result.attempts).toBe(3) // slow 2 次 + fast 1 次
  })

  it('单任务失败不影响独立分支：A 抛错、B 完成 → partial', async () => {
    const handle = createFakeProvider((input) => (agentOf(input).taskId === 'a' ? { throws: '工具越权' } : {}))
    const plan = makePlan([makeTask('a'), makeTask('b')])
    const result = await startMission(plan, handle.provider).promise

    expect(result.status).toBe('partial')
    expect(result.completedTasks).toEqual(['b'])
    expect(result.failedTasks).toEqual([{ taskId: 'a', reason: '工具越权' }])
  })

  it('失败依赖的后继被跳过：不发起请求，标记「上游失败未执行」并级联', async () => {
    const handle = createFakeProvider((input) => (agentOf(input).taskId === 'a' ? { throws: '失败' } : {}))
    const plan = makePlan([
      makeTask('a'),
      makeTask('b', { deps: ['a'] }),
      makeTask('c', { deps: ['b'] }),
    ])
    // 关掉重试，聚焦「失败依赖级联跳过」语义
    const result = await startMission(plan, handle.provider, { maxTaskRetries: 0 }).promise

    expect(handle.calls.map((call) => agentOf(call).taskId)).toEqual(['a'])
    expect(result.status).toBe('partial')
    expect(result.failedTasks).toEqual([
      { taskId: 'a', reason: '失败' },
      { taskId: 'b', reason: '上游失败未执行' },
      { taskId: 'c', reason: '上游失败未执行' },
    ])
  })

  it('maxTaskRetries=0 时不重试（attempts 等于请求数）', async () => {
    const handle = createFakeProvider(() => ({ throws: '不可重试' }))
    const result = await startMission(makePlan([makeTask('t1')]), handle.provider, { maxTaskRetries: 0 }).promise

    expect(handle.calls).toHaveLength(1)
    expect(result.attempts).toBe(1)
    expect(result.status).toBe('partial')
  })
})

/* ------------------------------------------------------------------ */
/* 事件：seq 单调 / 种类 / 派发顺序 / sink 隔离                          */
/* ------------------------------------------------------------------ */

describe('运行事件', () => {
  it('seq 从 1 单调递增，且含 task.start / feed / task.done', async () => {
    const handle = createFakeProvider((input) => ({
      events: [textEvent(`已处理 ${agentOf(input).taskId}`), { kind: 'reflect', text: '核对口径中' }],
    }))
    const { promise, events } = startMission(makePlan([makeTask('t1')]), handle.provider)
    await promise

    expect(events.length).toBeGreaterThan(0)
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1))
    const kinds = kindsOf(events)
    expect(kinds).toContain('task.start')
    expect(kinds).toContain('feed')
    expect(kinds).toContain('task.done')
  })

  it('task.start 在 task.done 之前，事件带 taskId 与 agentId', async () => {
    const handle = createFakeProvider()
    const { promise, events } = startMission(makePlan([makeTask('t1', { agentId: 'curriculum' })]), handle.provider)
    await promise

    const start = events.find((event) => event.kind === 'task.start')
    const done = events.find((event) => event.kind === 'task.done')
    expect(start?.taskId).toBe('t1')
    expect(start?.agentId).toBe('curriculum')
    expect(done?.taskId).toBe('t1')
    expect(events.indexOf(start!)).toBeLessThan(events.indexOf(done!))
  })

  it('有失败时发 partial 事件（带原因），全成功时不发', async () => {
    const failing = createFakeProvider(() => ({ throws: '坏了' }))
    const failingRun = await startMission(makePlan([makeTask('t1')]), failing.provider).promise
    expect(failingRun.status).toBe('partial')

    const okHandle = createFakeProvider()
    const ok = startMission(makePlan([makeTask('t1')]), okHandle.provider)
    await ok.promise
    expect(kindsOf(ok.events)).not.toContain('partial')
    expect(kindsOf(ok.events)).not.toContain('error')
  })

  it('sink 抛错被隔离：mission 仍完成，console.error 记录且不向上抛', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const handle = createFakeProvider()
    const controller = new AbortController()
    const result = await runMission(
      makePlan([makeTask('t1')]),
      { agent: handle.provider },
      () => {
        throw new Error('sink 坏了')
      },
      controller.signal,
    )

    expect(result.status).toBe('done')
    expect(errorSpy).toHaveBeenCalled()
  })

  it('partial 事件文案包含未完成环节 id', async () => {
    const handle = createFakeProvider((input) => (agentOf(input).taskId === 'a' ? { throws: 'x' } : {}))
    const { promise, events } = startMission(makePlan([makeTask('a'), makeTask('b')]), handle.provider)
    await promise

    const partial = events.find((event) => event.kind === 'partial')
    expect(partial?.error).toContain('1 个环节未完成')
    expect(partial?.text).toContain('a')
  })
})

/* ------------------------------------------------------------------ */
/* 审批门                                                              */
/* ------------------------------------------------------------------ */

describe('审批门', () => {
  it('gate continue：投影 ApprovalGate（letters 为硬门）→ 任务计为完成', async () => {
    const handle = createFakeProvider()
    const gate = createGateWaiter('continue')
    const task = makeTask('t3', { agentId: 'communicator', title: '写 3 封家长信', gate: 'letters' })
    const { promise, events } = startMission(makePlan([task]), handle.provider, { gate: gate.waiter })
    const result = await promise

    expect(result.status).toBe('done')
    expect(result.completedTasks).toEqual(['t3'])
    expect(gate.gates).toHaveLength(1)
    expect(gate.gates[0]).toMatchObject({
      gateId: 'letters',
      missionId: 'm-1',
      taskId: 't3',
      source: 'mission',
      ownerAgentId: 'communicator',
      requiredAction: 'approve',
      sensitive: true,
    })
    expect(gate.signals[0]).toBeInstanceOf(AbortSignal)
    const gateEvent = events.find((event) => event.kind === 'gate')
    expect(gateEvent?.gate?.gateId).toBe('letters')
    expect(events.find((event) => event.kind === 'task.done')?.taskId).toBe('t3')
  })

  it('gate cancel：该任务 failed（reason=门被退回），后继任务被跳过', async () => {
    const handle = createFakeProvider()
    const gate = createGateWaiter('cancel')
    const plan = makePlan([
      makeTask('t2', { gate: 'speech' }),
      makeTask('t3', { deps: ['t2'] }),
    ])
    const { promise, events } = startMission(plan, handle.provider, { gate: gate.waiter })
    const result = await promise

    expect(result.status).toBe('partial')
    expect(result.failedTasks).toEqual([
      { taskId: 't2', reason: '门被退回' },
      { taskId: 't3', reason: '上游失败未执行' },
    ])
    expect(result.completedTasks).toEqual([])
    expect(events.some((event) => event.kind === 'feed' && event.text?.includes('已退回'))).toBe(true)
  })

  it('未注入 gate waiter 时缺省 continue（单测 / 演示路径）', async () => {
    const handle = createFakeProvider()
    const task = makeTask('t1', { gate: 'worksheet' })
    const { promise, events } = startMission(makePlan([task]), handle.provider)
    const result = await promise

    expect(result.status).toBe('done')
    expect(result.completedTasks).toEqual(['t1'])
    expect(events.find((event) => event.kind === 'gate')).toBeTruthy()
  })

  it('gate 等待期间 abort → status=cancelled，该任务既不计完成也不计失败', async () => {
    const handle = createFakeProvider()
    const gate = createGateWaiter('hang')
    const { promise, controller, events } = startMission(
      makePlan([makeTask('t1', { gate: 'lesson' })]),
      handle.provider,
      { gate: gate.waiter },
    )
    await delay(15)
    controller.abort()
    const result = await promise

    expect(result.status).toBe('cancelled')
    expect(result.completedTasks).toEqual([])
    expect(result.failedTasks).toEqual([])
    expect(events.some((event) => event.kind === 'gate')).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* 取消                                                                */
/* ------------------------------------------------------------------ */

describe('取消', () => {
  it('父 signal abort → status=cancelled；已完成的保留，在飞任务不计失败', async () => {
    const handle = createFakeProvider((input) => (agentOf(input).taskId === 'fast' ? { delayMs: 5 } : { hang: true }))
    const plan = makePlan([makeTask('fast'), makeTask('slow')])
    const { promise, controller } = startMission(plan, handle.provider)
    await delay(30)
    controller.abort()
    const result = await promise

    expect(result.status).toBe('cancelled')
    expect(result.completedTasks).toEqual(['fast'])
    expect(result.failedTasks).toEqual([])
  })

  it('启动前已 abort：不发起任何请求，status=cancelled', async () => {
    const handle = createFakeProvider()
    const controller = new AbortController()
    controller.abort()
    const result = await runMission(makePlan([makeTask('t1')]), { agent: handle.provider }, () => {}, controller.signal)

    expect(handle.calls).toHaveLength(0)
    expect(result.status).toBe('cancelled')
  })
})

/* ------------------------------------------------------------------ */
/* 产物收集 / 注入                                                     */
/* ------------------------------------------------------------------ */

describe('产物收集与类型映射', () => {
  it('artifact_meta/chunk/done → RunnerArtifact（Markdown 完整、kindCn 由英文 kind 映射）', async () => {
    const handle = createFakeProvider(() => ({
      events: artifactEvents('art-1', '习题课教案', 'lessonPlan', '# 习题课教案\n目标与环节'),
    }))
    const { promise, events } = startMission(makePlan([makeTask('t1', { agentId: 'curriculum' })]), handle.provider)
    const result = await promise

    expect(result.artifacts).toHaveLength(1)
    expect(result.artifacts[0]).toMatchObject({
      taskId: 't1',
      agentId: 'curriculum',
      title: '习题课教案',
      markdown: '# 习题课教案\n目标与环节',
      kindCn: '教案',
    })
    expect(result.artifactIds).toEqual(['art-1'])
    const artifactEvent = events.find((event) => event.kind === 'artifact')
    expect(artifactEvent?.artifact).toMatchObject({ title: '习题课教案', kindCn: '教案' })
    expect(artifactEvent?.artifact?.markdown).toContain('目标与环节')
  })

  it('英文 docKind 映射：notice→讲稿、report→摘要；中文 docKind 原样保留', async () => {
    const script = (input: AgentTaskInput): FakeStep => {
      const taskId = agentOf(input).taskId
      if (taskId === 'a') return { events: artifactEvents('art-a', '家长会讲稿', 'notice', '讲稿正文') }
      if (taskId === 'b') return { events: artifactEvents('art-b', '学情简报', 'report', '简报正文') }
      return { events: artifactEvents('art-c', '分层练习单', '练习单', '练习正文') }
    }
    const handle = createFakeProvider(script)
    const plan = makePlan([makeTask('a'), makeTask('b'), makeTask('c')])
    const result = await startMission(plan, handle.provider).promise

    expect(result.artifacts.map((artifact) => artifact.kindCn)).toEqual(['讲稿', '摘要', '练习单'])
  })

  it('失败 attempt 的产物被丢弃（重试成功后只保留最终产物）', async () => {
    const handle = createFakeProvider((_input, callIndex) =>
      callIndex === 0
        ? { events: artifactEvents('art-old', '旧草稿', 'report', '旧内容'), throws: '本 attempt 失败' }
        : { events: artifactEvents('art-new', '定稿', 'report', '新内容') },
    )
    const { promise } = startMission(makePlan([makeTask('t1')]), handle.provider)
    const result = await promise

    expect(result.status).toBe('done')
    expect(result.artifacts.map((artifact) => artifact.title)).toEqual(['定稿'])
    expect(result.artifactIds).toEqual(['art-new'])
  })
})

describe('上下文注入：handoffs / facts / history', () => {
  it('依赖完成后，后继 Agent 只收到 declared handoffs（含产物摘要与 citations）', async () => {
    const markdown = '学情简报：均分 {{80.4~学情库 · 高一（3）班}}'
    const handle = createFakeProvider((input) => {
      const taskId = agentOf(input).taskId
      if (taskId === 'a') {
        return { events: [textEvent('数据核对完成'), ...artifactEvents('art-a', '学情简报', 'report', markdown)] }
      }
      return {}
    })
    const plan = makePlan([
      makeTask('a', { agentId: 'analyst', title: '核对学情' }),
      makeTask('b', { agentId: 'curriculum', deps: ['a'], title: '写教案' }),
    ])
    const result = await startMission(plan, handle.provider).promise

    expect(result.status).toBe('done')
    const second = handle.calls.find((call) => agentOf(call).taskId === 'b')
    const context = agentOf(second as AgentTaskInput)
    expect(context.handoffs).toHaveLength(1)
    expect(context.handoffs![0]).toMatchObject({ from: 'analyst', to: 'curriculum', taskId: 'a' })
    expect(context.handoffs![0].summary).toContain('学情简报')
    expect(context.handoffs![0].citations).toEqual([{ value: '80.4', source: '学情库 · 高一（3）班' }])
  })

  it('facts 来自冻结快照；missionId/taskId/id/baseRole/tools 正确注入', async () => {
    const handle = createFakeProvider()
    const plan = makePlan([makeTask('t1', { agentId: 'chief', title: '汇总与校验' })])
    await startMission(plan, handle.provider).promise

    const input = handle.calls[0]
    const context = agentOf(input)
    expect(input.role).toBe('teacher')
    expect(input.goal).toBe('汇总与校验')
    expect(context.id).toBe('chief')
    expect(context.baseRole).toBe('inherit')
    expect(context.missionId).toBe('m-1')
    expect(context.taskId).toBe('t1')
    expect(context.memoryNs).toBe('agent.chief')
    expect(context.facts).toEqual([
      {
        factId: 'f-avg',
        key: 'physics.avg',
        value: 80.4,
        unit: '分',
        label: '物理单元考均分',
        source: '学情库 · 高一（3）班',
      },
    ])
    const teacherTools = new Set(toolRegistry.listForRole('teacher').map((tool) => tool.name))
    expect(context.tools.length).toBeGreaterThan(0)
    for (const tool of context.tools) expect(teacherTools.has(tool)).toBe(true)
  })

  it('history 恒为空数组、不注入全局会话上下文（隔离红线）', async () => {
    const handle = createFakeProvider()
    await startMission(makePlan([makeTask('t1')]), handle.provider).promise
    expect(handle.calls[0].history).toEqual([])
    expect(handle.calls[0].context).toBeUndefined()
  })

  it('无依赖任务 handoffs 为空（不传全局会话）', async () => {
    const handle = createFakeProvider()
    await startMission(makePlan([makeTask('t1')]), handle.provider).promise
    expect(agentOf(handle.calls[0]).handoffs).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* 剧本复用 / 注入覆盖 / 时间源                                          */
/* ------------------------------------------------------------------ */

describe('计划复用与注入覆盖', () => {
  it('parent_meeting 与 exam_loop 两份计划复用同一 runner，均执行成功', async () => {
    const tasks = [makeTask('t1'), makeTask('t2', { deps: ['t1'] }), makeTask('t3', { deps: ['t1'] })]
    for (const kind of ['parent_meeting', 'exam_loop'] as const) {
      const handle = createFakeProvider()
      const result = await startMission(makePlan(tasks, { kind }), handle.provider).promise
      expect(result.status).toBe('done')
      expect(result.completedTasks).toHaveLength(3)
      expect(handle.calls).toHaveLength(3)
    }
  })

  it('deps.agentSpecs 覆盖注册表：name/tools 生效，工具仍取教师域交集', async () => {
    const handle = createFakeProvider()
    const custom = {
      ...MISSION_AGENT_SPECS.analyst,
      name: '自定义分析岗',
      tools: ['genQuiz', 'bogusTool'],
    }
    await startMission(makePlan([makeTask('t1', { agentId: 'analyst' })]), handle.provider, {
      agentSpecs: { analyst: custom },
    }).promise

    const context = agentOf(handle.calls[0])
    expect(context.name).toBe('自定义分析岗')
    expect(context.tools).toEqual(['genQuiz'])
  })

  it('elapsedMs 使用注入的时间源（可测）', async () => {
    const handle = createFakeProvider()
    let clock = 1000
    const now = (): number => {
      clock += 25
      return clock
    }
    const result = await startMission(makePlan([makeTask('t1')]), handle.provider, { now }).promise
    expect(result.elapsedMs).toBe(25) // 开始取一次（1025）、结束取一次（1050）→ 25ms
  })

  it('缺省常量与 roadmap 口径一致（90s / 1 次重试 / 并发 2）', () => {
    expect(DEFAULT_TASK_TIMEOUT_MS).toBe(90_000)
    expect(DEFAULT_MAX_TASK_RETRIES).toBe(1)
    expect(DEFAULT_CONCURRENCY).toBe(2)
  })
})

/* ------------------------------------------------------------------ */
/* 刷新续跑 seed（M3a optional 扩展：deps.completedTasks）               */
/* ------------------------------------------------------------------ */

describe('刷新续跑 seed（deps.completedTasks）', () => {
  it('seed 已完成的任务跳过不执行：只跑剩余任务，且不 emit seed 的事件', async () => {
    const handle = createFakeProvider((input) => ({ events: [textEvent(`完成 ${agentOf(input).taskId}`)] }))
    const plan = makePlan([makeTask('a'), makeTask('b'), makeTask('c', { deps: ['a', 'b'] })])
    const { promise, events } = startMission(plan, handle.provider, { completedTasks: ['a'] })
    const result = await promise

    expect(handle.calls.map((call) => agentOf(call).taskId)).toEqual(['b', 'c'])
    expect(result.status).toBe('done')
    expect(result.attempts).toBe(2)
    expect(result.completedTasks).toEqual(['a', 'b', 'c'])
    /* seed 不 emit 事件：事件流里没有 taskId='a' 的 task.start / task.done */
    expect(events.some((event) => event.taskId === 'a')).toBe(false)
  })

  it('依赖 seed 完成的任务视为依赖满足，正常发起执行', async () => {
    const handle = createFakeProvider()
    const plan = makePlan([makeTask('a'), makeTask('b', { deps: ['a'] })])
    const result = await startMission(plan, handle.provider, { completedTasks: ['a'] }).promise

    expect(handle.calls.map((call) => agentOf(call).taskId)).toEqual(['b'])
    expect(result.status).toBe('done')
    expect(result.completedTasks).toEqual(['a', 'b'])
    expect(result.failedTasks).toEqual([])
  })

  it('seed id 去重且出现在返回值 completedTasks；不会重复执行', async () => {
    const handle = createFakeProvider()
    const plan = makePlan([makeTask('a'), makeTask('b')])
    const result = await startMission(plan, handle.provider, { completedTasks: ['a', 'a'] }).promise

    expect(handle.calls.map((call) => agentOf(call).taskId)).toEqual(['b'])
    expect(result.completedTasks.filter((id) => id === 'a')).toHaveLength(1)
    expect(result.completedTasks).toEqual(['a', 'b'])
    expect(result.attempts).toBe(1)
  })

  it('seed 中不在 plan.tasks 里的 id 被忽略（不影响调度与校验）', async () => {
    const handle = createFakeProvider()
    const plan = makePlan([makeTask('a')])
    const result = await startMission(plan, handle.provider, { completedTasks: ['ghost', 'a'] }).promise

    expect(handle.calls).toHaveLength(0)
    expect(result.status).toBe('done')
    expect(result.completedTasks).toEqual(['a'])
    expect(result.attempts).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* 门串行化（M3 集成修复：directorStore 只有单个 mission.gate 字段）      */
/* ------------------------------------------------------------------ */

describe('门串行化：同一时刻最多一个带门任务在等门', () => {
  it('两个带门任务不同时等门：先到者等待期间，另一个保持 pending 不启动也不提前失败', async () => {
    const firstGate = deferred<'continue' | 'cancel'>()
    const handle = createFakeProvider()
    const gate = createScriptedGateWaiter((_gate, index) => (index === 0 ? firstGate.promise : 'continue'))
    const plan = makePlan([makeTask('g1', { gate: 'speech' }), makeTask('g2', { gate: 'lesson' })])
    const { promise } = startMission(plan, handle.provider, { gate: gate.waiter })

    await delay(30)
    // 首个门在等：只发出 1 个请求、只到达 1 个门；后一个带门任务尚未启动（保持 pending）
    expect(gate.gates).toHaveLength(1)
    expect(gate.gates[0].gateId).toBe('speech')
    expect(handle.calls).toHaveLength(1)

    firstGate.resolve('continue')
    const result = await promise

    expect(gate.gates.map((item) => item.gateId)).toEqual(['speech', 'lesson'])
    expect(handle.calls.map((call) => agentOf(call).taskId)).toEqual(['g1', 'g2'])
    expect(result.status).toBe('done')
    expect(result.completedTasks).toEqual(['g1', 'g2'])
    expect(result.failedTasks).toEqual([])
  })

  it('门 cancel 后释放串行限制：另一个带门任务照常执行并等门（不悬挂、不提前失败）', async () => {
    const handle = createFakeProvider()
    const gate = createScriptedGateWaiter((_gate, index) => (index === 0 ? 'cancel' : 'continue'))
    const plan = makePlan([makeTask('g1', { gate: 'letters' }), makeTask('g2', { gate: 'speech' })])
    const result = await startMission(plan, handle.provider, { gate: gate.waiter }).promise

    expect(gate.gates.map((item) => item.gateId)).toEqual(['letters', 'speech'])
    expect(handle.calls.map((call) => agentOf(call).taskId)).toEqual(['g1', 'g2'])
    expect(result.status).toBe('partial')
    expect(result.failedTasks).toEqual([{ taskId: 'g1', reason: '门被退回' }])
    expect(result.completedTasks).toEqual(['g2'])
  })

  it('门等待期间无门任务仍按并发 2 执行（门不占并发槽、不阻塞无门分支）', async () => {
    const pendingGate = deferred<'continue' | 'cancel'>()
    const gate = createScriptedGateWaiter(() => pendingGate.promise)
    const handle = createFakeProvider(() => ({ delayMs: 15 }))
    const plan = makePlan([makeTask('g', { gate: 'speech' }), makeTask('a'), makeTask('b'), makeTask('c')])
    const { promise } = startMission(plan, handle.provider, { gate: gate.waiter })

    await delay(70)
    // 门仍在等，但 3 个无门任务已全部执行完（并发 2 跑两轮）
    expect(gate.gates).toHaveLength(1)
    expect(handle.calls).toHaveLength(4)
    expect(handle.stats().maxActive).toBeLessThanOrEqual(2)

    pendingGate.resolve('continue')
    const result = await promise
    expect(result.status).toBe('done')
    expect([...result.completedTasks].sort()).toEqual(['a', 'b', 'c', 'g'])
  })

  it('带门任务 + 依赖链不死锁：前一门解决后，后一门的任务与下游依次执行', async () => {
    const handle = createFakeProvider()
    const gate = createScriptedGateWaiter(() => 'continue')
    const plan = makePlan([
      makeTask('x', { gate: 'worksheet' }),
      makeTask('y', { gate: 'lesson' }),
      makeTask('z', { deps: ['y'] }),
    ])
    const result = await startMission(plan, handle.provider, { gate: gate.waiter }).promise

    expect(gate.gates.map((item) => item.gateId)).toEqual(['worksheet', 'lesson'])
    expect(handle.calls.map((call) => agentOf(call).taskId)).toEqual(['x', 'y', 'z'])
    expect(result.status).toBe('done')
    expect(result.completedTasks).toEqual(['x', 'y', 'z'])
  })
})
