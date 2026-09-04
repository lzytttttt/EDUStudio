import { describe, expect, it } from 'vitest'
import { sanitizeFilename, markdownToWordHtml } from '../lib/exporters'

describe('sanitizeFilename', () => {
  it('去除非法字符', () => {
    expect(sanitizeFilename('教案: 《摩擦力》/v1?')).toBe('教案 《摩擦力》v1')
  })

  it('空名回退默认名', () => {
    expect(sanitizeFilename('   ')).toBe('未命名文档')
  })

  it('限长 60 字符', () => {
    expect(sanitizeFilename('长'.repeat(100)).length).toBe(60)
  })
})

describe('markdownToWordHtml', () => {
  it('标题/列表/加粗转换', () => {
    const html = markdownToWordHtml('# 标题\n- 要点**加粗**', '测试')
    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<strong>加粗</strong>')
  })

  it('表格转换', () => {
    const html = markdownToWordHtml('| a | b |\n| --- | --- |\n| 1 | 2 |', 't')
    expect(html).toContain('<table')
    expect(html).toContain('<td>1</td>')
  })

  it('HTML 特殊字符转义', () => {
    const html = markdownToWordHtml('a < b & c', 't')
    expect(html).toContain('a &lt; b &amp; c')
  })
})
