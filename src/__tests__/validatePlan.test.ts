import { describe, expect, it } from 'vitest'
import type { MissionTemplate } from '../harness/director/types'
import {
  adaptPlanToTasks,
  planFromTemplate,
  type MissionPlan,
  type WirePlanTask,
} from '../harness/director/planTypes'
import { validatePlan } from '../harness/director/validatePlan'

/* ------------------------------------------------------------------ */
/* 夹具：roadmap 附录 A 的合法计划（可变 JSON 形态）                     */
/* ------------------------------------------------------------------ */

/** 合法 4 环节示例（附录 A；唯一被各用例按需破坏/修正的基线） */
function validPlan(): Record<string, unknown> {
  return {
    kind: 'exam_loop',
    title: '单元考闭环',
    tasks: [
      { id: 't1', agentId: 'analyst', title: '核对学情与分层名单', deps: [] },
      { id: 't2', agentId: 'assessor', title: '分层练习单', deps: ['t1'], gate: 'worksheet' },
      { id: 't3', agentId: 'curriculum', title: '习题课教案', deps: ['t1'], gate: 'lesson' },
      { id: 't4', agentId: 'chief', title: '汇总与三道校验', deps: ['t2', 't3'] },
    ],
    gates: ['worksheet', 'lesson'],
    deliverables: ['简报', '练习单', '教案', '摘要'],
    estimateMinutes: 9,
  }
}

/** 取 tasks 数组（测试内断言/变异用） */
function tasksOf(plan: Record<string, unknown>): Record<string, unknown>[] {
  return plan.tasks as Record<string, unknown>[]
}

function errorsText(result: ReturnType<typeof validatePlan>): string {
  return result.errors.join('\n')
}

/** 8 环节上限用例：在合法 4 环节后追加 4 个无依赖的 chief 收尾环节 */
function planWithEightTasks(): Record<string, unknown> {
  const plan = validPlan()
  const extra = ['补充分组', '补充校验', '补充归档', '补充交付'].map((title, index) => ({
    id: `t${index + 5}`,
    agentId: 'chief',
    title,
    deps: [],
  }))
  plan.tasks = [...(plan.tasks as unknown[]), ...extra]
  return plan
}

describe('validatePlan #1 kind（reject）', () => {
  it('exam_loop / parent_meeting 均通过', () => {
    expect(validatePlan(validPlan()).ok).toBe(true)
    expect(validatePlan({ ...validPlan(), kind: 'parent_meeting' }).ok).toBe(true)
  })

  it('非法 kind → reject 且不返回 plan', () => {
    const result = validatePlan({ ...validPlan(), kind: 'class_party' })
    expect(result.ok).toBe(false)
    expect(result.plan).toBeUndefined()
    expect(errorsText(result)).toContain('#1')
  })

  it('缺 kind → reject', () => {
    const raw = validPlan()
    delete raw.kind
    expect(validatePlan(raw).ok).toBe(false)
  })
})

describe('validatePlan #2 任务数量 4–8（reject）', () => {
  it('4 个与 8 个都通过', () => {
    expect(validatePlan(validPlan()).ok).toBe(true)
    expect(validatePlan(planWithEightTasks()).ok).toBe(true)
  })

  it('3 个 → reject', () => {
    const raw = validPlan()
    raw.tasks = tasksOf(raw).slice(0, 3)
    const result = validatePlan(raw)
    expect(result.ok).toBe(false)
    expect(errorsText(result)).toContain('#2')
  })

  it('9 个 → reject', () => {
    const raw = planWithEightTasks()
    ;(raw.tasks as unknown[]).push({ id: 't9', agentId: 'chief', title: '多余环节', deps: [] })
    expect(validatePlan(raw).ok).toBe(false)
  })

  it('tasks 非数组 → reject', () => {
    expect(validatePlan({ ...validPlan(), tasks: 'nope' }).ok).toBe(false)
  })
})

