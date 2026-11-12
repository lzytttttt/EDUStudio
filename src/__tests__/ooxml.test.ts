import { describe, expect, it } from 'vitest'
import {
  zip,
  colName,
  xmlEscape,
  docxDocument,
  xlsxSheet,
  buildDocx,
  buildXlsx,
} from '../lib/ooxml'
import { docxBlocks, markdownTable, inlineRuns } from '../lib/exporters'

/* v0.9.5 P2：手写 zip + 最小 OOXML。真正的风险是「打包出来 Word 打不开」，
   所以这里按 zip 规范逐字段核对，而不是只断言「有输出」。 */

const dec = new TextDecoder()

function u16(b: Uint8Array, o: number): number {
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint16(o, true)
}
function u32(b: Uint8Array, o: number): number {
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(o, true)
}

/** 解析 zip 中央目录，返回条目名 → 载荷（校验 EOCD 与 local header 是否自洽） */
function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const eocdSig = 0x06054b50
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (u32(bytes, i) === eocdSig) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('no EOCD')
  const count = u16(bytes, eocd + 10)
  let p = u32(bytes, eocd + 16)
  const out = new Map<string, Uint8Array>()
  for (let n = 0; n < count; n++) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error(`bad central header at ${p}`)
    const method = u16(bytes, p + 10)
    if (method !== 0) throw new Error('expected STORE method')
    const size = u32(bytes, p + 24)
    const nameLen = u16(bytes, p + 28)
    const extraLen = u16(bytes, p + 30)
    const commentLen = u16(bytes, p + 32)
    const localOff = u32(bytes, p + 42)
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen))

    if (u32(bytes, localOff) !== 0x04034b50) throw new Error(`bad local header for ${name}`)
    const localNameLen = u16(bytes, localOff + 26)
    const localExtraLen = u16(bytes, localOff + 28)
    const dataStart = localOff + 30 + localNameLen + localExtraLen
    if (dataStart + size > bytes.length) throw new Error(`truncated data for ${name}`)
    out.set(name, bytes.subarray(dataStart, dataStart + size))

    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

describe('zip（STORE）', () => {
  it('多条目打包后中央目录可解析，local header 偏移自洽', () => {
    const zipBytes = zip([
      { name: 'a.xml', data: new TextEncoder().encode('<a/>') },
      { name: 'dir/b.xml', data: new TextEncoder().encode('<b>内容</b>') },
    ])
    const files = readZip(zipBytes)
    expect([...files.keys()]).toEqual(['a.xml', 'dir/b.xml'])
    expect(dec.decode(files.get('dir/b.xml')!)).toBe('<b>内容</b>')
  })

  it('单条目时 EOCD 紧跟数据，字节数精确', () => {
    const data = new TextEncoder().encode('hello')
    const bytes = zip([{ name: 'x', data }])
    /* 30 local header + 1 name + 5 data + 46 central + 1 name + 22 EOCD */
    expect(bytes.length).toBe(30 + 1 + 5 + 46 + 1 + 22)
  })

  it('空条目列表产出合法空包', () => {
    expect(() => readZip(zip([]))).not.toThrow()
  })
})

describe('xmlEscape', () => {
  it('转义五个 XML 敏感字符', () => {
    expect(xmlEscape(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;')
  })

  it('剔除 XML 非法控制字符，保留制表与换行', () => {
    const dirty = `a${String.fromCharCode(0, 11, 12)}b\tc\nd`
    expect(xmlEscape(dirty)).toBe('ab\tc\nd')
  })
})

describe('colName', () => {
  it('0→A、25→Z、26→AA、27→AB、51→AZ、52→BA、701→ZZ、702→AAA', () => {
    expect([0, 25, 26, 27, 51, 52, 701, 702].map(colName)).toEqual([
      'A', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA',
    ])
  })
})

describe('buildDocx', () => {
  it('包内含 Word 必需的三个部件', async () => {
    const files = readZip(new Uint8Array(await buildDocx([{ kind: 'p', text: '正文' }]).arrayBuffer()))
    expect([...files.keys()].sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'word/document.xml',
    ])
  })

  it('Content_Types 声明 wordprocessingml 主文档类型', async () => {
    const files = readZip(new Uint8Array(await buildDocx([{ kind: 'p', text: 'x' }]).arrayBuffer()))
    const ct = dec.decode(files.get('[Content_Types].xml')!)
    expect(ct).toContain('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')
    expect(ct).toContain('PartName="/word/document.xml"')
  })

  it('根关系指向 word/document.xml', async () => {
    const files = readZip(new Uint8Array(await buildDocx([{ kind: 'p', text: 'x' }]).arrayBuffer()))
    expect(dec.decode(files.get('_rels/.rels')!)).toContain('Target="word/document.xml"')
  })

  it('标题映射到内置样式：显式 style 优先，否则按 markdown 层级推导', () => {
    const xml = docxDocument([
      { kind: 'h', level: 1, style: 'Title', text: '封面' },
      { kind: 'h', level: 2, text: '一节' },
      { kind: 'h', level: 3, text: '二节' },
    ])
    expect(xml).toContain('<w:pStyle w:val="Title"/>')
    expect(xml).toContain('<w:pStyle w:val="Heading2"/>')
    expect(xml).toContain('<w:pStyle w:val="Heading3"/>')
  })

  it('表格带边框与重复表头行', () => {
    const xml = docxDocument([{ kind: 'table', rows: [['指标', '值'], ['优良率', '62.7%']], headerRow: true }])
    expect(xml).toContain('<w:tblBorders>')
    expect(xml).toContain('<w:tblHeader/>')
    expect(xml).toContain('62.7%')
  })

  it('加粗 run 带 w:b', () => {
    expect(docxDocument([{ kind: 'p', runs: [{ text: '重点', bold: true }] }])).toContain('<w:b/>')
  })
})

describe('buildXlsx', () => {
  it('包内含工作簿、工作表与两级关系', async () => {
    const files = readZip(new Uint8Array(await buildXlsx([['a', 'b']]).arrayBuffer()))
    expect([...files.keys()].sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ])
  })

  it('根关系指向 xl/workbook.xml，工作簿关系指向工作表', async () => {
    const files = readZip(new Uint8Array(await buildXlsx([['a']]).arrayBuffer()))
    expect(dec.decode(files.get('_rels/.rels')!)).toContain('Target="xl/workbook.xml"')
    expect(dec.decode(files.get('xl/_rels/workbook.xml.rels')!)).toContain('Target="worksheets/sheet1.xml"')
  })

  it('单元格坐标按行列递增，数字存数值型', () => {
    const xml = xlsxSheet([
      ['指标', '值'],
      ['优良率', 62.7],
    ])
    expect(xml).toContain('<c r="A1" t="inlineStr">')
    expect(xml).toContain('<c r="B2"><v>62.7</v></c>')
    expect(xml).toContain('<row r="2">')
  })
})

