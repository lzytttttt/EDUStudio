import { describe, expect, it } from 'vitest'
import {
  TASK_EXECUTION_HINT,
  looksLikeTaskGoal,
  planStepsForToolCalls,
  taskExecutionHint,
} from '../harness/agent/Orchestrator'

/* v0.9.4-03：function-calling 路径轨迹口径与任务型执行约束（导出纯函数单测） */

describe('任务型判定与执行约束', () => {
  it('任务型目标命中（分析 / 生成 / 撰写 / 报告 等）', () => {
    expect(looksLikeTaskGoal('分析高一（3）班函数单调性薄弱点')).toBe(true)
    expect(looksLikeTaskGoal('根据上游分析结果生成三档分层练习')).toBe(true)
    expect(looksLikeTaskGoal('帮我写一份家长会发言稿')).toBe(true)
    expect(looksLikeTaskGoal('统计全校近八周趋势')).toBe(true)
  })

  it('非任务型不命中（寒暄 / 咨询）', () => {
    expect(looksLikeTaskGoal('你好')).toBe(false)
    expect(looksLikeTaskGoal('谢谢')).toBe(false)
  })

  it('taskExecutionHint：任务型返回约束文案，非任务型返回空串（旧请求体不变）', () => {
    expect(taskExecutionHint('生成三档分层练习')).toBe(TASK_EXECUTION_HINT)
    expect(taskExecutionHint('你好')).toBe('')
    expect(TASK_EXECUTION_HINT).toContain('优先调用可用工具')
  })
})

describe('function-calling 计划步骤文案', () => {
  it('已注册工具取业务 label（与对话轨迹 / 画布投影同口径）', () => {
    expect(planStepsForToolCalls([{ name: 'queryClassLearning' }, { name: 'genQuiz' }])).toEqual([
      '学情查询',
      '命制试题',
    ])
  })

  it('未注册工具安全回退为工具名', () => {
    expect(planStepsForToolCalls([{ name: 'unknownTool' }])).toEqual(['unknownTool'])
  })

  it('空列表返回空数组', () => {
    expect(planStepsForToolCalls([])).toEqual([])
  })
})
