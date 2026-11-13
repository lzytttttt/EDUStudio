/**
 * v1.2 M3a · agent-scoped 执行单测（roadmap §4.3）
 *
 * 覆盖：
 * - agentPrompt 纯函数：段落齐全/缺省不出现/固定顺序、handoffs≤5 与 summary 截断、facts≤12、
 *   工具白名单与角色域交集（保持注册顺序）、agentRoleOf 解析；
 * - Orchestrator（vi.mock '../harness/llm/adapter'）：agent 分支 tools schema 只含白名单、
 *   system 含岗位/边界/交接/事实、Plan-JSON 降级 toolMenu 收窄；缺省路径与旧输出一致；
 * - MockOrchestrator（fake ArtifactProvider）：岗位 reflect、越权工具降级为 text、
 *   artifact 标题前缀与 kind 岗位映射、缺省旧行为不变。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/* 编排节奏（jitterDelay）与 LLM 网络全部 mock：测试只关心提示词/工具/事件序列 */
vi.mock('../lib/delay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/delay')>()
  return { ...actual, jitterDelay: async () => {} }
})

const llmState = vi.hoisted(() => ({
  rawCalls: [] as Array<{
    messages: Array<{ role: string; content: string }>
    tools?: Array<{ function: { name: string } }>
  }>,
  chatCalls: [] as Array<{ messages: Array<{ role: string; content: string }> }>,
}))

vi.mock('../harness/llm/adapter', () => {
  class DeepSeekAdapter {
    constructor(_config?: unknown) {}
    async *streamChatRaw(
      messages: Array<{ role: string; content: string }>,
      _signal?: AbortSignal,
      options?: { tools?: Array<{ function: { name: string } }> },
    ) {
      llmState.rawCalls.push({ messages, tools: options?.tools })
      yield { content: '好的' }
    }
    async *streamChat(messages: Array<{ role: string; content: string }>) {
      llmState.chatCalls.push({ messages })
      yield '这不是 JSON'
    }
  }
  return { DeepSeekAdapter }
})

import { Orchestrator } from '../harness/agent/Orchestrator'
import { AGENT_ARTIFACT_KIND, MockOrchestrator, filterAgentSteps } from '../harness/agent/MockOrchestrator'
import {
  MAX_FACTS,
  MAX_HANDOFFS,
  MAX_HANDOFF_SUMMARY_CHARS,
  agentRoleOf,
  buildAgentSystemPrompt,
  filterToolsForAgent,
} from '../harness/agent/agentPrompt'
import { toolRegistry } from '../harness/agent/ToolRegistry'
import { buildSystemPrompt, getRolePreset } from '../harness/roles'
import { useSettingsStore } from '../stores/settingsStore'
import { useSkillStore } from '../stores/skillStore'
import { useMemoryStore } from '../stores/memoryStore'
import type {
  AgentTaskContext,
  AgentTaskInput,
  AgentTraceEvent,
  ArtifactProvider,
  RoleId,
} from '../harness/types'

/** 构造 AgentTaskContext（默认 analyst：teacher 语气域 + 两个白名单工具） */
const makeAgent = (patch: Partial<AgentTaskContext> = {}): AgentTaskContext => ({
  id: 'analyst',
  name: '学情分析',
  baseRole: 'inherit',
  tools: ['queryClassLearning', 'genQuiz'],
  memoryNs: 'agent.analyst',
  skillNs: 'agent.analyst',
  notDo: '不直接联系家长，不改写成绩口径',
  missionId: 'm-1',
  taskId: 't-1',
  handoffs: [
    { from: 'chief', to: 'analyst', taskId: 't-0', summary: '总指挥已确认本次家长会主题与范围。', citations: [] },
  ],
  facts: [
    { factId: 'f1', key: 'physics.avg', value: 82.4, unit: '分', label: '物理均分', source: '学情库 · 高一（3）班' },
    { factId: 'f2', key: 'homework.completion', value: 91, unit: '%', label: '作业完成率', source: '学情库' },
  ],
  ...patch,
})

const agentWithoutOptional = (patch: Partial<AgentTaskContext> = {}): AgentTaskContext => ({
  id: 'assessor',
  baseRole: 'inherit',
  tools: [],
  missionId: 'm-1',
  taskId: 't-9',
  ...patch,
})

