/**
 * v1.2 M0 · DirectorPorts 端口契约与测试替身单测（roadmap §3.5 / §3.10）
 * 覆盖：类型赋值断言（≥1 例）+ intake/execution/deliverables/evidence/memory/team/notify/navigate 行为断言。
 */
import { describe, expect, it } from 'vitest'
import type { AgentRuntimeStatus, ArtifactRef, DirectorPorts, ExecutionResult, MissionDraft, MissionRunEvent, VerifySummary } from '../studio/contracts'
import {
  createFakeBriefingCard,
  createFakeDeliverableDraft,
  createFakeExecutionPlan,
  createFakePorts,
} from './helpers/fakePorts'

describe('DirectorPorts 类型契约', () => {
  it('createFakePorts 返回值可直接赋给 DirectorPorts，8 个端口齐全', () => {
    const ports: DirectorPorts = createFakePorts()
    const keys: (keyof DirectorPorts)[] = [
      'intake',
      'execution',
      'deliverables',
      'evidence',
      'memory',
      'team',
      'notify',
      'navigate',
    ]
    for (const key of keys) expect(ports[key]).toBeTruthy()
  })

  it('各端口方法签名与契约可赋值（编译期断言）', () => {
    const ports = createFakePorts()
    const fromCard: DirectorPorts['intake']['fromCard'] = ports.intake.fromCard
    const submit: DirectorPorts['intake']['submit'] = ports.intake.submit
    const start: DirectorPorts['execution']['start'] = ports.execution.start
    const publish: DirectorPorts['deliverables']['publish'] = ports.deliverables.publish
    const verify: DirectorPorts['evidence']['verify'] = ports.evidence.verify
    const status: DirectorPorts['team']['status'] = ports.team.status
    const toast: DirectorPorts['notify']['toast'] = ports.notify.toast
    const navigate: DirectorPorts['navigate'] = ports.navigate
    for (const fn of [fromCard, submit, start, publish, verify, status, toast]) expect(fn).toBeTypeOf('function')
    expect(navigate.canBack).toBeTypeOf('function')
    expect(navigate.canBack()).toBe(false)
  })

  it('team.status 返回的 AgentRuntimeStatus 形状符合契约（三态 + 计数）', () => {
    const status: AgentRuntimeStatus = createFakePorts().team.status('chief')
    expect(status.agentId).toBe('chief')
    expect(['idle', 'running', 'waiting']).toContain(status.status)
    expect(typeof status.done).toBe('number')
    expect(typeof status.failed).toBe('number')
    expect(['L0', 'L1', 'L2', 'L3']).toContain(status.autonomy)
  })
})

describe('intake 端口', () => {
  it('fromCard 把简报卡转成 utterance + 结构化约束', () => {
    const ports = createFakePorts()
    const card = createFakeBriefingCard()
    const { utterance, constraints } = ports.intake.fromCard(card)
    expect(utterance).toContain(card.title)
    expect(constraints).toEqual({ cardId: 'card-1', type: 'decision', tag: 'd-drill' })
  })

  it('submit 返回可上屏 MissionDraft；confirm 记录 draftId', async () => {
    const ports = createFakePorts()
    const draft: MissionDraft = await ports.intake.submit({ utterance: '下周三家长会', source: 'inbox' })
    expect(draft.planSource).toBe('template')
    expect(draft.kind).toBe('parent_meeting')
    expect(draft.tasks.length).toBeGreaterThan(0)
    expect(draft.utterance).toBe('下周三家长会')
    ports.intake.confirm(draft.id)
    expect(ports.calls.intakes).toHaveLength(1)
    expect(ports.calls.confirmed).toEqual([draft.id])
  })
})

describe('execution 端口', () => {
  it('start 通过 sink 顺序派发运行事件，并返回 done 结果', async () => {
    const ports = createFakePorts()
    const plan = createFakeExecutionPlan()
    const events: MissionRunEvent[] = []
    const controller = new AbortController()
    expect(ports.execution.mode()).toBe('mock')

    const result: ExecutionResult = await ports.execution.start(plan, (event) => events.push(event), controller.signal)

    expect(events.map((event) => event.seq)).toEqual([1, 2, 3])
    expect(events.map((event) => event.taskId)).toEqual(['t-analyst', 't-curriculum', 't-communicator'])
    expect(events.map((event) => event.kind)).toEqual(['task.start', 'task.start', 'task.start'])
    expect(result.status).toBe('done')
    expect(result.completedTasks).toEqual(['t-analyst', 't-curriculum', 't-communicator'])
    expect(result.failedTasks).toEqual([])
    expect(result.artifactIds).toEqual(['doc-fake'])
    expect(ports.calls.startedMissions).toEqual(['m-fake'])
    expect(ports.calls.runEvents).toHaveLength(3)
  })

  it('abort 后 start 返回 cancelled；resume / cancel 记录调用', async () => {
    const ports = createFakePorts()
    const controller = new AbortController()
    controller.abort()
    const result = await ports.execution.start(createFakeExecutionPlan(), () => {}, controller.signal)
    expect(result.status).toBe('cancelled')
    expect(result.completedTasks).toEqual([])

    await ports.execution.resume('m-1')
    ports.execution.cancel('m-2')
    expect(ports.calls.resumed).toEqual(['m-1'])
    expect(ports.calls.cancelled).toEqual(['m-2'])
  })
})

