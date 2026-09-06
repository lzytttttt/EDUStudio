import { beforeEach, describe, expect, it } from 'vitest'
import { MockMemoryProvider } from '../harness/memory/MockMemoryProvider'
import { formatEpisodicLines, formatMemoryBlock, formatSemanticLines } from '../harness/memory/format'
import {
  EPISODIC_LIMIT,
  extractPrefs,
  mergeSemantic,
  selectEpisodicRole,
  selectSemanticRole,
  useMemoryStore,
} from '../stores/memoryStore'
import { BACKUP_KEY_WHITELIST } from '../lib/backup'
import type { MemoryEntry, RoleId } from '../harness/types'

/* 记忆分层 v0.9.1：L2 环形裁剪 / L3 语义合并 / 偏好提炼规则 / 注入文本组装 / 角色隔离 */

// 固定本地日期，避免时区差异：2026-09-06 10:00
const T0 = new Date(2026, 8, 6, 10, 0, 0).getTime()

function epi(partial: Partial<MemoryEntry> = {}): MemoryEntry {
  return { t: T0, role: 'teacher', kind: 'episodic', goal: '测试目标', outcome: 'executed', ...partial }
}

function sem(key: string, value: unknown, confidence = 0.6, role: RoleId = 'teacher'): MemoryEntry {
  return { t: T0, role, kind: 'semantic', key, value, confidence }
}

beforeEach(() => {
  useMemoryStore.setState({ episodic: [], semantic: {} })
})

describe('L2 情景记忆环形裁剪', () => {
  it('写入超过上限 → 保留最新 limit 条，淘汰最旧', () => {
    const store = useMemoryStore.getState()
    for (let i = 0; i < EPISODIC_LIMIT + 5; i++) {
      store.recordEpisodic(epi({ t: T0 + i }), EPISODIC_LIMIT)
    }
    const { episodic } = useMemoryStore.getState()
    expect(episodic.length).toBe(EPISODIC_LIMIT)
    expect(episodic[0].t).toBe(T0 + 5) // 最旧 5 条被淘汰
    expect(episodic[EPISODIC_LIMIT - 1].t).toBe(T0 + EPISODIC_LIMIT + 4)
  })

  it('可配置 limit（测试注入）', () => {
    for (let i = 0; i < 8; i++) useMemoryStore.getState().recordEpisodic(epi({ t: T0 + i }), 3)
    expect(useMemoryStore.getState().episodic.length).toBe(3)
  })
})

describe('L3 语义合并策略', () => {
  it('同 value 重复印证 → 置信度加权 +0.05，封顶 0.99', () => {
    const first = mergeSemantic(undefined, sem('teacher.pref.quiz.count', 30, 0.5))
    expect(first.confidence).toBe(0.5)
    const second = mergeSemantic(first, sem('teacher.pref.quiz.count', 30, 0.9))
    expect(second.confidence).toBeCloseTo(0.55)
    let cur = second
    for (let i = 0; i < 30; i++) cur = mergeSemantic(cur, sem('teacher.pref.quiz.count', 30, 0.99))
    expect(cur.confidence).toBe(0.99)
  })

  it('异 value：高置信度胜出，相等取新，败方（旧值）置信度衰减 ×0.5', () => {
    const old = sem('teacher.pref.quiz.count', 30, 0.9)
    const stronger = mergeSemantic(old, sem('teacher.pref.quiz.count', 20, 0.95))
    expect(stronger.value).toBe(20)
    const weaker = mergeSemantic(old, sem('teacher.pref.quiz.count', 10, 0.5))
    expect(weaker.value).toBe(30)
    expect(weaker.confidence).toBeCloseTo(0.45)
    const equal = mergeSemantic(old, sem('teacher.pref.quiz.count', 15, 0.9))
    expect(equal.value).toBe(15)
  })

  it('store upsertSemantic：同 key 合并、无 key 忽略', () => {
    const store = useMemoryStore.getState()
    store.upsertSemantic(sem('teacher.pref.export.format', 'docx', 0.5))
    store.upsertSemantic(sem('teacher.pref.export.format', 'docx', 0.9))
    expect(useMemoryStore.getState().semantic['teacher.pref.export.format'].confidence).toBeCloseTo(0.55)
    store.upsertSemantic(sem('teacher.pref.bad', 'x'))
    expect(useMemoryStore.getState().semantic['teacher.pref.bad']).toBeDefined()
    // 无 key 的语义条目被忽略（不入 map）
    const before = Object.keys(useMemoryStore.getState().semantic).length
    store.upsertSemantic({ t: T0, role: 'teacher', kind: 'semantic', value: 'no-key' })
    expect(Object.keys(useMemoryStore.getState().semantic).length).toBe(before)
  })
})