/* ---------- Orchestrator 执行辅助 ---------- */

async function runOrchestrator(input: AgentTaskInput): Promise<AgentTraceEvent[]> {
  llmState.rawCalls.length = 0
  llmState.chatCalls.length = 0
  const events: AgentTraceEvent[] = []
  const orchestrator = new Orchestrator({ baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'test-key', model: 'test-model' })
  await orchestrator.runTask(input, (e) => events.push(e))
  return events
}

const lastRawCall = () => llmState.rawCalls[llmState.rawCalls.length - 1]

/** 找到 Plan-JSON 降级那次 streamChat（instruction 含「请仅输出一个 JSON 对象」） */
const findFallbackCall = () =>
  llmState.chatCalls.find((call) => call.messages.some((m) => m.content.includes('请仅输出一个 JSON 对象')))

/* ---------- MockOrchestrator 执行辅助 ---------- */

const MOCK_GOAL = '帮我整理一份研学活动方案，包含行程、安全预案和预算表'
/** 命中教师内置技能 teacher-weakpoint-drill（工具：queryClassLearning → genQuiz） */
const SKILL_GOAL = '帮我针对薄弱点出一组分层练习题'

interface FakeArtifactCalls {
  input: { role: RoleId; goal: string; kindHint?: string }
}

function makeArtifacts() {
  const calls: FakeArtifactCalls[] = []
  const provider: ArtifactProvider = {
    generate: async (input, onChunk) => {
      calls.push({ input })
      onChunk('# 文档正文')
      return { title: '原始文档标题', kind: 'report' }
    },
  }
  return { provider, calls }
}

async function runMock(
  goal: string,
  artifacts: ArtifactProvider,
  agent?: AgentTaskContext,
): Promise<AgentTraceEvent[]> {
  const events: AgentTraceEvent[] = []
  const input: AgentTaskInput = { role: 'teacher', goal, history: [], ...(agent ? { agent } : {}) }
  await new MockOrchestrator(artifacts).runTask(input, (e) => events.push(e))
  return events
}

const toolCallNames = (events: AgentTraceEvent[]): string[] =>
  events.filter((e): e is Extract<AgentTraceEvent, { kind: 'tool_call' }> => e.kind === 'tool_call').map((e) => e.tool)

beforeEach(() => {
  localStorage.removeItem('edustudio:skills')
  localStorage.removeItem('edustudio:memory')
  useSkillStore.setState({ learned: [] })
  useMemoryStore.getState().clear()
  llmState.rawCalls.length = 0
  llmState.chatCalls.length = 0
})

/* ================================================================== */
/* 1. agentPrompt 纯函数                                               */
/* ================================================================== */