describe('deliverables 端口', () => {
  it('publish 返回 ArtifactRef 并记录草稿；open / export / share 记录调用', async () => {
    const ports = createFakePorts()
    const draft = createFakeDeliverableDraft()
    const ref: ArtifactRef = await ports.deliverables.publish(draft)
    expect(ref).toEqual({ docId: 'doc-1', title: '家长会讲稿' })

    ports.deliverables.open(ref)
    await ports.deliverables.export(ref, 'docx')
    await expect(ports.deliverables.share(ref)).resolves.toBe('#share=doc-1')

    expect(ports.calls.published).toEqual([draft])
    expect(ports.calls.opened).toEqual([ref])
    expect(ports.calls.exported).toEqual([{ ref, format: 'docx' }])
    expect(ports.calls.shared).toEqual([ref])
  })
})

describe('evidence 端口', () => {
  it('snapshot 返回角色事实快照；verify 返回计数汇总并记录入参', async () => {
    const ports = createFakePorts()
    const snapshot = await ports.evidence.snapshot('teacher')
    expect(snapshot.role).toBe('teacher')
    expect(snapshot.facts).toHaveLength(1)
    expect(snapshot.facts[0].factId).toBe('f-avg')

    const summary: VerifySummary = ports.evidence.verify('# 讲稿：均分 80.4 分', snapshot)
    expect(summary).toEqual({ total: 2, verified: 1, derived: 1, conflict: 0, unverified: 0, structural: 0 })
    expect(ports.calls.verifications[0].markdown).toContain('80.4')
    expect(ports.calls.snapshots).toEqual(['teacher'])
  })
})

describe('memory 端口', () => {
  it('recordAgent 后可按 agent 过滤 recent / semantic；教师反馈单独记录', async () => {
    const ports = createFakePorts()
    ports.memory.recordAgent({ t: 1, role: 'teacher', kind: 'episodic', goal: '家长会', agentId: 'communicator' })
    ports.memory.recordAgent({
      t: 2,
      role: 'teacher',
      kind: 'semantic',
      key: 'teacher.agent.analyst.pref',
      value: '先共情再事实',
      agentId: 'analyst',
    })

    const recent = await ports.memory.recentForAgent('communicator')
    expect(recent).toHaveLength(1)
    expect(recent[0].goal).toBe('家长会')

    const semantic = await ports.memory.semanticForAgent('analyst')
    expect(semantic).toHaveLength(1)
    expect(semantic[0].key).toBe('teacher.agent.analyst.pref')

    ports.memory.recordTeacherFeedback({ t: 3, role: 'teacher', kind: 'semantic', key: 'teacher.pref', value: 1 })
    expect(ports.calls.teacherFeedback).toHaveLength(1)
    expect(ports.calls.agentMemory).toHaveLength(2)
  })
})

describe('team / notify 端口', () => {
  it('roster 返回 6 名成员；grant 记录授权级别', () => {
    const ports = createFakePorts()
    const roster = ports.team.roster()
    expect(roster).toHaveLength(6)
    expect(roster.map((agent) => agent.id)).toEqual([
      'chief',
      'analyst',
      'assessor',
      'curriculum',
      'communicator',
      'steward',
    ])
    ports.team.grant('communicator', 'L1')
    expect(ports.calls.granted).toEqual([{ agentId: 'communicator', level: 'L1' }])
  })

  it('notify 记录决策与 toast（kind 透传，缺省 undefined）', () => {
    const ports = createFakePorts()
    const notice = { id: 'n-1', source: 'mission' as const, refId: 'm-1', title: '家长信待批' }
    ports.notify.decision(notice)
    ports.notify.toast('已交给战队', 'success')
    ports.notify.toast('无 key，已回退 Mock')

    expect(ports.calls.decisions).toEqual([notice])
    expect(ports.calls.toasts.map((item) => item.text)).toEqual(['已交给战队', '无 key，已回退 Mock'])
    expect(ports.calls.toasts.map((item) => item.kind)).toEqual(['success', undefined])
  })
})

describe('navigate 端口', () => {
  it('open 用内存环境写入 URL 并记录 target；back / canBack 可用', () => {
    const ports = createFakePorts()
    expect(ports.navigate.canBack()).toBe(false)

    ports.navigate.open({ kind: 'mission', id: 'm-1' })
    expect(ports.calls.navigations).toEqual([{ kind: 'mission', id: 'm-1' }])
    expect(ports.navEnv.entries).toEqual([{ type: 'push', url: '/?v2=1&view=mission&id=m-1' }])
    expect(ports.navigate.canBack()).toBe(true)

    ports.navigate.go({ rightTab: 'flow' })
    expect(ports.navEnv.state).toMatchObject({ route: { rightTab: 'flow' } })

    ports.navigate.back()
    expect(ports.navEnv.entries[ports.navEnv.entries.length - 1].type).toBe('back')
  })

  it('overrides 可替换单个端口，未覆盖端口仍为默认假实现', () => {
    const toastTexts: string[] = []
    const ports = createFakePorts({
      notify: {
        decision: () => {},
        toast: (text) => toastTexts.push(text),
      },
    })
    ports.notify.toast('自定义 toast')
    expect(toastTexts).toEqual(['自定义 toast'])
    expect(ports.calls.toasts).toEqual([])
    expect(ports.team.roster()).toHaveLength(6)
  })
})
