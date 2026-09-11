import { describe, expect, it } from 'vitest'
import type { AgentTraceEvent } from '../harness/types'
import type { ChatEntry } from '../stores/chatStore'
import { LOOM_TRACE_MAX_ITEMS, projectTrace } from '../apps/loom/loomProjection'

/* v0.9.4 M6：Trace 投影纯函数（plan / tool 配对 / artifact 归并 / reflect / 空 trace / error 收口） */

const entry = (trace: AgentTraceEvent[], extra: Partial<ChatEntry> = {}): ChatEntry => ({
  id: 'entry-1',
  role: 'assistant',
  content: '',
  trace,
  ...extra,
})

/** 未注册的工具名 → label 安全回退为工具名，单测不依赖工具注册表内容 */
const call = (id: string, tool = `tool-${id}`): AgentTraceEvent => ({ kind: 'tool_call', id, tool, args: {} })
const result = (id: string, summary: string, tool = `tool-${id}`): AgentTraceEvent => ({
  kind: 'tool_result',
  id,
  tool,
  summary,
})

describe('projectTrace 基础投影', () => {
  it('空 trace → 空子图', () => {
    expect(projectTrace(entry([]))).toEqual([])
  })

  it('plan → 每个 step 一个步骤项（kind=plan, done）', () => {
    const items = projectTrace(entry([{ kind: 'plan', steps: ['查询学情', '错题归因', '生成报告'] }]))
    expect(items).toHaveLength(3)
    expect(items.every((i) => i.kind === 'plan')).toBe(true)
    expect(items.map((i) => i.label)).toEqual(['查询学情', '错题归因', '生成报告'])
    expect(items.every((i) => i.status === 'done')).toBe(true)
  })

  it('reflect → 说明项', () => {
    const items = projectTrace(entry([{ kind: 'reflect', text: '已注入记忆上下文：场景记忆 2 条' }]))
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('reflect')
    expect(items[0].status).toBe('done')
    expect(items[0].label).toContain('已注入记忆上下文')
  })

  it('text / done / skill_* 不进入子图；项顺序与 trace 一致', () => {
    const items = projectTrace(
      entry([
        { kind: 'plan', steps: ['第一步'] },
        call('a'),
        { kind: 'text', text: '正文流式增量' },
        result('a', '工具 A 完成'),
        { kind: 'skill_hit', skillId: 's1', name: '技能', version: 1, origin: 'builtin' },
        { kind: 'done', text: '全部完成' },
      ]),
    )
    expect(items.map((i) => i.kind)).toEqual(['plan', 'tool'])
  })
})

describe('projectTrace 工具配对', () => {
  it('tool_call → running（尚未返回结果）', () => {
    const items = projectTrace(entry([call('a')]))
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('tool')
    expect(items[0].status).toBe('running')
    expect(items[0].label).toBe('tool-a')
  })

  it('tool_call / tool_result 按 id 配对成一项并置 done', () => {
    const items = projectTrace(entry([call('a'), result('a', '已查到 3 条记录')]))
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('tool:a')
    expect(items[0].status).toBe('done')
    expect(items[0].label).toBe('已查到 3 条记录')
  })

  it('多个 tool 交错：各自按 id 配对、顺序保持、状态互不串扰', () => {
    const items = projectTrace(entry([call('a'), call('b'), result('b', 'B 完成'), result('a', 'A 完成')]))
    expect(items.map((i) => i.id)).toEqual(['tool:a', 'tool:b'])
    expect(items.map((i) => i.status)).toEqual(['done', 'done'])
    expect(items[0].label).toBe('A 完成')
    expect(items[1].label).toBe('B 完成')
  })

  it('running 状态判定：仅未配对者 running，已配对者 done', () => {
    const items = projectTrace(entry([call('a'), call('b'), result('b', 'B 完成')]))
    expect(items.find((i) => i.id === 'tool:a')?.status).toBe('running')
    expect(items.find((i) => i.id === 'tool:b')?.status).toBe('done')
  })

  it('孤立的 tool_result（无配对 call）退化为 result 项，不丢信息', () => {
    const items = projectTrace(entry([result('x', '未配对的返回')]))
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('result')
    expect(items[0].status).toBe('done')
  })
})

describe('projectTrace Artifact 归并', () => {
  const meta: AgentTraceEvent = { kind: 'artifact_meta', artifactId: 'doc1', title: '学情分析报告', docKind: 'report' }

  it('artifact_meta → artifact 项（running，正在生成）', () => {
    const items = projectTrace(entry([meta]))
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('artifact')
    expect(items[0].status).toBe('running')
    expect(items[0].label).toBe('学情分析报告')
  })

  it('artifact_chunk 不重复成项（多次 chunk 仍只有一项）并置 done', () => {
    const items = projectTrace(
      entry([meta, { kind: 'artifact_chunk', artifactId: 'doc1', chunk: '# 一' }, { kind: 'artifact_chunk', artifactId: 'doc1', chunk: '正文' }]),
    )
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('artifact')
    expect(items[0].status).toBe('done')
  })

  it('artifact_done 归并到同一项并置 done，更新为最终标题', () => {
    const items = projectTrace(
      entry([meta, { kind: 'artifact_done', artifactId: 'doc1', title: '学情分析报告（终稿）', docKind: 'report' }]),
    )
    expect(items).toHaveLength(1)
    expect(items[0].status).toBe('done')
    expect(items[0].label).toBe('学情分析报告（终稿）')
  })

  it('不同 artifactId 生成独立文档节点', () => {
    const items = projectTrace(
      entry([
        meta,
        { kind: 'artifact_meta', artifactId: 'doc2', title: '通知', docKind: 'notice' },
      ]),
    )
    expect(items.map((i) => i.id)).toEqual(['artifact:doc1', 'artifact:doc2'])
  })
})

describe('projectTrace 失败收口与上限', () => {
  it('entry.error 时把仍在 running 的项标为 error', () => {
    const items = projectTrace(entry([call('a')], { error: '任务执行失败：接口超时' }))
    expect(items[0].status).toBe('error')
  })

  it('entry.error 且无 running 项时末项标 error', () => {
    const items = projectTrace(entry([result('a', '已完成')], { error: '收尾失败' }))
    expect(items[items.length - 1].status).toBe('error')
  })

  it('子图展示上限常量为 6', () => {
    expect(LOOM_TRACE_MAX_ITEMS).toBe(6)
  })
})