describe('偏好提炼规则（规则版）', () => {
  it('accept + 目标含「N 题」→ quiz.count', () => {
    const out = extractPrefs(epi({ goal: '为五年级出 30 道题（分数乘法）', outcome: 'accepted' }))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ role: 'teacher', kind: 'semantic', key: 'teacher.pref.quiz.count', value: 30, confidence: 0.8 })
  })

  it('accept + 目标含「N 分钟」+ 教案 → lessonPlan.minutes', () => {
    const out = extractPrefs(epi({ goal: '写一份 40 分钟的教案', outcome: 'edited' }))
    expect(out).toHaveLength(1)
    expect(out[0].key).toBe('teacher.pref.lessonPlan.minutes')
    expect(out[0].value).toBe(40)
  })

  it('accept + 目标含 Word/docx → export.format=docx', () => {
    const out = extractPrefs(epi({ goal: '生成可导出 Word 的教学总结', outcome: 'accepted' }))
    expect(out.some((p) => p.key === 'teacher.pref.export.format' && p.value === 'docx')).toBe(true)
  })

  it('rejected → avoid.last 负例（目标摘要截断 24 字）', () => {
    const goal = '这个不要名词解释，太啰嗦了，重新来一遍'
    const out = extractPrefs(epi({ goal, outcome: 'rejected', ref: 'artifact:doc-1' }))
    expect(out).toHaveLength(1)
    expect(out[0].key).toBe('teacher.avoid.last')
    expect(out[0].value).toBe(goal.slice(0, 24))
    expect(out[0].confidence).toBe(0.6)
  })

  it('executed → 仅情景记忆不提炼；非 episodic → 空数组', () => {
    expect(extractPrefs(epi({ goal: '出 30 道题', outcome: 'executed' }))).toEqual([])
    expect(extractPrefs(sem('teacher.pref.quiz.count', 30))).toEqual([])
    expect(extractPrefs(epi({ goal: '', outcome: 'accepted' }))).toEqual([])
  })
})

describe('角色隔离选择器', () => {
  it('情景与语义均按 role 过滤，互不污染', () => {
    const entries = [
      epi({ role: 'teacher', t: T0 }),
      epi({ role: 'bureau', t: T0 + 1 }),
    ]
    expect(selectEpisodicRole(entries, 'teacher').map((e) => e.role)).toEqual(['teacher'])
    expect(selectEpisodicRole(entries, 'bureau').map((e) => e.role)).toEqual(['bureau'])

    const map = {
      'teacher.pref.quiz.count': sem('teacher.pref.quiz.count', 30, 0.8),
      'bureau.pref.export.format': sem('bureau.pref.export.format', 'docx', 0.9, 'bureau'),
    }
    expect(selectSemanticRole(map, 'teacher').map((e) => e.key)).toEqual(['teacher.pref.quiz.count'])
    expect(selectSemanticRole(map, 'bureau').map((e) => e.key)).toEqual(['bureau.pref.export.format'])
  })

  it('情景按时间倒序取前 limit 条；语义按置信度降序', () => {
    const entries = [epi({ t: T0 }), epi({ t: T0 + 2 }), epi({ t: T0 + 1 })]
    expect(selectEpisodicRole(entries, 'teacher', 2).map((e) => e.t)).toEqual([T0 + 2, T0 + 1])
    const map = {
      a: sem('teacher.a', 1, 0.5),
      b: sem('teacher.b', 2, 0.9),
      c: sem('teacher.c', 3, 0.7),
    }
    expect(selectSemanticRole(map, 'teacher').map((e) => e.key)).toEqual(['teacher.b', 'teacher.c', 'teacher.a'])
  })
})

