/**
 * v1.2 M0 · 交付物类型映射单测（roadmap §3.6(2) 全表）
 * 中文 ArtifactKindCn（7 值）↔ 英文 ArtifactKind（5 值，冻结不改）。
 */
import { describe, expect, it } from 'vitest'
import type { ArtifactKind } from '../harness/types'
import type { ArtifactKindCn } from '../harness/director/types'
import { toArtifactKind, toKindCn } from '../studio/mapping'

describe('toArtifactKind · 中文 → 英文全表', () => {
  it('简报 → analysis', () => {
    expect(toArtifactKind('简报')).toBe('analysis')
  })

  it('摘要 → analysis', () => {
    expect(toArtifactKind('摘要')).toBe('analysis')
  })

  it('讲稿 → notice', () => {
    expect(toArtifactKind('讲稿')).toBe('notice')
  })

  it('信件 → notice（对外硬门类）', () => {
    expect(toArtifactKind('信件')).toBe('notice')
  })

  it('练习单 → generic（英文枚举只有 5 值）', () => {
    expect(toArtifactKind('练习单')).toBe('generic')
  })

  it('大纲 → generic', () => {
    expect(toArtifactKind('大纲')).toBe('generic')
  })

  it('教案 → lessonPlan', () => {
    expect(toArtifactKind('教案')).toBe('lessonPlan')
  })

  it('全表断言：7 个中文值都落在 5 个英文枚举内', () => {
    const table: Record<ArtifactKindCn, ArtifactKind> = {
      简报: 'analysis',
      摘要: 'analysis',
      讲稿: 'notice',
      信件: 'notice',
      练习单: 'generic',
      大纲: 'generic',
      教案: 'lessonPlan',
    }
    const kinds: ArtifactKindCn[] = ['简报', '摘要', '讲稿', '信件', '练习单', '大纲', '教案']
    for (const cn of kinds) expect(toArtifactKind(cn)).toBe(table[cn])
  })

  it('未知中文值运行时兜底 generic（不抛错、不让视图崩）', () => {
    expect(toArtifactKind('未知类型' as ArtifactKindCn)).toBe('generic')
  })
})

describe('toKindCn · 英文 → 展示中文', () => {
  it('lessonPlan → 教案', () => {
    expect(toKindCn('lessonPlan')).toBe('教案')
  })

  it('notice → 讲稿', () => {
    expect(toKindCn('notice')).toBe('讲稿')
  })

  it('analysis → 摘要', () => {
    expect(toKindCn('analysis')).toBe('摘要')
  })

  it('generic → 大纲', () => {
    expect(toKindCn('generic')).toBe('大纲')
  })

  it('report → 摘要（反向默认唯一多对一）', () => {
    expect(toKindCn('report')).toBe('摘要')
  })

  it('文档自带 docKindCn 时优先（保留「信件 / 练习单 / 简报」等细分）', () => {
    expect(toKindCn('notice', '信件')).toBe('信件')
    expect(toKindCn('generic', '练习单')).toBe('练习单')
    expect(toKindCn('analysis', '简报')).toBe('简报')
    expect(toKindCn('lessonPlan', '大纲')).toBe('大纲')
  })

  it('反向全表断言：5 个英文枚举都有默认中文名', () => {
    const table: Record<ArtifactKind, ArtifactKindCn> = {
      lessonPlan: '教案',
      report: '摘要',
      notice: '讲稿',
      analysis: '摘要',
      generic: '大纲',
    }
    const kinds: ArtifactKind[] = ['lessonPlan', 'report', 'notice', 'analysis', 'generic']
    for (const kind of kinds) expect(toKindCn(kind)).toBe(table[kind])
  })

  it('未知英文值运行时兜底大纲', () => {
    expect(toKindCn('mystery' as ArtifactKind)).toBe('大纲')
  })
})
