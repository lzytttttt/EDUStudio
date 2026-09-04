import { describe, expect, it } from 'vitest'
import {
  buildShareUrl, parseShareUrl, snapshotKey, newAnnotationId,
  type ShareAnnotation, type ShareSnapshot,
} from '../lib/share'
import { markdownToWordHtml } from '../lib/exporters'

function makeSnapshot(content: string, annotations?: ShareAnnotation[]): ShareSnapshot {
  return {
    v: 1,
    title: '高一（3）班函数单调性教案',
    kind: 'lessonPlan',
    role: 'teacher',
    content,
    createdAt: 1720000000000,
    author: '教师',
    annotations,
  }
}

describe('分享快照编解码（v0.4 M2①）', () => {
  it('往返：中文 + Markdown + 批注完整还原', async () => {
    const snapshot = makeSnapshot(
      '# 教案\n\n## 教学目标\n\n- 理解单调性定义\n- 会用定义证明**单调性**\n\n| 环节 | 时间 |\n| --- | --- |\n| 导入 | 5min |',
      [
        { id: 'a1', author: '校长', role: 'schoolAdmin', quote: '理解单调性定义', text: '建议补充反例演示', createdAt: 1720000100000 },
      ],
    )
    const res = await buildShareUrl(snapshot)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.url).toContain('#share=')
    const decoded = await parseShareUrl(new URL(res.url).hash)
    expect(decoded).toEqual(snapshot)
  })

  it('无效 hash 返回 null（缺前缀/缺数据/坏 base64/坏 JSON/缺字段）', async () => {
    expect(await parseShareUrl('')).toBeNull()
    expect(await parseShareUrl('#share=')).toBeNull()
    expect(await parseShareUrl('#share=1.')).toBeNull()
    expect(await parseShareUrl('#share=9.abc')).toBeNull()
    expect(await parseShareUrl('#share=1.!!!not-base64!!!')).toBeNull()
    expect(await parseShareUrl('#share=0.%7B%22v%22%3A2%7D')).toBeNull() // v 不匹配
  })

  it('超长内容返回 too-long（降级为导出文件分享）', async () => {
    // 生成远超 8000 字符 URL 的内容
    const big = '很长的教学内容。'.repeat(4000)
    const res = await buildShareUrl(makeSnapshot(big))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('too-long')
  })

  it('snapshotKey 对相同快照稳定、对内容变化敏感', () => {
    const a = makeSnapshot('内容A')
    const b = makeSnapshot('内容A')
    const c = makeSnapshot('内容B')
    expect(snapshotKey(a)).toBe(snapshotKey(b))
    expect(snapshotKey(a)).not.toBe(snapshotKey(c))
  })

  it('newAnnotationId 唯一性', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newAnnotationId()))
    expect(ids.size).toBe(50)
  })
})

describe('导出增强（v0.4 M2④ + M2② 批注附带）', () => {
  it('Word HTML 含封面（标题/署名/日期）与页眉行', () => {
    const html = markdownToWordHtml('# 正文', '测试文档', { author: '高一教研组' })
    expect(html).toContain('cover-title')
    expect(html).toContain('测试文档')
    expect(html).toContain('高一教研组')
    expect(html).toContain('header-band')
    expect(html).toContain('@page')
  })

  it('批注非空时附加评审批注章节，含引用与作者', () => {
    const html = markdownToWordHtml('# 正文', '测试文档', {
      annotations: [{ id: 'a1', author: '校长', role: 'schoolAdmin', quote: '目标表述', text: '建议可测量化', createdAt: 1720000100000 }],
    })
    expect(html).toContain('评审批注（1 条）')
    expect(html).toContain('「目标表述」')
    expect(html).toContain('建议可测量化')
    expect(html).toContain('校长')
  })

  it('批注为空时不附加批注章节', () => {
    const html = markdownToWordHtml('# 正文', '测试文档', { annotations: [] })
    expect(html).not.toContain('评审批注')
  })
})