describe('validatePlan #3 名册与至少 2 个非 chief（reject）', () => {
  it('不在册的 agentId → reject', () => {
    const raw = validPlan()
    tasksOf(raw)[0].agentId = 'hacker'
    const result = validatePlan(raw)
    expect(result.ok).toBe(false)
    expect(errorsText(result)).toContain('#3')
  })

  it('只有 1 个非 chief 成员 → reject（按去重成员计）', () => {
    const raw = validPlan()
    tasksOf(raw)[1].agentId = 'analyst'
    tasksOf(raw)[2].agentId = 'analyst'
    const result = validatePlan(raw)
    expect(result.ok).toBe(false)
    expect(errorsText(result)).toContain('至少需要 2 个非 chief')
  })
})

describe('validatePlan #4 deps 引用/无环/最长链 ≤3（reject）', () => {
  it('deps 引用不存在 → reject', () => {
    const raw = validPlan()
    tasksOf(raw)[3].deps = ['t99']
    const result = validatePlan(raw)
    expect(result.ok).toBe(false)
    expect(errorsText(result)).toContain('#4')
  })

  it('自依赖 → reject', () => {
    const raw = validPlan()
    tasksOf(raw)[0].deps = ['t1']
    expect(validatePlan(raw).ok).toBe(false)
  })

  it('环 → reject', () => {
    const raw = validPlan()
    tasksOf(raw)[0].deps = ['t4']
    const result = validatePlan(raw)
    expect(result.ok).toBe(false)
    expect(errorsText(result)).toContain('环')
  })

  it('最长链 4 个任务 → reject', () => {
    const raw = validPlan()
    raw.tasks = [
      { id: 't1', agentId: 'analyst', title: '核对学情', deps: [] },
      { id: 't2', agentId: 'assessor', title: '分层练习', deps: ['t1'], gate: 'worksheet' },
      { id: 't3', agentId: 'curriculum', title: '习题课教案', deps: ['t2'], gate: 'lesson' },
      { id: 't4', agentId: 'chief', title: '汇总校验', deps: ['t3'] },
    ]
    const result = validatePlan(raw)
    expect(result.ok).toBe(false)
    expect(errorsText(result)).toContain('最长链')
  })

  it('最长链 3 个任务通过（附录 A 即 t1→t2→t4）', () => {
    expect(validatePlan(validPlan()).ok).toBe(true)
  })

  it('task id 重复 → reject', () => {
    const raw = validPlan()
    tasksOf(raw)[1].id = 't1'
    const result = validatePlan(raw)
    expect(result.ok).toBe(false)
    expect(errorsText(result)).toContain('id 重复')
  })

  it('deps 缺省 → 按空数组修正（不 reject）', () => {
    const raw = validPlan()
    delete tasksOf(raw)[3].deps
    const result = validatePlan(raw)
    expect(result.ok).toBe(true)
    expect(result.fixed.join('；')).toContain('deps 缺省')
  })
})

describe('validatePlan #5 审批门（reject / 按 tasks 重算）', () => {
  it('非法 gate → reject', () => {
    const raw = validPlan()
    tasksOf(raw)[1].gate = 'ppt'
    const result = validatePlan(raw)
    expect(result.ok).toBe(false)
    expect(errorsText(result)).toContain('#5')
  })

  it('gates 为空数组 → reject', () => {
    expect(validatePlan({ ...validPlan(), gates: [] }).ok).toBe(false)
  })

  it('gates 超过 2 个 → reject', () => {
    expect(validatePlan({ ...validPlan(), gates: ['worksheet', 'lesson', 'speech'] }).ok).toBe(false)
  })

  it('gates 含非法门 → reject', () => {
    expect(validatePlan({ ...validPlan(), gates: ['worksheet', 'ppt'] }).ok).toBe(false)
  })

  it('没有任务挂门 → reject', () => {
    const raw = validPlan()
    delete tasksOf(raw)[1].gate
    delete tasksOf(raw)[2].gate
    const result = validatePlan(raw)
    expect(result.ok).toBe(false)
    expect(errorsText(result)).toContain('#5')
  })

  it('任务上超过 2 个门 → reject', () => {
    const raw = validPlan()
    tasksOf(raw)[0].gate = 'speech'
    expect(validatePlan(raw).ok).toBe(false)
  })

  it('gates 与 task.gate 冲突 → 按 tasks 重算并记 fixed', () => {
    const raw = validPlan()
    raw.gates = ['speech']
    const result = validatePlan(raw)
    expect(result.ok).toBe(true)
    expect(result.plan?.gates).toEqual(['worksheet', 'lesson'])
    expect(result.fixed.join('；')).toContain('已按任务重算')
  })
})

