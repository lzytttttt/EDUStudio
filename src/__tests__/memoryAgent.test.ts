/**
 * v1.2 M2 · Agent 记忆命名空间单测（roadmap §2.3 F5 / §2.4 / §3.5）
 *
 * 覆盖：`agent.<id>.<key>` 命名空间前缀、agent 情景/语义过滤与排序、置信度合并、
 * 旧 API 行为不变（字节级）、persist 结构不变（条目多 agentId 字段）、「已学会」聚合。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { MemoryEntry } from '../harness/types'
import {
  EPISODIC_LIMIT,
  agentSemanticKey,
  mergeSemantic,
  selectEpisodicAgent,
  selectEpisodicRole,
  selectSemanticAgent,
  selectSemanticRole,
  stripAgentSemanticKey,
  summarizeAgentLearning,
  useMemoryStore,
} from '../stores/memoryStore'

// 固定本地日期，避免时区差异：2026-11-13 10:00
const T0 = new Date(2026, 10, 13, 10, 0, 0).getTime()

function epi(partial: Partial<MemoryEntry> = {}): MemoryEntry {
  return { t: T0, role: 'teacher', kind: 'episodic', goal: '测试目标', outcome: 'executed', ...partial }
}

function sem(key: string, value: unknown, confidence = 0.6, extra: Partial<MemoryEntry> = {}): MemoryEntry {
  return { t: T0, role: 'teacher', kind: 'semantic', key, value, confidence, ...extra }
}

beforeEach(() => {
  localStorage.clear()
  useMemoryStore.setState({ episodic: [], semantic: {} })
})

describe('agentSemanticKey（命名空间前缀）', () => {
  it('拼成 agent.<id>.<key>，不出现角色前缀', () => {
    expect(agentSemanticKey('chief', 'pref.tone')).toBe('agent.chief.pref.tone')
    expect(agentSemanticKey('communicator', 'avoid.last')).toBe('agent.communicator.avoid.last')
  })

  it('stripAgentSemanticKey 剥离任意 agent 命名空间；非命名空间键原样返回', () => {
    expect(stripAgentSemanticKey('agent.analyst.pref.quiz.count')).toBe('pref.quiz.count')
    expect(stripAgentSemanticKey('teacher.pref.quiz.count')).toBe('teacher.pref.quiz.count')
    expect(stripAgentSemanticKey('agent.chief.')).toBe('agent.chief.')
  })
})

describe('selectEpisodicAgent（agent 过滤 + 时间倒序）', () => {
  it('只取指定 agentId 的情景记忆，不与其他 agent / 无 agent 条目混淆', () => {
    const entries = [
      epi({ t: T0, agentId: 'chief', goal: '总指挥一' }),
      epi({ t: T0 + 1, agentId: 'analyst', goal: '分析一' }),
      epi({ t: T0 + 2, goal: '用户层' }),
      epi({ t: T0 + 3, agentId: 'chief', goal: '总指挥二' }),
    ]
    expect(selectEpisodicAgent(entries, 'chief').map((e) => e.goal)).toEqual(['总指挥二', '总指挥一'])
    expect(selectEpisodicAgent(entries, 'analyst').map((e) => e.goal)).toEqual(['分析一'])
  })

  it('默认取 3 条、可注入 limit；limit=0 → 空数组', () => {
    const entries = Array.from({ length: 6 }, (_, i) => epi({ t: T0 + i, agentId: 'assessor', goal: `任务${i}` }))
    expect(selectEpisodicAgent(entries, 'assessor')).toHaveLength(3)
    expect(selectEpisodicAgent(entries, 'assessor', 2).map((e) => e.goal)).toEqual(['任务5', '任务4'])
    expect(selectEpisodicAgent(entries, 'assessor', 0)).toEqual([])
  })
})

describe('selectSemanticAgent（前缀过滤 + 置信度降序 + 剥离前缀）', () => {
  it('只取 agent.<id>. 前缀，排除其他 agent 与角色层键；按置信度降序', () => {
    const map = {
      'agent.chief.pref.quiz.count': sem('agent.chief.pref.quiz.count', 20, 0.6, { agentId: 'chief' }),
      'agent.chief.avoid.last': sem('agent.chief.avoid.last', '太啰嗦', 0.9, { agentId: 'chief' }),
      'agent.analyst.pref.quiz.count': sem('agent.analyst.pref.quiz.count', 30, 0.95, { agentId: 'analyst' }),
      'teacher.pref.export.format': sem('teacher.pref.export.format', 'docx', 0.8),
    }
    const chief = selectSemanticAgent(map, 'chief')
    /* 展示口径：key 剥离命名空间前缀 */
    expect(chief.map((e) => e.key)).toEqual(['avoid.last', 'pref.quiz.count'])
    expect(chief.map((e) => e.confidence)).toEqual([0.9, 0.6])
    expect(selectSemanticAgent(map, 'analyst').map((e) => e.key)).toEqual(['pref.quiz.count'])
  })

  it('无匹配 → 空数组；前缀按「整段 id」匹配（chief 不吃 chief2 的键）', () => {
    const map = {
      'agent.chief2.pref.x': sem('agent.chief2.pref.x', 1, 0.9, { agentId: 'chief2' }),
    }
    expect(selectSemanticAgent(map, 'chief')).toEqual([])
    expect(selectSemanticAgent(map, 'nobody')).toEqual([])
  })
})

