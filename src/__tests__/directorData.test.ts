import { describe, expect, it } from 'vitest'
import {
  ARTIFACTS,
  DECISION_TO_MISSION,
  EXAM_LOOP_KEYWORDS,
  GATE_OWNER,
  GUIDE_STEPS,
  MISSION_HOSTED_PIECES,
  MISSION_PLAN,
  MISSION_SCRIPT,
  MISSION_TEMPLATES,
  PARENT_MEETING_KEYWORDS,
  missionTemplate,
  routeMissionKind,
} from '../harness/director/data'
import type { GateId, MissionKind } from '../harness/director/types'

/* v1.1 M3：剧本模板注册表 / 意图路由 / 审批门归属 / 产物引用（roadmap §6、附录 C/E） */

const TEMPLATE_KEYS = Object.keys(MISSION_TEMPLATES) as MissionKind[]
const ALL_GATES: GateId[] = ['speech', 'letters', 'worksheet', 'lesson']
/** 统计型数字锚点（附录 E）：出现即必须带 {{值~来源}} 引用 */
const STAT_ANCHORS = ['82.4', '78.6', '80.2', '+2.1', '-1.4', '+0.8', '93%', '61%', '80.4']
/** 86 需要数字边界，避免 186/86.5 误伤 */
const ATTENTION_ANCHOR = /(^|[^\d.])86(?![.\d%])/

function stripCitations(markdown: string): string {
  return markdown.replace(/\{\{([^|~{}]+)~([^}]+)\}\}/g, '')
}

function citationsOf(markdown: string): { value: string; source: string }[] {
  const list: { value: string; source: string }[] = []
  const re = /\{\{([^|~{}]+)~([^}]+)\}\}/g
  let match: RegExpExecArray | null
  while ((match = re.exec(markdown)) !== null) {
    list.push({ value: match[1], source: match[2] })
  }
  return list
}

