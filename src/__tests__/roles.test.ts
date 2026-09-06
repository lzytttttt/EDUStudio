import { describe, expect, it } from 'vitest'
import { getRolePreset, buildSystemPrompt } from '../harness/roles'
import type { MemoryEntry } from '../harness/types'

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

describe('buildSystemPrompt（记忆注入 v0.9.1）', () => {
  const T0 = new Date(2026, 8, 6, 10, 0, 0).getTime()
  const memory: { episodic: MemoryEntry[]; semantic: MemoryEntry[] } = {
    episodic: [
      { t: T0, role: 'teacher', kind: 'episodic', goal: '五年级分数乘法出题', outcome: 'accepted' },
    ],
    semantic: [
      { t: T0, role: 'teacher', kind: 'semantic', key: 'teacher.pref.quiz.count', value: 30, confidence: 0.8 },
    ],
  }

  it('空记忆条目不产生空段（逐字节与现状一致）', () => {
    const base = getRolePreset('teacher').systemPrompt
    expect(buildSystemPrompt(getRolePreset('teacher'), undefined, { episodic: [], semantic: [] })).toBe(base)
  })

  it('注入【场景记忆】与【用户偏好】，段序场景记忆在前', () => {
    const out = buildSystemPrompt(getRolePreset('teacher'), undefined, memory)
    expect(out.startsWith(getRolePreset('teacher').systemPrompt)).toBe(true)
    expect(out).toContain('【场景记忆】')
    expect(out).toContain('9月6日：五年级分数乘法出题（已采纳）')
    expect(out).toContain('【用户偏好】')
    expect(out).toContain('出题默认 30 题')
    expect(out.indexOf('【场景记忆】')).toBeLessThan(out.indexOf('【用户偏好】'))
  })

  it('画像偏好与语义偏好合并同段（不出现两个【用户偏好】）', () => {
    const out = buildSystemPrompt(
      getRolePreset('teacher'),
      { nickname: '张老师', stage: '', style: '', scenes: {} },
      memory,
    )
    expect(out.match(/【用户偏好】/g)).toHaveLength(1)
    expect(out).toContain('张老师')
    expect(out).toContain('出题默认 30 题')
  })
})