describe('agentPrompt（v1.2 M3a）', () => {
  it('缺省可选字段：只追加【岗位】段，不出现空段落', () => {
    const prompt = buildAgentSystemPrompt('BASE_PROMPT', agentWithoutOptional())
    expect(prompt.startsWith('BASE_PROMPT\n\n【岗位】')).toBe(true)
    expect(prompt).toContain('assessor')
    expect(prompt).not.toContain('【边界】')
    expect(prompt).not.toContain('【记忆命名空间】')
    expect(prompt).not.toContain('【上游交接】')
    expect(prompt).not.toContain('【事实快照】')
  })

  it('五个段落齐全且顺序固定：岗位 → 边界 → 记忆命名空间 → 上游交接 → 事实快照', () => {
    const prompt = buildAgentSystemPrompt('BASE', makeAgent())
    const labels = ['【岗位】', '【边界】', '【记忆命名空间】', '【上游交接】', '【事实快照】']
    const indexes = labels.map((label) => prompt.indexOf(label))
    expect(indexes.every((index) => index >= 0)).toBe(true)
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes)
    expect(prompt).toContain('学情分析（analyst）')
    expect(prompt).toContain('不直接联系家长，不改写成绩口径')
    expect(prompt).toContain('agent.analyst')
    expect(prompt).toContain('chief→analyst · t-0 · 总指挥已确认本次家长会主题与范围。')
    expect(prompt).toContain('physics.avg：82.4分（物理均分） · 来源：学情库 · 高一（3）班')
    expect(prompt).toContain('数字只能引用以下值')
  })

  it('name 缺省或空白时岗位段回退 id，不出现重复括号', () => {
    const prompt = buildAgentSystemPrompt('B', agentWithoutOptional({ name: '   ' }))
    expect(prompt).toContain('【岗位】assessor ·')
    expect(prompt).not.toContain('assessor（assessor）')
  })

  it('basePrompt 为空时直接以【岗位】开头（无前导空行）', () => {
    expect(buildAgentSystemPrompt('', agentWithoutOptional()).startsWith('【岗位】')).toBe(true)
  })

  it(`上游交接最多 ${MAX_HANDOFFS} 条，单条 summary 截断到 ${MAX_HANDOFF_SUMMARY_CHARS} 字`, () => {
    const handoffs = Array.from({ length: 7 }, (_, index) => ({
      from: 'chief',
      to: 'analyst',
      taskId: `t-${index}`,
      summary: '摘要'.repeat(100), // 200 字
      citations: [],
    }))
    const prompt = buildAgentSystemPrompt('B', makeAgent({ handoffs, facts: undefined }))
    expect((prompt.match(/^- chief→analyst/gm) ?? []).length).toBe(MAX_HANDOFFS)
    expect(prompt).toContain('摘要'.repeat(MAX_HANDOFF_SUMMARY_CHARS / 2) + '…')
    expect(prompt).not.toContain('摘要'.repeat(MAX_HANDOFF_SUMMARY_CHARS / 2 + 1))
  })

  it(`事实快照最多 ${MAX_FACTS} 条，逐条一行且带单位`, () => {
    const facts = Array.from({ length: 15 }, (_, index) => ({
      key: `metric.${index}`,
      value: index + 1,
      unit: '分',
    }))
    const prompt = buildAgentSystemPrompt('B', makeAgent({ facts, handoffs: undefined }))
    expect((prompt.match(/^- metric\.\d+：/gm) ?? []).length).toBe(MAX_FACTS)
    expect(prompt).toContain('metric.0：1分')
  })

  it('filterToolsForAgent：白名单 ∩ 角色域，保持注册表顺序，越权工具剔除', () => {
    const tools = filterToolsForAgent(
      'teacher',
      makeAgent({ tools: ['genQuiz', 'queryClassLearning', 'querySchoolStats', 'mergeDocuments', 'notExistTool'] }),
    )
    // 注册表顺序：queryClassLearning → genQuiz → mergeDocuments；querySchoolStats 不在教师域
    expect(tools.map((tool) => tool.name)).toEqual(['queryClassLearning', 'genQuiz', 'mergeDocuments'])
  })

  it('filterToolsForAgent：白名单为空 → 空工具集（不放开角色全量）', () => {
    expect(filterToolsForAgent('teacher', makeAgent({ tools: [] }))).toEqual([])
  })

  it('agentRoleOf：缺省回退 fallbackRole，inherit 跟随，显式 baseRole 覆盖', () => {
    expect(agentRoleOf(undefined, 'teacher')).toBe('teacher')
    expect(agentRoleOf(makeAgent({ baseRole: 'inherit' }), 'schoolAdmin')).toBe('schoolAdmin')
    expect(agentRoleOf(makeAgent({ baseRole: 'bureau' }), 'teacher')).toBe('bureau')
  })
})

/* ================================================================== */
/* 2. Orchestrator agent 分支（mock LLM adapter）                      */
/* ================================================================== */

