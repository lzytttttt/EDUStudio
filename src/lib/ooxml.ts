/**
 * 最小 OOXML 封装（v0.9.5 P2-A/B，零依赖）
 *
 * docx / xlsx 本质是 zip 容器。引入 docx.js 或 JSZip 约 +30~50KB gzip，
 * 而包体门禁是 CI 硬门禁——所以按本项目一贯取向（自研 Markdown 渲染器、自研 zip）
 * 手写最小实现：STORE（不压缩）存储 + CRC32 + 四个骨架 XML。
 *
 * 只覆盖「Markdown → Word 文档」「二维表 → Excel 工作表」这条导出路径所需的子集，
 * 不做样式系统、不做共享字符串池、不做多工作表。
 */

/* ---------- CRC32 ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/* ---------- UTF-8 ---------- */

const encoder = new TextEncoder()

/* ---------- zip（STORE） ---------- */

/** DOS 时间戳字段：固定值，保证同一输入产出同一字节，便于测试与去重 */
const DOS_TIME = 0
const DOS_DATE = 0x21 // 1980-01-01

interface ZipEntry {
  name: string
  data: Uint8Array
}

/** 单文件 zip 记录：local header + 裸数据 */
function localRecord(name: string, data: Uint8Array): Uint8Array {
  const nameBytes = encoder.encode(name)
  const rec = new Uint8Array(30 + nameBytes.length + data.length)
  const dv = new DataView(rec.buffer)
  dv.setUint32(0, 0x04034b50, true) // local file header signature
  dv.setUint16(4, 20, true) // version needed
  dv.setUint16(6, 0, true) // flags
  dv.setUint16(8, 0, true) // method 0 = STORE
  dv.setUint16(10, DOS_TIME, true)
  dv.setUint16(12, DOS_DATE, true)
  dv.setUint32(14, crc32(data), true)
  dv.setUint32(18, data.length, true) // compressed size
  dv.setUint32(22, data.length, true) // uncompressed size
  dv.setUint16(26, nameBytes.length, true)
  dv.setUint16(28, 0, true) // extra length
  rec.set(nameBytes, 30)
  rec.set(data, 30 + nameBytes.length)
  return rec
}

/** 中央目录记录 */
function centralRecord(name: string, data: Uint8Array, offset: number): Uint8Array {
  const nameBytes = encoder.encode(name)
  const rec = new Uint8Array(46 + nameBytes.length)
  const dv = new DataView(rec.buffer)
  dv.setUint32(0, 0x02014b50, true) // central directory signature
  dv.setUint16(4, 20, true) // version made by
  dv.setUint16(6, 20, true) // version needed
  dv.setUint16(8, 0, true) // flags
  dv.setUint16(10, 0, true) // method
  dv.setUint16(12, DOS_TIME, true)
  dv.setUint16(14, DOS_DATE, true)
  dv.setUint32(16, crc32(data), true)
  dv.setUint32(20, data.length, true)
  dv.setUint32(24, data.length, true)
  dv.setUint16(28, nameBytes.length, true)
  dv.setUint16(30, 0, true) // extra
  dv.setUint16(32, 0, true) // comment
  dv.setUint16(34, 0, true) // disk number
  dv.setUint16(36, 0, true) // internal attrs
  dv.setUint32(38, 0, true) // external attrs
  dv.setUint32(42, offset, true) // local header offset
  rec.set(nameBytes, 46)
  return rec
}

/** EOCD（中央目录结尾） */
function eocd(count: number, dirSize: number, dirOffset: number): Uint8Array {
  const rec = new Uint8Array(22)
  const dv = new DataView(rec.buffer)
  dv.setUint32(0, 0x06054b50, true) // EOCD signature
  dv.setUint16(4, 0, true)
  dv.setUint16(6, 0, true)
  dv.setUint16(8, count, true)
  dv.setUint16(10, count, true)
  dv.setUint32(12, dirSize, true)
  dv.setUint32(16, dirOffset, true)
  dv.setUint16(20, 0, true) // comment length
  return rec
}

/** 打包为 zip 字节流（STORE，无压缩） */
export function zip(entries: ZipEntry[]): Uint8Array {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const e of entries) {
    const local = localRecord(e.name, e.data)
    locals.push(local)
    centrals.push(centralRecord(e.name, e.data, offset))
    offset += local.length
  }
  const dirSize = centrals.reduce((n, c) => n + c.length, 0)
  const total = offset + dirSize + 22
  const out = new Uint8Array(total)
  let p = 0
  for (const l of locals) {
    out.set(l, p)
    p += l.length
  }
  for (const c of centrals) {
    out.set(c, p)
    p += c.length
  }
  out.set(eocd(entries.length, dirSize, offset), p)
  return out
}

/** zip 字节流 → Blob（走 Blob 而不是 data URI，大文件下内存与编码都更稳） */
export function zipBlob(entries: ZipEntry[], mime: string): Blob {
  return new Blob([zip(entries) as BlobPart], { type: mime })
}

/* ---------- OOXML 公共骨架 ---------- */

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

