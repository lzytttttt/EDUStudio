import { describe, expect, it } from 'vitest'
import { BRIEFING_DECKS } from '../harness/scripts/briefing'
import { CLASS_LEARNING } from '../data/seed'

/* 简报剧本文案口径（v1.1 P0-2）
 * seed 里 82.4 是「物理均分」、环比 +2.1；不存在「班级均分」字段，
 * 旧 t8 文案的「提升 1.8 分」与 seed 的 +2.1 冲突，本版统一为物理均分口径。 */

function t8Text(): string {
  const payload = BRIEFING_DECKS.teacher.find((c) => c.id === 't8')?.payload
  expect(payload?.kind).toBe('editable')
  return payload?.kind === 'editable' ? payload.text : ''
}

describe('简报剧本 t8 文案口径', () => {
  it('t8 正文引用「物理均分 82.4」与「+2.1 分」', () => {
    const text = t8Text()
    expect(text).toContain('物理均分 82.4')
    expect(text).toContain('+2.1 分')
  })

  it('t8 不再出现「班级均分」与旧环比「1.8」', () => {
    const text = t8Text()
    expect(text).not.toContain('班级均分')
    expect(text).not.toContain('1.8')
  })

  it('t8 数字锚点与 seed 物理成绩一致（82.4 / +2.1）', () => {
    const physics = CLASS_LEARNING[0].scores.find((s) => s.subject === '物理')!
    expect(physics.avg).toBe(82.4)
    expect(physics.trend).toBe(2.1)
    expect(t8Text()).toContain(String(physics.avg))
  })
})