describe('Orchestrator agent-scoped（v1.2 M3a）', () => {
  it('agent：function-calling tools schema 只含白名单（∩ 角色域，保持顺序）', async () => {
    const events = await runOrchestrator({
      role: 'teacher',
      goal: '你好',
      history: [],
      agent: makeAgent({ baseRole: 'teacher', tools: ['genQuiz', 'queryClassLearning', 'queryRegionData'] }),
    })
    expect(events[events.length - 1].kind).toBe('done')

    const raw = lastRawCall()
    expect(raw.tools?.map((tool) => tool.function.name)).toEqual(['queryClassLearning', 'genQuiz'])
    expect(raw.tools?.length).toBe(2)
  })

  it('agent：system prompt 在角色 prompt 后追加岗位/边界/交接/事实段', async () => {
    await runOrchestrator({ role: 'teacher', goal: '你好', history: [], agent: makeAgent() })
    const system = lastRawCall().messages[0].content

    expect(system).toContain('【岗位】学情分析（analyst）')
    expect(system).toContain('【边界】不直接联系家长，不改写成绩口径')
    expect(system).toContain('【上游交接】')
    expect(system).toContain('chief→analyst · t-0')
    expect(system).toContain('【事实快照】')
    expect(system).toContain('physics.avg：82.4分')
    // 角色 prompt 仍是前缀（agent 段落在后）
    expect(system.startsWith(getRolePreset('teacher').systemPrompt)).toBe(true)
  })

  it('agent：baseRole 切换角色域与语气（schoolAdmin 白名单 ∩ 校域）', async () => {
    await runOrchestrator({
      role: 'teacher',
      goal: '你好',
      history: [],
      agent: makeAgent({
        id: 'steward',
        name: '教务管家',
        baseRole: 'schoolAdmin',
        tools: ['querySchoolStats', 'genQuiz', 'queryClassLearning'],
      }),
    })
    const raw = lastRawCall()
    expect(raw.tools?.map((tool) => tool.function.name)).toEqual(['queryClassLearning', 'querySchoolStats'])
    expect(raw.messages[0].content.startsWith(getRolePreset('schoolAdmin').systemPrompt)).toBe(true)
    expect(raw.messages[0].content).toContain('教务管家（steward）')
  })

  it('agent：Plan-JSON 降级 toolMenu 收窄为白名单', async () => {
    await runOrchestrator({
      role: 'teacher',
      goal: '统计一下本周情况',
      history: [],
      agent: makeAgent({ baseRole: 'teacher', tools: ['queryClassLearning'] }),
    })
    const fallback = findFallbackCall()
    expect(fallback).toBeTruthy()
    const instruction = fallback!.messages[fallback!.messages.length - 1].content
    expect(instruction).toContain('- queryClassLearning：')
    expect(instruction).not.toContain('- genQuiz：')
    expect(instruction).not.toContain('- searchPolicy：')
  })

  it('缺省 agent：tools 为角色全量、system 与旧拼装逐字节一致（无岗位段）', async () => {
    await runOrchestrator({ role: 'teacher', goal: '你好', history: [] })
    const raw = lastRawCall()
    expect(raw.tools?.map((tool) => tool.function.name)).toEqual(toolRegistry.listForRole('teacher').map((tool) => tool.name))
    const expectedSystem = buildSystemPrompt(getRolePreset('teacher'), useSettingsStore.getState().preferences)
    expect(raw.messages[0].content).toBe(expectedSystem)
    expect(raw.messages[0].content).not.toContain('【岗位】')
    expect(raw.messages[0].content).not.toContain('【事实快照】')
  })

  it('缺省 agent：Plan-JSON 降级 toolMenu 仍是角色全量（旧行为）', async () => {
    await runOrchestrator({ role: 'teacher', goal: '统计一下本周情况', history: [] })
    const fallback = findFallbackCall()
    const instruction = fallback!.messages[fallback!.messages.length - 1].content
    expect(instruction).toContain('- queryClassLearning：')
    expect(instruction).toContain('- genQuiz：')
    expect(instruction).toContain('- mergeDocuments：')
  })

  it('agent：Plan-JSON 降级 system 也带岗位/边界/交接/事实段（收口补丁）', async () => {
    await runOrchestrator({
      role: 'teacher',
      goal: '统计一下本周情况',
      history: [],
      agent: makeAgent({ baseRole: 'teacher', tools: ['queryClassLearning'] }),
    })
    const fallback = findFallbackCall()
    expect(fallback).toBeTruthy()
    const system = fallback!.messages[0].content
    // 角色 prompt 仍是前缀，agent 五段追加在后
    expect(system.startsWith(getRolePreset('teacher').systemPrompt)).toBe(true)
    expect(system).toContain('【岗位】学情分析（analyst）')
    expect(system).toContain('【边界】不直接联系家长，不改写成绩口径')
    expect(system).toContain('【上游交接】')
    expect(system).toContain('【事实快照】')
  })

  it('缺省 agent：Plan-JSON 降级 system 与旧实现逐字节一致（收口补丁）', async () => {
    await runOrchestrator({ role: 'teacher', goal: '统计一下本周情况', history: [] })
    const fallback = findFallbackCall()
    const expected = buildSystemPrompt(getRolePreset('teacher'), useSettingsStore.getState().preferences)
    expect(fallback!.messages[0].content).toBe(expected)
    expect(fallback!.messages[0].content).not.toContain('【岗位】')
  })
})

