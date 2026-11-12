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

  /* v0.9.5 P0-C：报告数字的 hover 溯源 */
  it('数字溯源标记渲染为带 title 的 span', () => {
    const html = renderMarkdown('综合指数 {{86.4~演示数据 · 1 天前}}，环比 {{+1.6~演示数据 · 1 天前}}。')
    expect(html).toContain('<span class="md-cite" title="演示数据 · 1 天前">86.4</span>')
    expect(html).toContain('>+1.6</span>')
    expect(html).not.toContain('{{')
  })

  it('溯源标记在表格单元格内不被拆列', () => {
    const html = renderMarkdown('| 指标 | 现状 |\n| --- | --- |\n| 优良率 | {{62.7%~区域数据平台}} |')
    expect(html).toContain('<th>指标</th><th>现状</th>')
    expect(html).toContain('<span class="md-cite" title="区域数据平台">62.7%</span>')
  })

  it('来源文案中的行内标记不会被二次解析、污染 title', () => {
    const html = renderMarkdown('{{86.4~**来源**：数据平台}}')
    expect(html).toContain('title="**来源**：数据平台"')
    expect(html).not.toContain('<strong>来源</strong>：数据平台"')
  })

  it('溯源标记的 title 对引号做转义，不破坏属性', () => {
    const html = renderMarkdown('{{1~a" onmouseover="x}}')
    expect(html).toContain('title="a&quot; onmouseover=&quot;x"')
    expect(html).not.toContain('onmouseover="x"')
  })
})
