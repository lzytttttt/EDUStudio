import { describe, it, expect, beforeEach, vi } from 'vitest'

/* 编排节奏（jitterDelay）与事件顺序无关：mock 为立即返回，测试只关心序列 */
vi.mock('../lib/delay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/delay')>()
  return { ...actual, jitterDelay: async () => {} }
})

import { MockOrchestrator } from '../harness/agent/MockOrchestrator'
import { GENERIC_DONE_TEXT } from '../harness/scripts/agent'
import { getMemoryProvider } from '../harness/memory'
import { useSkillStore } from '../stores/skillStore'
import { useMemoryStore } from '../stores/memoryStore'
import type { AgentTraceEvent, ArtifactProvider, RoleId } from '../harness/types'

const ROLE: RoleId = 'teacher'
const GOAL_ACT1 = '帮我整理一份研学活动方案，包含行程、安全预案和预算表'
const GOAL_ACT2 = '再做一份研学活动方案，下个月出发'

const artifacts: ArtifactProvider = {
  generate: async (_input, onChunk) => {
    onChunk('# 研学活动方案\n\n行程：第一天集合出发…')
    return { title: '研学活动方案', kind: 'generic' }
  },
}

async function run(goal: string): Promise<AgentTraceEvent[]> {
  const events: AgentTraceEvent[] = []
  await new MockOrchestrator(artifacts).runTask({ role: ROLE, goal, history: [] }, (e) => events.push(e))
  return events
}

beforeEach(() => {
  localStorage.removeItem('edustudio:skills')
  localStorage.removeItem('edustudio:memory')
  useSkillStore.setState({ learned: [] })
  useMemoryStore.getState().clear()
})

describe('P1-A① 沉淀高光前置（Mock 编排顺序）', () => {
  it('通用探索：artifact → skill_learned → done，且收尾语为最后一个事件', async () => {
    const events = await run(GOAL_ACT1)
    const kinds = events.map((e) => e.kind)

    expect(kinds).toContain('artifact_done')
    expect(kinds).toContain('skill_learned')
    expect(kinds.indexOf('skill_learned')).toBeGreaterThan(kinds.indexOf('artifact_done'))
    expect(kinds.indexOf('done')).toBeGreaterThan(kinds.indexOf('skill_learned'))
    expect(kinds[kinds.length - 1]).toBe('done')

    const last = events[events.length - 1]
    if (last.kind === 'done') expect(last.text).toBe(GENERIC_DONE_TEXT)
    expect(useSkillStore.getState().learned).toHaveLength(1)
    expect(useSkillStore.getState().learned[0].version).toBe(1)
  })

  it('技能命中：走技能步骤并补 done，不重复沉淀', async () => {
    await run(GOAL_ACT1)
    const events = await run(GOAL_ACT2)
    const kinds = events.map((e) => e.kind)

    // 幕2 开场可能有记忆注入 reflect（幕1 harvest 已写入 L2）——按事件类型定位而非下标
    expect(kinds).toContain('skill_hit')
    expect(kinds.indexOf('skill_hit')).toBeLessThan(kinds.indexOf('artifact_done'))
    expect(kinds).not.toContain('skill_learned')
    expect(kinds[kinds.length - 1]).toBe('done')
    expect(useSkillStore.getState().learned).toHaveLength(1)
  })

  it('非任务型输入：走角色降级剧本，不沉淀技能', async () => {
    const events = await run('你好')
    const kinds = events.map((e) => e.kind)

    expect(kinds).not.toContain('skill_learned')
    expect(kinds[kinds.length - 1]).toBe('done')
  })
})

describe('P1-A② 记忆注入收敛', () => {
  it('开场 reflect 压成一行摘要，不铺开记忆明细', async () => {
    const memory = getMemoryProvider()
    await memory.record({ t: Date.now() - 1000, role: ROLE, kind: 'episodic', goal: '上周的研学活动方案', outcome: 'executed' })
    await memory.record({ t: Date.now(), role: ROLE, kind: 'episodic', goal: '整理期中复习提纲', outcome: 'executed' })
    await memory.record({ t: Date.now(), role: ROLE, kind: 'semantic', key: `${ROLE}.pref.quiz.count`, value: 10, confidence: 0.8 })

    const events = await run(GOAL_ACT1)
    const first = events[0]
    expect(first.kind).toBe('reflect')
    if (first.kind === 'reflect') {
      expect(first.text).toBe('已注入记忆上下文：场景记忆 2 条 · 用户偏好 1 条')
      expect(first.text).not.toContain('\n')
    }
  })

  it('无记忆时不发注入事件（保持安静基线）', async () => {
    const events = await run(GOAL_ACT1)
    const reflect = events.find((e) => e.kind === 'reflect')
    expect(reflect === undefined || !(reflect.kind === 'reflect' && reflect.text.startsWith('已注入记忆上下文'))).toBe(true)
  })
})
