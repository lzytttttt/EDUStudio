/**
 * v1.2 M0 · 交付物类型映射（纯函数；roadmap §3.6(2) 全表）
 *
 * 中文 `ArtifactKindCn`（Director 视图 7 值）↔ 英文 `ArtifactKind`（harness 5 值，v1.1 冻结不改）：
 *   简报 / 摘要 → analysis；讲稿 / 信件 → notice；练习单 / 大纲 → generic；教案 → lessonPlan。
 * 反向只用于展示：文档自带 docKindCn 时优先，否则按 kind 给默认中文名。
 */

import type { ArtifactKind } from '../harness/types'
import type { ArtifactKindCn } from '../harness/director/types'

/** 中文交付物类型 → 英文枚举（§3.6 全表；未知值兜底 generic，保证视图永不断言） */
export function toArtifactKind(kindCn: ArtifactKindCn): ArtifactKind {
  switch (kindCn) {
    case '简报':
    case '摘要':
      return 'analysis'
    case '讲稿':
    case '信件':
      return 'notice'
    case '练习单':
    case '大纲':
      return 'generic'
    case '教案':
      return 'lessonPlan'
    default:
      return 'generic'
  }
}

/** 英文枚举 → 展示用中文名（docKindCn 优先；反向默认：教案/讲稿/摘要/大纲/摘要） */
export function toKindCn(kind: ArtifactKind, docKindCn?: ArtifactKindCn): ArtifactKindCn {
  if (docKindCn) return docKindCn
  switch (kind) {
    case 'lessonPlan':
      return '教案'
    case 'notice':
      return '讲稿'
    case 'analysis':
      return '摘要'
    case 'generic':
      return '大纲'
    case 'report':
      return '摘要'
    default:
      return '大纲'
  }
}
