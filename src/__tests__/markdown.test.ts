import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../lib/markdown'

describe('renderMarkdown', () => {
  it('标题 h1-h4 带语义类名', () => {
    const html = renderMarkdown('# 一\n## 二\n### 三\n#### 四')
    expect(html).toContain('<h1 class="md-h1">一</h1>')
    expect(html).toContain('<h2 class="md-h2">二</h2>')
    expect(html).toContain('<h3 class="md-h3">三</h3>')
    expect(html).toContain('<h4 class="md-h4">四</h4>')
  })

  it('无序与有序列表', () => {
    const html = renderMarkdown('- 甲\n- 乙\n\n1. 第一步\n2. 第二步')
    expect(html).toContain('<ul class="md-ul">')
    expect(html).toContain('<li>甲</li>')
    expect(html).toContain('<ol class="md-ol">')
    expect(html).toContain('<li>第二步</li>')
  })

  it('表格：分隔行被跳过，表头与数据行正确', () => {
    const html = renderMarkdown('| 指标 | 值 |\n| --- | --- |\n| 均分 | 86 |')
    expect(html).toContain('<table class="md-table">')
    expect(html).toContain('<th>指标</th>')
    expect(html).toContain('<td>86</td>')
    expect(html).not.toContain('---')
  })

  it('代码块内容转义', () => {
    const html = renderMarkdown('```\n<script>alert(1)</script>\n```')
    expect(html).toContain('<pre class="md-pre">')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('行内语法：加粗/斜体/行内代码/链接', () => {
    const html = renderMarkdown('**重点** 与 *强调* 与 `code` 与 [文档](https://a.b)')
    expect(html).toContain('<strong>重点</strong>')
    expect(html).toContain('<em>强调</em>')
    expect(html).toContain('<code class="md-code">code</code>')
    expect(html).toContain('<a href="https://a.b"')
  })

  it('引用与分割线', () => {
    const html = renderMarkdown('> 提示内容\n\n---')
    expect(html).toContain('<blockquote class="md-quote">提示内容</blockquote>')
    expect(html).toContain('<hr class="md-hr" />')
  })
})