describe('validatePlan #6 deliverables（reject / 去重）', () => {
  it('合法子集通过', () => {
    const raw = validPlan()
    raw.deliverables = ['简报']
    const result = validatePlan(raw)
    expect(result.ok).toBe(true)
    expect(result.plan?.deliverables).toEqual(['简报'])
  })

  it('非法 kind → reject', () => {
    const result = validatePlan({ ...validPlan(), deliverables: ['简报', 'PPT'] })
    expect(result.ok).toBe(false)
    expect(errorsText(result)).toContain('#6')
  })

  it('空数组 → reject', () => {
    expect(validatePlan({ ...validPlan(), deliverables: [] }).ok).toBe(false)
  })

  it('重复项 → 去重并记 fixed', () => {
    const result = validatePlan({ ...validPlan(), deliverables: ['简报', '简报', '讲稿'] })
    expect(result.ok).toBe(true)
    expect(result.plan?.deliverables).toEqual(['简报', '讲稿'])
    expect(result.fixed.join('；')).toContain('deliverables 已去重')
  })
})

describe('validatePlan #7 title / estimate（修正不 reject）', () => {
  it('计划 title 超长 → 截断为 12 字', () => {
    const raw = { ...validPlan(), title: '这是一个超过十二个字的超长计划标题' }
    const result = validatePlan(raw)
    expect(result.ok).toBe(true)
    expect([...(result.plan?.title ?? '')]).toHaveLength(12)
    expect(result.fixed.join('；')).toContain('title 超长')
  })

  it('task title 超长 → 截断为 20 字', () => {
    const raw = validPlan()
    tasksOf(raw)[1].title = '这是一个超过二十个字的任务标题用于测试截断逻辑是否生效'
    const result = validatePlan(raw)
    expect(result.ok).toBe(true)
    expect([...(result.plan?.tasks[1].title ?? '')]).toHaveLength(20)
    expect(result.fixed.join('；')).toContain('title 超长')
  })

  it('estimateMinutes 低于 3 → 修正为 3（不 reject）', () => {
    const result = validatePlan({ ...validPlan(), estimateMinutes: 2 })
    expect(result.ok).toBe(true)
    expect(result.plan?.estimateMinutes).toBe(3)
    expect(result.fixed.join('；')).toContain('estimateMinutes')
  })

  it('estimateMinutes 高于 60 → 修正为 60（不 reject）', () => {
    const result = validatePlan({ ...validPlan(), estimateMinutes: 99 })
    expect(result.ok).toBe(true)
    expect(result.plan?.estimateMinutes).toBe(60)
  })

  it('estimateMinutes 缺失/非数字 → 按任务数修正并记 fixed', () => {
    const raw = validPlan()
    delete raw.estimateMinutes
    const result = validatePlan(raw)
    expect(result.ok).toBe(true)
    expect(result.plan?.estimateMinutes).toBe(8) // 4 个任务 × 2
    const asString = validatePlan({ ...validPlan(), estimateMinutes: '9' })
    expect(asString.ok).toBe(true)
    expect(asString.plan?.estimateMinutes).toBe(8)
  })

  it('缺 title → reject（结构缺失不静默补）', () => {
    const raw = validPlan()
    delete raw.title
    const result = validatePlan(raw)
    expect(result.ok).toBe(false)
    expect(errorsText(result)).toContain('#7')
  })
})

describe('validatePlan #8 可选 tool 白名单（v1.2 防线，reject）', () => {
  it('在册且属该 agent 工具域 → 通过并保留', () => {
    const raw = validPlan()
    tasksOf(raw)[1].tool = 'genQuiz' // assessor 工具域
    const result = validatePlan(raw)
    expect(result.ok).toBe(true)
    expect(result.plan?.tasks[1].tool).toBe('genQuiz')
  })

  it('未注册工具 → reject', () => {
    const raw = validPlan()
    tasksOf(raw)[0].tool = 'hackTool'
    const result = validatePlan(raw)
    expect(result.ok).toBe(false)
    expect(errorsText(result)).toContain('#8')
  })

  it('注册了但不属于该 agent 工具域 → reject', () => {
    const raw = validPlan()
    tasksOf(raw)[1].tool = 'genLessonPlan' // assessor 无备课工具
    const result = validatePlan(raw)
    expect(result.ok).toBe(false)
    expect(errorsText(result)).toContain('工具域')
  })

  it('chief 不执行工具 → reject', () => {
    const raw = validPlan()
    tasksOf(raw)[3].tool = 'genQuiz'
    expect(validatePlan(raw).ok).toBe(false)
  })
})