describe('inlineRuns', () => {
  it('数字溯源标记退化为纯文本，加粗被拆成独立 run', () => {
    expect(inlineRuns('综合指数 {{86.4~演示数据}} 与 **重点**')).toEqual([
      { text: '综合指数 86.4 与 ', bold: false },
      { text: '重点', bold: true },
    ])
  })
})

describe('docxBlocks · Markdown → OOXML', () => {
  const md = `# 标题

## 一节

- 要点 **加粗**
1. 第一步

| 指标 | 值 |
| --- | --- |
| 优良率 | 62.7% |

> 提示

---

结尾段落`

  it('封面标题在前（Title 样式），正文同名 h1 被跳过（不重复）', () => {
    const blocks = docxBlocks(md, '标题')
    expect(blocks[0]).toEqual({ kind: 'h', level: 1, style: 'Title', text: '标题' })
    expect(blocks.filter((b) => b.kind === 'h' && b.level === 1)).toHaveLength(1)
    const xml = docxDocument(blocks)
    expect(xml).toContain('<w:pStyle w:val="Title"/>')
    expect(xml).toContain('<w:pStyle w:val="Heading2"/>')
  })

  it('标题层级、列表、表格、引用都落到对应块', () => {
    const blocks = docxBlocks(md, '标题')
    expect(blocks.some((b) => b.kind === 'h' && b.level === 2 && b.text === '一节')).toBe(true)
    expect(blocks.some((b) => b.kind === 'table' && b.rows?.[0]?.[0] === '指标')).toBe(true)
    expect(blocks.some((b) => b.kind === 'p' && (b.runs ?? []).some((r) => r.text.startsWith('· 要点')))).toBe(true)
    expect(blocks.some((b) => b.kind === 'p' && (b.runs ?? []).some((r) => r.text.includes('「 提示」')))).toBe(true)
  })

  it('表格分隔行不进入 docx', () => {
    const table = docxBlocks(md, '标题').find((b) => b.kind === 'table')
    expect(table?.rows).toEqual([
      ['指标', '值'],
      ['优良率', '62.7%'],
    ])
  })

  it('水印与批注附录进正文', () => {
    const blocks = docxBlocks(md, '标题', {
      watermark: { org: '区教育局', person: '李老师' },
      annotations: [{ id: 'a1', author: '王芳', text: '建议补充数据', createdAt: 1_700_000_000_000 }],
    } as never)
    expect(blocks.some((b) => b.kind === 'p' && b.text?.includes('水印：区教育局'))).toBe(true)
    expect(blocks.some((b) => b.kind === 'h' && b.text === '评审批注（1 条）')).toBe(true)
  })
})

describe('markdownTable · Markdown → xlsx', () => {
  it('取行数最多的表，数字与百分比转数值型', () => {
    expect(markdownTable('| 维度 | 现状 | 环比 |\n| --- | --- | --- |\n| 优良率 | 62.7% | -0.8 |')).toEqual([
      ['维度', '现状', '环比'],
      ['优良率', 62.7, -0.8],
    ])
  })

  it('千分位逗号被清理后转数值', () => {
    expect(markdownTable('| 项目 | 值 |\n| --- | --- |\n| 节数 | 1,240 |')).toEqual([
      ['项目', '值'],
      ['节数', 1240],
    ])
  })

  it('非数字文本保持字符串', () => {
    expect(markdownTable('| 班级 | 均分 |\n| --- | --- |\n| 高一（7）班 | 74.1 |')[1]).toEqual(['高一（7）班', 74.1])
  })

  it('没有表格时把段落铺成单列，且剥掉标题与溯源标记', () => {
    const rows = markdownTable('## 一节\n\n综合指数 {{86.4~演示数据}}\n\n## 二节\n\n结尾')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.length === 1)).toBe(true)
    expect(rows.map((r) => r[0])).toContain('综合指数 86.4')
  })
})
