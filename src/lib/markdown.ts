/** 轻量 Markdown → HTML 渲染器（零依赖，覆盖工作台文档所需子集） */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inline(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code class="md-code">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
}

/** 渲染为 HTML 字符串；支持标题/列表/引用/表格/代码块/分割线/段落 */
export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let inCode = false
  let listType: 'ul' | 'ol' | null = null
  let inTable = false

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`)
      listType = null
    }
  }
  const closeTable = () => {
    if (inTable) {
      out.push('</tbody></table>')
      inTable = false
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.trim().startsWith('```')) {
      closeList()
      closeTable()
      if (inCode) {
        out.push('</code></pre>')
        inCode = false
      } else {
        out.push('<pre class="md-pre"><code>')
        inCode = true
      }
      continue
    }
    if (inCode) {
      out.push(escapeHtml(line) + '\n')
      continue
    }

    const trimmed = line.trim()
    if (!trimmed) {
      closeList()
      closeTable()
      continue
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed)
    if (heading) {
      closeList()
      closeTable()
      const level = heading[1].length
      out.push(`<h${level} class="md-h${level}">${inline(heading[2])}</h${level}>`)
      continue
    }

    if (/^(---|\*\*\*)$/.test(trimmed)) {
      closeList()
      closeTable()
      out.push('<hr class="md-hr" />')
      continue
    }

    if (trimmed.startsWith('> ')) {
      closeList()
      closeTable()
      out.push(`<blockquote class="md-quote">${inline(trimmed.slice(2))}</blockquote>`)
      continue
    }

    // 表格：| a | b | 形式
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed.slice(1, -1).split('|').map((c) => c.trim())
      const isSep = cells.every((c) => /^:?-{2,}:?$/.test(c))
      if (isSep) continue
      if (!inTable) {
        closeList()
        out.push('<table class="md-table"><thead><tr>')
        out.push(cells.map((c) => `<th>${inline(c)}</th>`).join(''))
        out.push('</tr></thead><tbody>')
        inTable = true
      } else {
        out.push(`<tr>${cells.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
      }
      continue
    }
    closeTable()

    const ul = /^[-*]\s+(.*)$/.exec(trimmed)
    const ol = /^(\d+)[.、]\s+(.*)$/.exec(trimmed)
    if (ul) {
      if (listType !== 'ul') {
        closeList()
        out.push('<ul class="md-ul">')
        listType = 'ul'
      }
      out.push(`<li>${inline(ul[1])}</li>`)
      continue
    }
    if (ol) {
      if (listType !== 'ol') {
        closeList()
        out.push('<ol class="md-ol">')
        listType = 'ol'
      }
      out.push(`<li>${inline(ol[2])}</li>`)
      continue
    }
    closeList()
    out.push(`<p class="md-p">${inline(trimmed)}</p>`)
  }

  closeList()
  closeTable()
  if (inCode) out.push('</code></pre>')
  return out.join('\n')
}