/** XML 文本转义：OOXML 里 & < > 与控制字符都必须处理，否则 Word 直接报文件损坏 */
export function xmlEscape(s: string): string {
  return s
    .replace(/[\u0000-\b\u000b\f\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Content_Types：docx 与 xlsx 的 Override 清单不同 */
function contentTypes(overrides: { part: string; type: string }[]): string {
  return (
    XML_HEAD +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    overrides.map((o) => `<Override PartName="${o.part}" ContentType="${o.type}"/>`).join('') +
    '</Types>'
  )
}

/** 包根关系：rId1 指向主文档部件（docx 是 word/document.xml，xlsx 是 xl/workbook.xml） */
function rootRels(target: string): string {
  return (
    XML_HEAD +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${target}"/>` +
    '</Relationships>'
  )
}

/* ---------- docx ---------- */

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

/** 段落样式：只用内置样式 id，避免引入 styles.xml */
export type ParaStyle = 'Title' | 'Heading1' | 'Heading2' | 'Heading3' | 'Heading4' | 'Quote' | 'Caption'

export interface DocxBlock {
  kind: 'p' | 'h' | 'table'
  /** p：文本（已含行内标记转义结果）；h：级别 1~4 */
  level?: number
  /** h：显式指定样式，优先于 level 推导（封面标题用 Title 而非 Heading1） */
  style?: ParaStyle
  text?: string
  runs?: DocxRun[]
  rows?: string[][]
  /** 表格首行是否为表头 */
  headerRow?: boolean
}

export interface DocxRun {
  text: string
  bold?: boolean
}

/** 文本 → 段落 XML */
function paragraph(runs: DocxRun[], style?: ParaStyle): string {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''
  const body = runs
    .map(
      (r) =>
        `<w:r>${r.bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${xmlEscape(r.text)}</w:t></w:r>`,
    )
    .join('')
  return `<w:p>${pPr}${body || '<w:r><w:t/></w:r>'}</w:p>`
}

/**
 * 表格 XML。
 * 每格一个段落；表头行加 tblHeader，跨页时表头会重复——这是 Word 表格可读性的关键。
 * tblW 用 pct 5000（100%）：固定像素宽在 Word 里容易溢出页面。
 */
function table(rows: string[][], headerRow: boolean): string {
  const cell = (text: string, isHeader: boolean) =>
    `<w:tc><w:tcPr>${isHeader ? '<w:shd w:val="clear" w:fill="F2F2F2"/>' : ''}</w:tcPr>${paragraph(
      [{ text, bold: isHeader }],
    )}</w:tc>`
  const tr = (row: string[], isHeader: boolean) =>
    `<w:tr>${isHeader ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${row.map((c) => cell(c, isHeader)).join('')}</w:tr>`
  return (
    '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>' +
    '<w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`)
      .join('') +
    '</w:tblBorders></w:tblPr>' +
    rows.map((r, i) => tr(r, headerRow && i === 0)).join('') +
    '</w:tbl>'
  )
}

/** 块序列 → word/document.xml */
export function docxDocument(blocks: DocxBlock[]): string {
  const styles: ParaStyle[] = ['Heading1', 'Heading2', 'Heading3', 'Heading4']
  const body = blocks
    .map((b) => {
      if (b.kind === 'table') return table(b.rows ?? [], b.headerRow !== false)
      if (b.kind === 'h') {
        return paragraph([{ text: b.text ?? '' }], b.style ?? styles[Math.min((b.level ?? 1) - 1, 3)])
      }
      return paragraph(b.runs ?? [{ text: b.text ?? '' }])
    })
    .join('')
  return (
    XML_HEAD +
    `<w:document ${W_NS}><w:body>${body}` +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr>' +
    '</w:body></w:document>'
  )
}

/** 打包 .docx（Word/WPS 打开无「格式与扩展名不匹配」提示） */
export function buildDocx(blocks: DocxBlock[]): Blob {
  const doc = encoder.encode(docxDocument(blocks))
  return zipBlob(
    [
      { name: '[Content_Types].xml', data: encoder.encode(contentTypes([{ part: '/word/document.xml', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml' }])) },
      { name: '_rels/.rels', data: encoder.encode(rootRels('word/document.xml')) },
      { name: 'word/document.xml', data: doc },
    ],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  )
}

/* ---------- xlsx ---------- */

const S_NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'

/** 列名：0 → A，26 → AA */
export function colName(i: number): string {
  let s = ''
  let n = i
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  }
  return s
}

/** 单元格值 → `<c>`：数字存数值型，字符串走 inlineStr（免共享字符串表） */
function xlsxCell(ref: string, value: string | number): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(value))}</t></is></c>`
}

/** 二维表 → xl/worksheets/sheet1.xml */
export function xlsxSheet(rows: (string | number)[][]): string {
  const body = rows
    .map((row, r) => `<row r="${r + 1}">${row.map((v, c) => xlsxCell(`${colName(c)}${r + 1}`, v)).join('')}</row>`)
    .join('')
  return XML_HEAD + `<worksheet ${S_NS}><sheetData>${body}</sheetData></worksheet>`
}

/** 打包 .xlsx（单工作表） */
export function buildXlsx(rows: (string | number)[][], sheetName = 'Sheet1'): Blob {
  const XL_RELS =
    XML_HEAD +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>'
  const WORKBOOK =
    XML_HEAD +
    `<workbook ${S_NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`
  const WORKBOOK_RELS =
    XML_HEAD +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '</Relationships>'
  return zipBlob(
    [
      {
        name: '[Content_Types].xml',
        data: encoder.encode(
          contentTypes([
            { part: '/xl/workbook.xml', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml' },
            { part: '/xl/worksheets/sheet1.xml', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml' },
          ]),
        ),
      },
      { name: '_rels/.rels', data: encoder.encode(rootRels('xl/workbook.xml')) },
      { name: 'xl/workbook.xml', data: encoder.encode(WORKBOOK) },
      { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(WORKBOOK_RELS) },
      { name: 'xl/worksheets/sheet1.xml', data: encoder.encode(xlsxSheet(rows)) },
    ],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
}
