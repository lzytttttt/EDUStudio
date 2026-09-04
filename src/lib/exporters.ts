/**
 * 文档导出（v0.3 专项 ②）
 * - md：直接下载 Markdown 源文件
 * - docx：以 Word 兼容 HTML（MHTML 简化版）生成 .doc 文件，Word/WPS 可直接打开
 * - pdf：调用浏览器打印（另存为 PDF）
 */

export type ExportFormat = 'md' | 'docx' | 'pdf'

/** 文件名清洗：去非法字符，限长 60 */
export function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\r\n]/g, '').trim()
  return (cleaned || '未命名文档').slice(0, 60)
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Markdown → Word 兼容 HTML（保留标题/列表/加粗/表格等基本结构） */
export function markdownToWordHtml(md: string, title: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')

  const lines = md.split('\n')
  const out: string[] = []
  let inList = false
  let inTable = false

  const closeList = () => {
    if (inList) {
      out.push('</ul>')
      inList = false
    }
  }
  const closeTable = () => {
    if (inTable) {
      out.push('</tbody></table>')
      inTable = false
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (/^\s*[-*]\s+/.test(line)) {
      closeTable()
      if (!inList) {
        out.push('<ul>')
        inList = true
      }
      out.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`)
      continue
    }
    if (/^\s*\d+[.、]\s*/.test(line)) {
      closeTable()
      if (!inList) {
        out.push('<ul>')
        inList = true
      }
      out.push(`<li>${inline(line.replace(/^\s*\d+[.、]\s*/, ''))}</li>`)
      continue
    }
    closeList()
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line.trim().slice(1, -1).split('|')
      if (cells.every((c) => /^\s*:?-{2,}:?\s*$/.test(c))) continue // 分隔行
      if (!inTable) {
        out.push('<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse">')
        out.push('<tbody>')
        inTable = true
      }
      out.push(`<tr>${cells.map((c) => `<td>${inline(c.trim())}</td>`).join('')}</tr>`)
      continue
    }
    closeTable()
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      const level = h[1].length
      out.push(`<h${level}>${inline(h[2])}</h${level}>`)
      continue
    }
    if (line.trim() === '') {
      out.push('<p></p>')
      continue
    }
    out.push(`<p>${inline(line)}</p>`)
  }
  closeList()
  closeTable()

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:"Microsoft YaHei",SimSun,sans-serif;font-size:12pt;line-height:1.8}h1{font-size:18pt}h2{font-size:15pt}h3{font-size:13pt}table td{border:1px solid #999}</style>
</head><body>${out.join('\n')}</body></html>`
}

/** 导出文档：md 直接下载；docx 生成 Word 兼容文件；pdf 走打印 */
export function exportDoc(md: string, title: string, format: ExportFormat): void {
  const filename = sanitizeFilename(title)
  if (format === 'md') {
    downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), `${filename}.md`)
    return
  }
  if (format === 'docx') {
    const html = markdownToWordHtml(md, filename)
    // Word 兼容：以 .doc 扩展名携带 HTML 内容，Word/WPS 打开时自动按文档渲染
    downloadBlob(new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' }), `${filename}.doc`)
    return
  }
  // pdf：打印当前文档（用户在打印对话框中选择「另存为 PDF」）
  const w = window.open('', '_blank', 'width=820,height=900')
  if (!w) return
  w.document.write(markdownToWordHtml(md, filename))
  w.document.close()
  w.focus()
  w.print()
}