/* ================================================================== */
/* 3. MockOrchestrator agent 分支（fake ArtifactProvider）             */
/* ================================================================== */

describe('MockOrchestrator agent-scoped（v1.2 M3a）', () => {
  it('agent：岗位 reflect 开场、越权工具降级、artifact 标题前缀与 kind 映射', async () => {
    const { provider, calls } = makeArtifacts()
    const events = await runMock(
      MOCK_GOAL,
      provider,
      makeAgent({ baseRole: 'teacher', tools: ['queryClassLearning'] }),
    )

    // 开场先亮明岗位（含 name/id）
    expect(events[0]).toEqual({ kind: 'reflect', text: '学情分析 · 岗位执行（analyst）' })

    // 通用探索两个工具中，searchResources 不在白名单 → 降级 text；queryClassLearning 正常执行
    expect(toolCallNames(events)).toEqual(['queryClassLearning'])
    const downgraded = events.find(
      (e): e is Extract<AgentTraceEvent, { kind: 'text' }> =>
        e.kind === 'text' && e.text.includes('searchResources'),
    )
    expect(downgraded?.text).toContain('岗位边界')

    // artifact 标题加岗位前缀；kind 按 analyst → analysis
    const meta = events.find((e) => e.kind === 'artifact_meta')
    expect(meta?.kind === 'artifact_meta' && meta.title).toBe(`学情分析 · ${MOCK_GOAL}`)
    expect(meta?.kind === 'artifact_meta' && meta.docKind).toBe('analysis')
    const done = events.find((e) => e.kind === 'artifact_done')
    expect(done?.kind === 'artifact_done' && done.title).toBe('学情分析 · 原始文档标题')
    expect(done?.kind === 'artifact_done' && done.docKind).toBe('analysis')

    // 文档生成使用 baseRole 语气域
    expect(calls).toHaveLength(1)
    expect(calls[0].input.role).toBe('teacher')
  })

  it('agent：岗位 kind 映射全表（analyst/curriculum/assessor/communicator/chief/steward）', async () => {
    const cases: Array<[string, string]> = [
      ['analyst', 'analysis'],
      ['curriculum', 'lessonPlan'],
      ['assessor', 'generic'],
      ['communicator', 'notice'],
      ['chief', 'generic'],
      ['steward', 'generic'],
    ]
    for (const [id, kind] of cases) {
      useSkillStore.setState({ learned: [] })
      const { provider } = makeArtifacts()
      const events = await runMock(
        MOCK_GOAL,
        provider,
        makeAgent({ id, name: id, baseRole: 'teacher', tools: ['queryClassLearning'] }),
      )
      const done = events.find((e) => e.kind === 'artifact_done')
      expect(done?.kind === 'artifact_done' && done.docKind).toBe(kind)
      expect(AGENT_ARTIFACT_KIND[id]).toBe(kind)
    }
  })

  it('agent：baseRole 切换执行脚本域（schoolAdmin 通用工具）并降级越权工具', async () => {
    const { provider } = makeArtifacts()
    const events = await runMock(
      // 避免命中 schoolAdmin 内置剧本触发词（方案/通知/简报…），确保走通用探索分支
      '帮我整理一份研学活动清单，包含行程与预算',
      provider,
      makeAgent({
        id: 'steward',
        name: '教务管家',
        baseRole: 'schoolAdmin',
        tools: ['querySchoolStats'],
      }),
    )
    // schoolAdmin 通用工具 = querySchoolStats + searchPolicy；白名单只留前者
    expect(toolCallNames(events)).toEqual(['querySchoolStats'])
    expect(
      events.some(
        (e) => e.kind === 'text' && e.text.includes('searchPolicy') && e.text.includes('岗位边界'),
      ),
    ).toBe(true)
  })

  it('缺省 agent：无岗位 reflect、工具全执行、artifact 标题与 kind 保持旧行为', async () => {
    const { provider, calls } = makeArtifacts()
    const events = await runMock(MOCK_GOAL, provider)

    expect(events.some((e) => e.kind === 'reflect' && e.text.includes('岗位执行'))).toBe(false)
    // 教师通用探索两个工具都执行（旧行为）
    expect(toolCallNames(events)).toEqual(['searchResources', 'queryClassLearning'])
    const done = events.find((e) => e.kind === 'artifact_done')
    expect(done?.kind === 'artifact_done' && done.title).toBe('原始文档标题')
    expect(done?.kind === 'artifact_done' && done.docKind).toBe('report') // 不做岗位映射
    expect(events.some((e) => e.kind === 'text' && e.text.includes('岗位边界'))).toBe(false)
    expect(calls[0].input.role).toBe('teacher')
  })

  it('agent：技能命中分支同样做工具隔离——越权 tool 步骤降级、合法工具保留（收口补丁）', async () => {
    const { provider } = makeArtifacts()
    const events = await runMock(
      SKILL_GOAL,
      provider,
      makeAgent({ baseRole: 'teacher', tools: ['queryClassLearning'] }),
    )

    // 仍走技能命中分支（技能步骤顺序不变），但 genQuiz 不在白名单 → 不执行、降级 text
    expect(events.some((e) => e.kind === 'skill_hit')).toBe(true)
    expect(toolCallNames(events)).toEqual(['queryClassLearning'])
    expect(
      events.some(
        (e) => e.kind === 'text' && e.text.includes('genQuiz') && e.text.includes('岗位边界'),
      ),
    ).toBe(true)
    // 技能自带的 artifact 步骤仍正常产出
    expect(events.some((e) => e.kind === 'artifact_done')).toBe(true)
  })

  it('agent：技能步骤工具全在白名单时原样执行（顺序不变）', async () => {
    const { provider } = makeArtifacts()
    const events = await runMock(
      SKILL_GOAL,
      provider,
      makeAgent({ baseRole: 'teacher', tools: ['genQuiz', 'queryClassLearning'] }),
    )
    expect(events.some((e) => e.kind === 'skill_hit')).toBe(true)
    expect(toolCallNames(events)).toEqual(['queryClassLearning', 'genQuiz'])
    expect(events.some((e) => e.kind === 'text' && e.text.includes('岗位边界'))).toBe(false)
  })

  it('缺省 agent：技能命中分支不做工具过滤（旧行为字节级不变）', async () => {
    const { provider } = makeArtifacts()
    const events = await runMock(SKILL_GOAL, provider)

    expect(events[0].kind).toBe('skill_hit') // 无岗位 reflect、无记忆注入（beforeEach 已清）
    expect(toolCallNames(events)).toEqual(['queryClassLearning', 'genQuiz'])
    expect(events.some((e) => e.kind === 'text' && e.text.includes('岗位边界'))).toBe(false)
  })

  it('filterAgentSteps：tool/parallel 越权步骤降级为 text，其余步骤原样，且不改入参', () => {
    const steps = [
      { type: 'tool' as const, tool: 'allowedTool', args: {} },
      {
        type: 'parallel' as const,
        label: '并行组',
        steps: [
          { tool: 'allowedTool', args: {} },
          { tool: 'forbiddenTool', args: {} },
        ],
      },
      { type: 'reflect' as const, text: '观察' },
    ]
    const snapshot = JSON.parse(JSON.stringify(steps)) as typeof steps
    const filtered = filterAgentSteps(steps, makeAgent({ tools: ['allowedTool'] }))

    expect(filtered.map((step) => step.type)).toEqual(['tool', 'parallel', 'text', 'reflect'])
    expect(filtered[1].type === 'parallel' && filtered[1].steps.map((s) => s.tool)).toEqual(['allowedTool'])
    expect(filtered[2].type === 'text' && filtered[2].text).toContain('forbiddenTool')
    expect(steps).toEqual(snapshot) // 纯函数不改入参
  })
})
