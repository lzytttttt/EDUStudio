import { describe, expect, it } from 'vitest'
import { getRolePreset, buildSystemPrompt } from '../harness/roles'

describe('buildSystemPrompt（偏好注入）', () => {
  it('无偏好时原样返回', () => {
    const base = getRolePreset('teacher').systemPrompt
    expect(buildSystemPrompt(getRolePreset('teacher'))).toBe(base)
    expect(buildSystemPrompt(getRolePreset('teacher'), undefined)).toBe(base)
  })

  it('注入称呼/背景/风格', () => {
    const out = buildSystemPrompt(getRolePreset('teacher'), {
      nickname: '张老师',
      stage: '初中物理',
      style: '简洁务实',
      scenes: {},
    })
    expect(out).toContain('【用户偏好】')
    expect(out).toContain('张老师')
    expect(out).toContain('初中物理')
    expect(out).toContain('简洁务实')
    expect(out.startsWith(getRolePreset('teacher').systemPrompt)).toBe(true)
  })

  it('空白字段不产生空行噪音', () => {
    const out = buildSystemPrompt(getRolePreset('bureau'), { nickname: '', stage: '', style: '', scenes: {} })
    expect(out).toBe(getRolePreset('bureau').systemPrompt)
  })
})