describe('MISSION_TEMPLATES 注册表（v1.1 M3）', () => {
  it('两条剧本齐全，parent_meeting / exam_loop 字段自洽', () => {
    expect(TEMPLATE_KEYS.sort()).toEqual(['exam_loop', 'parent_meeting'])
    for (const kind of TEMPLATE_KEYS) {
      const template = MISSION_TEMPLATES[kind]
      expect(template.kind).toBe(kind)
      expect(template.title.length).toBeGreaterThan(0)
      /* 4–6 环节、2 次拍板（roadmap §6.3 / 研究 02 §1.5） */
      expect(template.plan.length).toBeGreaterThanOrEqual(4)
      expect(template.plan.length).toBeLessThanOrEqual(6)
      expect(template.gates).toHaveLength(2)
      /* 门必须落在 plan 环节上（UI 用 plan.filter(t => t.gate) 派生「N 次拍板」） */
      const taskGates = template.plan.map((task) => task.gate).filter((gate): gate is GateId => Boolean(gate))
      expect(new Set(taskGates)).toEqual(new Set(template.gates))
      expect(new Set(template.plan.map((task) => task.id)).size).toBe(template.plan.length)
      /* meta 与内容一致 */
      expect(template.meta.steps).toBe(template.plan.length)
      expect(template.meta.gates).toBe(2)
      expect(template.meta.members).toBe(
        new Set(template.plan.filter((task) => task.agentId !== 'chief').map((task) => task.agentId)).size,
      )
      expect(template.meta.delivered).toBe(template.artifacts.length)
      expect(template.meta.decisions).toBe(2)
      /* 剧本：门事件与 template.gates 一一对应，最后一条是 done，进度单调不降 */
      const scriptGates = template.script
        .filter((ev): ev is typeof ev & { kind: 'gate' } => ev.kind === 'gate')
        .map((ev) => ev.gate)
      expect(scriptGates).toEqual(template.gates)
      expect(template.script[template.script.length - 1].kind).toBe('done')
      const progress = template.script.map((ev) => ev.progress)
      expect(progress).toEqual([...progress].sort((a, b) => a - b))
      /* script 引用的 task id 必须存在（模板执行闭环） */
      const ids = new Set(template.plan.map((task) => task.id))
      for (const ev of template.script) {
        if (ev.kind === 'feed' && ev.task) expect(ids.has(ev.task)).toBe(true)
      }
      /* 不写学生姓名：产物与剧本中不出现「同学」「学生」+ 姓名式称呼 */
      for (const artifact of template.artifacts) {
        expect(artifact.markdown).not.toMatch(/同学|学生[甲乙丙丁]|[张王李赵刘陈]同学/)
      }
    }
  })

  it('parent_meeting 为 v1.0 沿用版：5 环节 / 3 成员 / 8s 演示、4 件交付', () => {
    const template = MISSION_TEMPLATES.parent_meeting
    expect(template.plan).toHaveLength(5)
    expect(template.plan.map((task) => task.id)).toEqual(['t1', 't2', 't3', 't4', 't5'])
    expect(template.gates).toEqual(['speech', 'letters'])
    expect(template.meta.delivered).toBe(4)
    expect(template.meta.demoSeconds).toBe(9)
    expect(template.meta.savedHours).toBe(1.6)
    expect(template.artifacts.map((artifact) => artifact.id)).toEqual(['a-brief', 'a-speech', 'a-ppt', 'a-letters'])
  })

  it('exam_loop 内容按 roadmap §6.3：4 环节 / 2 门 / 4 件交付 / 7s', () => {
    const template = MISSION_TEMPLATES.exam_loop
    expect(template.title).toBe('单元考闭环')
    expect(template.plan.map((task) => `${task.id}:${task.agentId}`)).toEqual([
      't1:analyst',
      't2:assessor',
      't3:curriculum',
      't4:chief',
    ])
    expect(template.gates).toEqual(['worksheet', 'lesson'])
    expect(template.meta.demoSeconds).toBe(7)
    expect(template.meta.delivered).toBe(4)
    expect(template.artifacts.map((artifact) => artifact.title)).toEqual([
      '学情简报',
      '分层练习单',
      '习题课教案',
      '作战包摘要',
    ])
    expect(template.artifacts.map((artifact) => artifact.kind)).toEqual(['简报', '练习单', '教案', '摘要'])
    /* 剧本台词覆盖附录 C 的动态流要点 */
    const feedTexts = template.script.map((ev) => ev.text).join('\n')
    expect(feedTexts).toContain('核对单元考数据')
    expect(feedTexts).toContain('82.4 是物理均分，不是班级均分')
    expect(feedTexts).toContain('分层练习完成')
    expect(feedTexts).toContain('习题课教案完成')
    expect(feedTexts).toContain('三道路径校验完成')
    expect(feedTexts).toContain('作战包已交付')
    /* E2E 断言：第二剧本产物不含「家长会」口径 */
    expect(JSON.stringify(template)).not.toContain('家长会')
  })

  it('统计型数字全部带 {{值~来源}} 引用（P0-3 / 附录 E）', () => {
    const allCited = new Set<string>()
    for (const kind of TEMPLATE_KEYS) {
      const template = MISSION_TEMPLATES[kind]
      for (const artifact of template.artifacts) {
        const citations = citationsOf(artifact.markdown)
        expect(citations.length).toBeGreaterThan(0)
        for (const cite of citations) {
          expect(cite.value.trim()).not.toBe('')
          expect(cite.source.trim()).not.toBe('')
          allCited.add(cite.value.trim())
        }
        /* 正文（去掉引用标记后）不得再裸写统计型数字 */
        const plain = stripCitations(artifact.markdown)
        for (const anchor of STAT_ANCHORS) expect(plain.includes(anchor)).toBe(false)
        expect(ATTENTION_ANCHOR.test(plain)).toBe(false)
      }
    }
    for (const anchor of [...STAT_ANCHORS, '86']) expect(allCited.has(anchor)).toBe(true)
  })

  it('80.4 派生值必须显式标「派生」（exam_loop 学情简报）', () => {
    const markdown = MISSION_TEMPLATES.exam_loop.artifacts.map((artifact) => artifact.markdown).join('\n')
    const citations = citationsOf(markdown).filter((cite) => cite.value.trim() === '80.4')
    expect(citations.length).toBeGreaterThan(0)
    expect(citations.some((cite) => cite.source.includes('派生'))).toBe(true)
    expect(markdown).toContain('派生')
  })
})