describe('store：upsertAgentSemantic（自动命名空间 + 同 key 合并）', () => {
  it('key 自动加 agent.<id>. 前缀；同 key 同类值走旧 mergeSemantic 加权', () => {
    const store = useMemoryStore.getState()
    const { upsertAgentSemantic } = store
    upsertAgentSemantic(sem('pref.quiz.count', 20, 0.5, { agentId: 'chief' }))
    const key = 'agent.chief.pref.quiz.count'
    expect(useMemoryStore.getState().semantic[key]).toBeDefined()
    expect(useMemoryStore.getState().semantic[key].agentId).toBe('chief')

    upsertAgentSemantic(sem('pref.quiz.count', 20, 0.9, { agentId: 'chief' }))
    expect(useMemoryStore.getState().semantic[key].confidence).toBeCloseTo(0.55)
  })

  it('已带命名空间的 key 幂等（不出现 agent.x.agent.x.*）', () => {
    useMemoryStore.getState().upsertAgentSemantic(sem('agent.chief.pref.tone', '共情先行', 0.7, { agentId: 'chief' }))
    const keys = Object.keys(useMemoryStore.getState().semantic)
    expect(keys).toEqual(['agent.chief.pref.tone'])
  })

  it('不同 agent 的同名 key 互相隔离；缺 agentId / 缺 key 的条目被忽略', () => {
    const { upsertAgentSemantic } = useMemoryStore.getState()
    upsertAgentSemantic(sem('pref.tone', '共情', 0.6, { agentId: 'chief' }))
    upsertAgentSemantic(sem('pref.tone', '事实先行', 0.6, { agentId: 'communicator' }))
    expect(Object.keys(useMemoryStore.getState().semantic)).toEqual([
      'agent.chief.pref.tone',
      'agent.communicator.pref.tone',
    ])
    upsertAgentSemantic(sem('pref.tone', '用户层', 0.6))
    upsertAgentSemantic(sem('', '无 key', 0.6, { agentId: 'chief' }))
    expect(Object.keys(useMemoryStore.getState().semantic)).toHaveLength(2)
  })
})

describe('store：recordAgentEpisodic（要求 agentId + 环形裁剪）', () => {
  it('缺 agentId 的情景条目不写入（不抛错）', () => {
    useMemoryStore.getState().recordAgentEpisodic(epi({ goal: '无归属' }))
    expect(useMemoryStore.getState().episodic).toEqual([])
  })

  it('带 agentId 写入；可配置 limit 环形淘汰最旧，字段（agentId）不丢', () => {
    for (let i = 0; i < 8; i++) {
      useMemoryStore.getState().recordAgentEpisodic(epi({ t: T0 + i, agentId: 'curriculum', goal: `课${i}` }), 3)
    }
    const episodic = useMemoryStore.getState().episodic
    expect(episodic).toHaveLength(3)
    expect(episodic[0].goal).toBe('课5')
    expect(episodic.every((e) => e.agentId === 'curriculum')).toBe(true)
    expect(selectEpisodicAgent(episodic, 'curriculum', 3).map((e) => e.goal)).toEqual(['课7', '课6', '课5'])
    expect(selectEpisodicAgent(episodic, 'curriculum', EPISODIC_LIMIT + 10)).toHaveLength(3)
  })
})

describe('旧 API 行为不变（字节级）', () => {
  it('旧情景记录 / 角色选择器保持不变；agent 条目不会混进角色层（角色过滤仍只看 role）', () => {
    const { recordEpisodic, recordAgentEpisodic } = useMemoryStore.getState()
    recordEpisodic(epi({ t: T0, goal: '旧用户任务' }))
    /* Director 成员的基础角色可不同（如校情 Agent）：角色选择器行为不变，只按 role 过滤 */
    recordAgentEpisodic(epi({ t: T0 + 1, role: 'bureau', agentId: 'steward', goal: '班务任务' }))
    const { episodic } = useMemoryStore.getState()
    expect(episodic).toHaveLength(2)
    expect(selectEpisodicRole(episodic, 'teacher').map((e) => e.goal)).toEqual(['旧用户任务'])
    expect(selectEpisodicRole(episodic, 'bureau').map((e) => e.goal)).toEqual(['班务任务'])
    expect(selectEpisodicAgent(episodic, 'steward').map((e) => e.goal)).toEqual(['班务任务'])
  })

  it('旧语义 upsert / 选择器保持不变；agent 命名空间键不污染 ${role}. 前缀', () => {
    const { upsertSemantic, upsertAgentSemantic } = useMemoryStore.getState()
    upsertSemantic(sem('teacher.pref.export.format', 'docx', 0.8))
    upsertAgentSemantic(sem('pref.export.format', 'pdf', 0.9, { agentId: 'chief' }))
    const { semantic } = useMemoryStore.getState()
    expect(selectSemanticRole(semantic, 'teacher').map((e) => e.key)).toEqual(['teacher.pref.export.format'])
    expect(selectSemanticAgent(semantic, 'chief')).toHaveLength(1)
    /* 旧合并规则也未被改写：同 value 重复印证 +0.05 */
    upsertSemantic(sem('teacher.pref.export.format', 'docx', 0.9))
    expect(useMemoryStore.getState().semantic['teacher.pref.export.format'].confidence).toBeCloseTo(0.85)
  })

  it('mergeSemantic 仍为纯函数（异 value 高置信胜出 / 相等取新）', () => {
    const old = sem('teacher.pref.quiz.count', 30, 0.9)
    expect(mergeSemantic(old, sem('teacher.pref.quiz.count', 20, 0.95)).value).toBe(20)
    expect(mergeSemantic(old, sem('teacher.pref.quiz.count', 10, 0.5)).value).toBe(30)
    expect(mergeSemantic(old, sem('teacher.pref.quiz.count', 15, 0.9)).value).toBe(15)
  })
})

