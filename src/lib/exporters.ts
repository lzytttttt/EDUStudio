/**
 * 文档导出（v0.3 专项 ② → v0.4 M2④ 增强 → v0.5 M5③ 水印）
 * - md：直接下载 Markdown 源文件
 * - docx：以 Word 兼容 HTML（MHTML 简化版）生成 .doc 文件，Word/WPS 可直接打开；
 *   v0.4 升级：封面（标题/作者/日期）、页眉行、精修样式、可选附带评审批注
 * - pdf：调用浏览器打印（另存为 PDF），print CSS 精修（A4 页边距、分页保护）
 * - v0.5 M5③：可选「机构 · 人员 · 日期」页脚水印（设置中开启后默认生效）
 */
import type { ShareAnnotation } from './share'
import { useSettingsStore } from '../stores/settingsStore'

export type ExportFormat = 'md' | 'docx' | 'pdf'

export interface ExportWatermark {
  org: string
  person: string
}

export interface ExportOptions {
  /** 封面署名（作者/单位） */
  author?: string
  /** 评审批注：非空时在文末附加「评审批注」章节（v0.4 M2②） */
  annotations?: ShareAnnotation[]
  /** 页脚水印（v0.5 M5③）：不传时读取设置中的水印开关 */
  watermark?: ExportWatermark
}

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

function fmtDate(ts?: number): string {
  const d = ts ? new Date(ts) : new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()} 年 ${pad(d.getMonth() + 1)} 月 ${pad(d.getDate())} 日`
}

/** 批注 → Word 兼容 HTML 附录（v0.4 M2②：导出可选附带） */
function annotationsHtml(annotations: ShareAnnotation[]): string {
  if (!annotations.length) return ''
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const items = annotations
    .map(
      (a) =>
        `<div class="anno-item"><p class="anno-meta">${esc(a.author)} · ${fmtDate(a.createdAt)}</p>` +
        (a.quote ? `<blockquote class="anno-quote">「${esc(a.quote)}」</blockquote>` : '') +
        `<p>${esc(a.text)}</p></div>`,
    )
    .join('\n')
  return `<h1 style="page-break-before:always">评审批注（${annotations.length} 条）</h1>\n${items}`
}

/** Markdown → Word 兼容 HTML（保留标题/列表/加粗/表格等基本结构；v0.4 增加封面/页眉/批注附录） */
export function markdownToWordHtml(md: string, title: string, options: ExportOptions = {}): string {
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

  // 封面（v0.4 M2④）：标题居中 + 署名/日期 + 分隔线
  const cover = [
    '<div class="cover">',
    `<div class="cover-title">${esc(title)}</div>`,
    `<div class="cover-meta">${esc(options.author ?? '智教工坊 · EDUStudio')} · ${fmtDate()}</div>`,
    '<hr class="cover-rule" />',
    '</div>',
  ].join('\n')

  // 页眉行（Word 兼容 HTML 的 mso 页眉易失效，采用文档首行页眉带，打印同样可见）
  const headerBand = `<div class="header-band"><span>${esc(title)}</span><span>智教工坊 · EDUStudio · 教育智能工作台</span></div>`

  // 页脚水印（v0.5 M5③）：机构 · 人员 · 日期
  const wm = options.watermark
  const watermarkFooter = wm
    ? `<div class="wm-footer">水印：${esc(wm.org || '—')} · ${esc(wm.person || '—')} · ${fmtDate()}</div>`
    : ''

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
body{font-family:"Microsoft YaHei",SimSun,sans-serif;font-size:12pt;line-height:1.8;color:#26221d}
h1{font-size:18pt}h2{font-size:15pt}h3{font-size:13pt}
table td{border:1px solid #999}
.cover{text-align:center;margin:24pt 0 18pt}
.cover-title{font-size:22pt;font-weight:bold;letter-spacing:1pt}
.cover-meta{margin-top:10pt;font-size:10.5pt;color:#6b6660}
.cover-rule{border:none;border-top:2px solid #4f46e5;width:30%;margin:14pt auto 0}
.header-band{display:flex;justify-content:space-between;font-size:9pt;color:#a8a39d;border-bottom:1px solid #ece8e2;padding-bottom:6pt;margin-bottom:14pt}
blockquote.anno-quote{margin:4pt 0;padding:4pt 10pt;border-left:3px solid #4f46e5;background:#eef2ff;color:#6b6660;font-size:10.5pt}
.anno-item{margin:10pt 0;padding:8pt 12pt;border:1px solid #ece8e2;border-radius:6pt;background:#fafaf8}
.anno-meta{font-size:9.5pt;color:#a8a39d;margin:0 0 4pt}
.wm-footer{margin-top:18pt;padding-top:8pt;border-top:1px solid #ece8e2;font-size:9pt;color:#a8a39d;text-align:center}
@page{size:A4;margin:2cm 1.8cm}
@media print{.header-band{position:fixed;top:0}.wm-footer{position:fixed;bottom:0;left:0;right:0;background:#fff}}
</style>
</head><body>${headerBand}\n${cover}\n${out.join('\n')}\n${annotationsHtml(options.annotations ?? [])}\n${watermarkFooter}</body></html>`
}

/** 导出文档：md 直接下载；docx 生成 Word 兼容文件；pdf 走打印（可附带批注/水印） */
export function exportDoc(md: string, title: string, format: ExportFormat, options: ExportOptions = {}): void {
  // 水印（v0.5 M5③）：调用方未显式指定时，读取设置中的水印开关
  const wmSettings = useSettingsStore.getState().watermark
  const watermark: ExportWatermark | undefined =
    options.watermark ?? (wmSettings.enabled ? { org: wmSettings.org, person: wmSettings.person } : undefined)
  const opts: ExportOptions = { ...options, watermark }
  const filename = sanitizeFilename(title)
  if (format === 'md') {
    downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), `${filename}.md`)
    return
  }
  if (format === 'docx') {
    const html = markdownToWordHtml(md, filename, opts)
    // Word 兼容：以 .doc 扩展名携带 HTML 内容，Word/WPS 打开时自动按文档渲染
    downloadBlob(new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' }), `${filename}.doc`)
    return
  }
  // pdf：打印当前文档（用户在打印对话框中选择「另存为 PDF」）
  const w = window.open('', '_blank', 'width=820,height=900')
  if (!w) return
  w.document.write(markdownToWordHtml(md, filename, opts))
  w.document.close()
  w.focus()
  w.print()
}
