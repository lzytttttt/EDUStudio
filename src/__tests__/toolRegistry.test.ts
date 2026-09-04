import { describe, expect, it } from 'vitest'
import { toolRegistry } from '../harness/agent/ToolRegistry'

describe('toolRegistry', () => {
  it('教师可见 genQuiz / queryClassLearning，不可见区域工具', () => {
    const names = toolRegistry.listForRole('teacher').map((t) => t.name)
    expect(names).toContain('genQuiz')
    expect(names).toContain('queryClassLearning')
    expect(names).not.toContain('queryRegionData')
  })

  it('校长可见校情统计，教育局可见区域数据', () => {
    expect(toolRegistry.listForRole('schoolAdmin').map((t) => t.name)).toContain('querySchoolStats')
    expect(toolRegistry.listForRole('bureau').map((t) => t.name)).toContain('queryRegionData')
  })

  it('按名称取工具并执行返回结构', async () => {
    const tool = toolRegistry.get('queryRegionData')
    expect(tool).toBeDefined()
    const result = await tool!.run({})
    expect(result.summary).toBeTruthy()
    expect(result.payload).toBeDefined()
  })

  it('genQuiz 写入出题工作台（结构化 5 题）', async () => {
    const { useQuizStore } = await import('../stores/quizStore')
    const tool = toolRegistry.get('genQuiz')!
    const result = await tool.run({ knowledgePoint: '函数单调性' })
    const items = useQuizStore.getState().items
    expect(items).toHaveLength(5)
    expect(useQuizStore.getState().knowledgePoint).toBe('函数单调性')
    expect((result.payload as { items: unknown[] }).items).toHaveLength(5)
    useQuizStore.getState().clear()
  })
})