describe('validatePlan 结构与本地补正', () => {
  it('非对象输入 → reject', () => {
    for (const raw of [null, undefined, 'x', 42, [], [{ kind: 'exam_loop' }]]) {
      const result = validatePlan(raw)
      expect(result.ok).toBe(false)
      expect(result.plan).toBeUndefined()
    }
  })

  it('合法计划：errors 为空、fixed 为空、gates/estimate 原样', () => {
    const result = validatePlan(validPlan())
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.fixed).toEqual([])
    expect(result.plan).toMatchObject({
      kind: 'exam_loop',
      title: '单元考闭环',
      gates: ['worksheet', 'lesson'],
      estimateMinutes: 9,
    })
  })

  it('id 重编号为 t1..tn，deps 同步映射', () => {
    const raw = validPlan()
    raw.tasks = [
      { id: 'a', agentId: 'analyst', title: '核对学情', deps: [] },
      { id: 'b', agentId: 'assessor', title: '分层练习', deps: ['a'], gate: 'worksheet' },
      { id: 'c', agentId: 'curriculum', title: '习题课教案', deps: ['a'], gate: 'lesson' },
      { id: 'd', agentId: 'chief', title: '汇总校验', deps: ['b', 'c'] },
    ]
    const result = validatePlan(raw)
    expect(result.ok).toBe(true)
    expect(result.plan?.tasks.map((task) => task.id)).toEqual(['t1', 't2', 't3', 't4'])
    expect(result.plan?.tasks[1].deps).toEqual(['t1'])
    expect(result.plan?.tasks[3].deps).toEqual(['t2', 't3'])
    expect(result.fixed.join('；')).toContain('重编号')
  })

  it('返回的 plan 不共享入参引用（后续改模板不污染）', () => {
    const raw = validPlan()
    const result = validatePlan(raw)
    const originalTitle = (raw.title as string)
    raw.title = '被外部改掉'
    expect(result.plan?.title).toBe(originalTitle)
  })
})

/* ------------------------------------------------------------------ */
/* planTypes：模板 → wire 计划；wire 计划 → 执行层 MissionPlanTask[]      */
/* ------------------------------------------------------------------ */

const templateFixture: MissionTemplate = {
  kind: 'parent_meeting',
  title: '家长会材料包',
  plan: [
    { id: 't1', agentId: 'analyst', title: '核对学情与名单', seconds: 40 },
    { id: 't2', agentId: 'curriculum', title: '起草发言稿 + PPT 大纲', seconds: 90, deps: ['t1'] },
    { id: 't3', agentId: 'communicator', title: '写 3 封家长信', seconds: 90, deps: ['t1'], gate: 'letters' },
    { id: 't4', agentId: 'chief', title: '汇总与三道校验', seconds: 30, deps: ['t2', 't3'] },
  ],
  script: [],
  artifacts: [
    { id: 'a-speech', title: '家长会发言稿', kind: '讲稿', owner: 'curriculum', markdown: '' },
    { id: 'a-letters', title: '家长信 ×3', kind: '信件', owner: 'communicator', markdown: '' },
    { id: 'a-letters-copy', title: '家长信（副本）', kind: '信件', owner: 'communicator', markdown: '' },
    { id: 'a-brief', title: '学情简报', kind: '简报', owner: 'analyst', markdown: '' },
  ],
  gates: ['letters'],
  meta: { steps: 4, members: 3, gates: 1, demoSeconds: 9, savedHours: 1.6, delivered: 4, decisions: 1 },
}