describe('旧导出兼容（v1.0 单测 / E2E 零改动）', () => {
  it('MISSION_PLAN / MISSION_SCRIPT / ARTIFACTS 由 parent_meeting 模板派生', () => {
    const template = MISSION_TEMPLATES.parent_meeting
    expect(MISSION_PLAN).toBe(template.plan)
    expect(MISSION_SCRIPT).toBe(template.script)
    expect(ARTIFACTS).toBe(template.artifacts)
    expect(MISSION_PLAN.map((task) => task.id)).toEqual(['t1', 't2', 't3', 't4', 't5'])
    expect(MISSION_SCRIPT.map((ev) => ev.kind)).toContain('done')
    expect(ARTIFACTS).toHaveLength(4)
  })

  it('MISSION_HOSTED_PIECES 保留 v1.0 件交付口径（旧单测 hosted 4 → 10）', () => {
    expect(MISSION_HOSTED_PIECES.parent_meeting).toBe(6)
    expect(MISSION_HOSTED_PIECES.exam_loop).toBe(4)
    /* done 页可点卡数仍取 artifacts.length / meta.delivered */
    expect(MISSION_TEMPLATES.parent_meeting.artifacts).toHaveLength(4)
    expect(MISSION_TEMPLATES.exam_loop.artifacts).toHaveLength(4)
  })

  it('missionTemplate 对非法 kind 回退 parent_meeting', () => {
    expect(missionTemplate('parent_meeting')).toBe(MISSION_TEMPLATES.parent_meeting)
    expect(missionTemplate('unknown' as MissionKind)).toBe(MISSION_TEMPLATES.parent_meeting)
  })
})

describe('routeMissionKind 意图路由（roadmap §6.2 / D8）', () => {
  it.each([
    ['用高一（3）班这次单元考做个诊断', 'exam_loop'],
    ['帮我做个分层练习', 'exam_loop'],
    ['下周三习题课，帮我备一节', 'exam_loop'],
    ['这次薄弱点在函数单调性', 'exam_loop'],
    ['这周诊断一下学情', 'exam_loop'],
    ['下周三家长会，材料帮我备齐', 'parent_meeting'],
    ['帮我写一份发言稿', 'parent_meeting'],
    ['家长信怎么写更稳妥', 'parent_meeting'],
    ['写个 PPT 讲稿', 'parent_meeting'],
    ['安抚一下退步孩子的家长', 'parent_meeting'],
    ['', 'parent_meeting'],
    ['帮我整理一下这周的督导回执', 'parent_meeting'],
  ] as [string, MissionKind][])('「%s」→ %s', (utterance, expected) => {
    expect(routeMissionKind(utterance)).toBe(expected)
  })

  it('混合句 exam 优先（避免「单元考家长信」语义打架）', () => {
    expect(routeMissionKind('家长会之前先做单元考诊断')).toBe('exam_loop')
    expect(routeMissionKind('单元考后给家长写封信')).toBe('exam_loop')
    expect(routeMissionKind('PPT 里放一下分层练习')).toBe('exam_loop')
  })

  it('大小写 / 空白容错', () => {
    expect(routeMissionKind('  帮我做个 PPT  ')).toBe('parent_meeting')
    expect(routeMissionKind('帮我做个 ppt')).toBe('parent_meeting')
    expect(routeMissionKind(undefined as unknown as string)).toBe('parent_meeting')
  })

  it('关键词表与路由规则一致（双向可解释）', () => {
    expect(EXAM_LOOP_KEYWORDS.length).toBeGreaterThan(0)
    expect(PARENT_MEETING_KEYWORDS.length).toBeGreaterThan(0)
    for (const keyword of EXAM_LOOP_KEYWORDS) expect(routeMissionKind(`帮我${keyword}`)).toBe('exam_loop')
    for (const keyword of PARENT_MEETING_KEYWORDS) {
      expect(routeMissionKind(`帮我${keyword}`)).toBe('parent_meeting')
    }
  })
})

describe('GATE_OWNER / 引导 / 决策联动', () => {
  it('审批门归属：speech→curriculum / letters→communicator / worksheet→assessor / lesson→curriculum', () => {
    expect(GATE_OWNER).toEqual({
      speech: 'curriculum',
      letters: 'communicator',
      worksheet: 'assessor',
      lesson: 'curriculum',
    })
    expect(Object.keys(GATE_OWNER).sort()).toEqual([...ALL_GATES].sort())
  })

  it('GUIDE_STEPS：第一步光圈落在首张决策卡（V8）', () => {
    expect(GUIDE_STEPS[0].target).toBe('[data-guide="decision-first"]')
    expect(GUIDE_STEPS[0].hint).toBe('先看这一张')
    expect(GUIDE_STEPS.every((step) => step.target.startsWith('[data-guide='))).toBe(true)
  })

  it('d-drill 采纳联动 exam_loop（D9）', () => {
    expect(DECISION_TO_MISSION['d-drill']).toBe('exam_loop')
  })
})
