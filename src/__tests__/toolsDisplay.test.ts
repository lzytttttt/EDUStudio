import { describe, expect, it } from 'vitest'
import { toolRegistry } from '../harness/agent/ToolRegistry'

/** 全量工具集：三角色列表按名称去重并集（v0.9.2 共 13 个工具） */
function allTools() {
  const seen = new Map<string, NonNullable<ReturnType<typeof toolRegistry.get>>>()
  for (const role of ['teacher', 'schoolAdmin', 'bureau'] as const) {
    for (const t of toolRegistry.listForRole(role)) seen.set(t.name, t)
  }
  return [...seen.values()]
}

describe('工具 display 业务文案（v0.9.2 P0-A 执行轨迹业务化）', () => {
  it('13 个工具全部声明 display，空参也不产生空文案', () => {
    const tools = allTools()
    expect(tools).toHaveLength(13)
    for (const t of tools) {
      expect(t.display, `${t.name} 缺少 display 字段`).toBeTypeOf('function')
      expect(t.display!({}), `${t.name} 空参 display 返回空串`).toBeTruthy()
    }
  })

  it('课标检索 → 正在检索课程标准「函数」（方案示例文案）', () => {
    expect(toolRegistry.get('searchCurriculum')!.display!({ keyword: '函数' })).toBe(
      '正在检索课程标准「函数」',
    )
  })

  it('命制试题 → 正在为「分数乘法」命制试题（方案示例文案）', () => {
    expect(toolRegistry.get('genQuiz')!.display!({ knowledgePoint: '分数乘法' })).toBe(
      '正在为「分数乘法」命制试题',
    )
  })

  it('可选参数缺省时兜底不抛错（analyzeClass）', () => {
    const display = toolRegistry.get('analyzeClass')!.display!
    expect(() => display({})).not.toThrow()
    expect(display({})).toBe('正在分析课堂评课数据')
    expect(display({ teacher: '李建国' })).toBe('正在分析李建国的评课数据')
  })

  it('合并成文按 docs 数量生成文案', () => {
    expect(toolRegistry.get('mergeDocuments')!.display!({ docs: ['a', 'b', 'c'] })).toBe(
      '正在汇编3 份文档',
    )
  })

  it('无参工具文案稳定（queryRegionData）', () => {
    expect(toolRegistry.get('queryRegionData')!.display!({})).toBe('正在调取区域教育核心指标')
  })
})