describe('planTypes.planFromTemplate', () => {
  it('kind/title/tasks/deps/gate 原样保留', () => {
    const plan = planFromTemplate(templateFixture)
    expect(plan.kind).toBe('parent_meeting')
    expect(plan.title).toBe('家长会材料包')
    expect(plan.tasks).toHaveLength(4)
    expect(plan.tasks[2]).toMatchObject({ id: 't3', agentId: 'communicator', deps: ['t1'], gate: 'letters' })
  })

  it('deliverables 取产物 kind 并去重', () => {
    expect(planFromTemplate(templateFixture).deliverables).toEqual(['讲稿', '信件', '简报'])
  })

  it('estimateMinutes 由模板 seconds 合计换算并 clamp 3–60', () => {
    // (40+90+90+30)/60 = 4.17 → 4
    expect(planFromTemplate(templateFixture).estimateMinutes).toBe(4)
    const bigTemplate: MissionTemplate = {
      ...templateFixture,
      plan: templateFixture.plan.map((task) => ({ ...task, seconds: 3600 })),
    }
    expect(planFromTemplate(bigTemplate).estimateMinutes).toBe(60)
  })

  it('模板 gates 与 plan 分离（v1.0 剧本实貌）→ 按 GATE_OWNER 落到对应环节', () => {
    const template: MissionTemplate = {
      ...templateFixture,
      plan: templateFixture.plan.map((task) => {
        const copy = { ...task }
        delete copy.gate
        return copy
      }),
      gates: ['speech', 'letters'],
    }
    const plan = planFromTemplate(template)
    expect(plan.tasks.find((task) => task.agentId === 'curriculum')?.gate).toBe('speech')
    expect(plan.tasks.find((task) => task.agentId === 'communicator')?.gate).toBe('letters')
    expect(plan.gates).toEqual(['speech', 'letters'])
    // 门已落到环节上 → validatePlan 通过（UI 可从 task.gate 派生 gateCount=2）
    expect(validatePlan(plan).ok).toBe(true)
  })

  it('模板计划可被 validatePlan 接受（模板兜底不产生非法计划）', () => {
    const plan = planFromTemplate(templateFixture)
    // 模板为可信来源；结构合法（4 环节 / 1 门 / deliverables 合法）
    const result = validatePlan(plan)
    expect(result.ok).toBe(true)
  })
})

describe('planTypes.adaptPlanToTasks', () => {
  it('id 重编号 t1..tn、deps 同步映射、gate 保留、seconds 按成员补', () => {
    const plan: MissionPlan = {
      kind: 'exam_loop',
      title: '单元考闭环',
      tasks: [
        { id: 'a', agentId: 'analyst', title: '核对学情', deps: [] },
        { id: 'b', agentId: 'assessor', title: '分层练习', deps: ['a'], gate: 'worksheet' },
        { id: 'c', agentId: 'curriculum', title: '习题课教案', deps: ['a'], gate: 'lesson' },
        { id: 'd', agentId: 'chief', title: '汇总校验', deps: ['b', 'c'] },
      ],
      gates: ['worksheet', 'lesson'],
      deliverables: ['简报', '练习单'],
      estimateMinutes: 9,
    }
    const tasks = adaptPlanToTasks(plan)
    expect(tasks.map((task) => task.id)).toEqual(['t1', 't2', 't3', 't4'])
    expect(tasks[1]).toMatchObject({ agentId: 'assessor', deps: ['t1'], gate: 'worksheet', seconds: 90 })
    expect(tasks[3]).toMatchObject({ agentId: 'chief', deps: ['t2', 't3'], seconds: 30 })
  })

  it('悬空/自依赖/重复 deps 被过滤，不产生非法执行计划', () => {
    const tasks: WirePlanTask[] = [
      { id: 'x', agentId: 'analyst', title: '核对', deps: ['x', 'nope'] },
      { id: 'y', agentId: 'chief', title: '汇总', deps: ['x', 'x', 'nope'] },
    ]
    const plan: MissionPlan = {
      kind: 'parent_meeting',
      title: 'x',
      tasks,
      gates: [],
      deliverables: ['简报'],
      estimateMinutes: 5,
    }
    const adapted = adaptPlanToTasks(plan)
    expect(adapted[0].deps).toEqual([])
    expect(adapted[1].deps).toEqual(['t1'])
    expect(adapted[1].deps).toHaveLength(1)
  })

  it('不修改入参（纯适配）', () => {
    const plan = planFromTemplate(templateFixture)
    const before = JSON.stringify(plan)
    adaptPlanToTasks(plan)
    expect(JSON.stringify(plan)).toBe(before)
  })
})