describe('persist 结构（单键 edustudio:memory，条目多 agentId 字段）', () => {
  it('写盘仍是 { episodic, semantic } 两字段；agentId / 命名空间键随条目保存', () => {
    const { recordAgentEpisodic, upsertAgentSemantic } = useMemoryStore.getState()
    recordAgentEpisodic(epi({ agentId: 'chief', goal: '家长信先共情' }))
    upsertAgentSemantic(sem('pref.tone', '共情先行', 0.8, { agentId: 'communicator' }))

    const raw = localStorage.getItem('edustudio:memory')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!) as { episodic: MemoryEntry[]; semantic: Record<string, MemoryEntry> }
    expect(Object.keys(parsed).sort()).toEqual(['episodic', 'semantic'])
    expect(parsed.episodic).toHaveLength(1)
    expect(parsed.episodic[0].agentId).toBe('chief')
    expect(parsed.semantic['agent.communicator.pref.tone'].agentId).toBe('communicator')
  })

  it('模块级 loadJSON 往返：用同一结构重新解析后选择器结果一致', async () => {
    const { recordAgentEpisodic, upsertAgentSemantic } = useMemoryStore.getState()
    recordAgentEpisodic(epi({ agentId: 'assessor', goal: '评分口径偏严' }))
    upsertAgentSemantic(sem('pref.strict', true, 0.7, { agentId: 'assessor' }))
    const parsed = JSON.parse(localStorage.getItem('edustudio:memory')!) as {
      episodic: MemoryEntry[]
      semantic: Record<string, MemoryEntry>
    }
    expect(selectEpisodicAgent(parsed.episodic, 'assessor')).toHaveLength(1)
    const semanticItems = selectSemanticAgent(parsed.semantic, 'assessor')
    expect(semanticItems.map((e) => e.key)).toEqual(['pref.strict'])
    expect(semanticItems[0].value).toBe(true)
  })
})

describe('summarizeAgentLearning（战队页「已学会」只读聚合）', () => {
  it('无数据 → 0 位成员 / recent=null', () => {
    expect(summarizeAgentLearning({}, [])).toEqual({ agents: 0, recent: null })
  })

  it('成员数 = 语义命名空间 ∪ 情景 agentId 去重；最近一条按时间取', () => {
    const semantic = {
      'agent.chief.pref.tone': sem('agent.chief.pref.tone', '共情', 0.6, { t: T0 + 5, agentId: 'chief' }),
      'agent.analyst.pref.quiz.count': sem('agent.analyst.pref.quiz.count', 20, 0.7, { t: T0 + 2, agentId: 'analyst' }),
      'teacher.pref.export.format': sem('teacher.pref.export.format', 'docx', 0.8),
    }
    const episodic = [epi({ t: T0 + 9, agentId: 'chief', goal: '家长信草稿' })]
    const summary = summarizeAgentLearning(semantic, episodic)
    expect(summary.agents).toBe(2)
    /* 最近一条是情景记忆（t=T0+9）→ 回退其 goal */
    expect(summary.recent).toBe('家长信草稿')
  })

  it('最近一条是语义时剥离命名空间前缀；无 agent 数据时 recent=null', () => {
    const semantic = {
      'agent.curriculum.pref.lessonPlan.minutes': sem('agent.curriculum.pref.lessonPlan.minutes', 40, 0.9, {
        t: T0 + 1,
        agentId: 'curriculum',
      }),
    }
    expect(summarizeAgentLearning(semantic, []).recent).toBe('pref.lessonPlan.minutes')
    expect(summarizeAgentLearning({ 'teacher.pref.x': sem('teacher.pref.x', 1, 0.5) }, [epi()])).toEqual({
      agents: 0,
      recent: null,
    })
  })
})
