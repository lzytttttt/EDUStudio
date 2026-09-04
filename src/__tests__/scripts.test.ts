import { describe, expect, it } from 'vitest'
import { matchScript } from '../harness/scripts/agent'
import { matchTemplate, listTemplates, getTemplateById } from '../harness/scripts/artifacts'

describe('matchScript', () => {
  it('教师教案目标命中 lessonPlan 剧本', () => {
    const s = matchScript('teacher', '备一节《摩擦力》公开课教案')
    const artifactStep = s.steps.find((st) => st.type === 'artifact')
    expect(artifactStep).toEqual({ type: 'artifact', kind: 'lessonPlan' })
    expect(s.steps.length).toBeGreaterThan(0)
  })

  it('未命中时回退 fallback 剧本', () => {
    const s = matchScript('teacher', '完全无关的奇怪目标xyz')
    expect(s.steps.length).toBeGreaterThan(0)
  })
})

describe('matchTemplate / 模板库', () => {
  it('关键词命中：讲稿 → report，通知 → notice', () => {
    expect(matchTemplate('生成家长会讲稿', 'teacher').kind).toBe('report')
    expect(matchTemplate('起草专项督导通知', 'bureau').kind).toBe('notice')
  })

  it('按角色过滤模板库', () => {
    const teacherIds = listTemplates('teacher').map((t) => t.id)
    expect(teacherIds).toContain('lessonPlan')
    expect(teacherIds).toContain('report')
    expect(teacherIds).not.toContain('notice')
    expect(listTemplates('bureau').map((t) => t.id)).toContain('notice')
  })

  it('按 ID 取模板，未知 ID 回退 generic', () => {
    expect(getTemplateById('notice').kind).toBe('notice')
    expect(getTemplateById('not-exist').kind).toBe('generic')
  })
})