describe('注入文本组装（format）', () => {
  it('空输入 → 空串（无记忆时 systemPrompt 保持现状）', () => {
    expect(formatMemoryBlock([], [])).toBe('')
  })

  it('情景与偏好分别成段，含【场景记忆】【用户偏好】', () => {
    const block = formatMemoryBlock(
      [epi({ t: T0, goal: '五年级分数乘法出题', outcome: 'accepted' })],
      [sem('teacher.pref.quiz.count', 30, 0.8)],
    )
    expect(block).toContain('【场景记忆】')
    expect(block).toContain('9月6日：五年级分数乘法出题（已采纳）')
    expect(block).toContain('【用户偏好】')
    expect(block).toContain('出题默认 30 题')
  })

  it('情景 ≤3 条、偏好 ≤6 条、超长条目截断', () => {
    const eps = Array.from({ length: 5 }, (_, i) => epi({ t: T0 + i, goal: `任务${i}` }))
    const lines = formatEpisodicLines(eps)
    expect(lines).toHaveLength(3)

    const long = '长'.repeat(80)
    // 日期前缀(5) + 截断正文(60) + 省略号(1) + 结果标注(5) = 71 字
    expect(formatEpisodicLines([epi({ goal: long })])[0]).toBe(`9月6日：${'长'.repeat(60)}…（已完成）`)

    const sems = Array.from({ length: 8 }, (_, i) => sem(`teacher.pref.k${i}`, i, 0.5 + i / 100))
    expect(formatSemanticLines(sems)).toHaveLength(6)
  })

  it('语义 key 映射友好文案：标签偏好 / 导出格式 / 负例', () => {
    const lines = formatSemanticLines([
      sem('teacher.pref.card.tag.作业', true, 0.6),
      sem('teacher.pref.export.format', 'docx', 0.8),
      sem('teacher.avoid.last', '不要名词解释', 0.6),
      sem('teacher.pref.lessonPlan.minutes', 40, 0.8),
    ])
    expect(lines).toContain('关注「作业」类卡片')
    expect(lines).toContain('导出优先使用 Word')
    expect(lines).toContain('上次「不要名词解释」未达预期，避免同风格')
    expect(lines).toContain('教案课时偏好 40 分钟')
  })

  it('偏好按置信度降序展示', () => {
    const lines = formatSemanticLines([
      sem('teacher.pref.quiz.count', 10, 0.6),
      sem('teacher.pref.export.format', 'docx', 0.9),
    ])
    expect(lines[0]).toContain('Word')
  })
})

describe('MockMemoryProvider 契约', () => {
  it('record 情景（accepted）→ recentEpisodic 可见 + extractPrefs 自动提炼 L3', async () => {
    const provider = new MockMemoryProvider()
    await provider.record(epi({ goal: '为五年级出 30 道题', outcome: 'accepted', ref: 'artifact:doc-1' }))
    const recent = await provider.recentEpisodic('teacher', 3)
    expect(recent).toHaveLength(1)
    expect(recent[0].outcome).toBe('accepted')
    const prefs = await provider.semanticFor('teacher')
    expect(prefs.map((p) => p.key)).toContain('teacher.pref.quiz.count')
    expect(prefs.every((p) => p.role === 'teacher')).toBe(true)
  })

  it('record 语义偏好 → semanticFor 合并返回；extractPrefs 契约透传', async () => {
    const provider = new MockMemoryProvider()
    await provider.record(sem('teacher.pref.export.format', 'docx', 0.5))
    await provider.record(sem('teacher.pref.export.format', 'docx', 0.9))
    const prefs = await provider.semanticFor('teacher')
    expect(prefs).toHaveLength(1)
    expect(prefs[0].confidence).toBeCloseTo(0.55)
    const derived = await provider.extractPrefs(epi({ goal: '出 20 道题', outcome: 'accepted' }))
    expect(derived[0].key).toBe('teacher.pref.quiz.count')
  })

  it('无记忆角色 → 空数组（注入侧据此跳过拼接）', async () => {
    const provider = new MockMemoryProvider()
    await provider.record(epi({ role: 'teacher', goal: '教师任务', outcome: 'executed' }))
    expect(await provider.recentEpisodic('bureau')).toEqual([])
    expect(await provider.semanticFor('bureau')).toEqual([])
  })

  it('provider 可配置情景上限', async () => {
    const provider = new MockMemoryProvider({ episodicLimit: 4 })
    for (let i = 0; i < 10; i++) await provider.record(epi({ t: T0 + i }))
    expect(useMemoryStore.getState().episodic).toHaveLength(4)
  })
})

describe('备份白名单', () => {
  it('memory 单键纳入 v0.9 备份/恢复范围', () => {
    expect(BACKUP_KEY_WHITELIST).toContain('memory')
  })
})
