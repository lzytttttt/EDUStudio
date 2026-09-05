/**
 * 成绩 CSV 导入解析器（v0.5 M1②）
 *
 * 支持两种常见导出格式，列名模糊匹配（大小写/别名/常见变体）：
 * 1. 宽表：一行一个学生，科目为列 —— `姓名,班级,语文,数学,英语,…`
 * 2. 长表：一行一条成绩 —— `班级,科目,分数` 或已聚合的 `科目,平均分,及格率,优秀率`
 *
 * 聚合口径：均分 = 算术平均；及格 = ≥60；优秀 = ≥85（百分制）。
 * 解析失败返回可修正的错误提示；可解析但部分列被忽略时返回 warnings（预览确认用）。
 */
import type { SubjectScore } from '../data/seed'

export interface CsvImportPreview {
  /** 班级名（取自 className 参数 / 班级列 / 文件名） */
  className: string
  /** 数据行数（宽表=学生数；长表=成绩条数） */
  rowCount: number
  scores: SubjectScore[]
  /** 作业完成率（0-100，无该列时为 null） */
  homeworkCompletion: number | null
  /** 解析提示：被忽略的列、跳过的行等 */
  warnings: string[]
  /** 列映射结果（预览展示） */
  columnMap: { column: string; as: string }[]
}

export type CsvParseResult =
  | { ok: true; preview: CsvImportPreview }
  | { ok: false; error: string }

const MAX_ROWS = 5000
const MAX_COLS = 40
const PASS_LINE = 60
const EXCELLENT_LINE = 85

/* ---------- 列名模糊匹配 ---------- */

const ALIAS: Record<string, string[]> = {
  name: ['姓名', '学生', '名字', '学生姓名', 'name', 'student', 'studentname'],
  className: ['班级', '班', 'class', 'classname', 'class_name'],
  subject: ['科目', '学科', 'subject'],
  score: ['分数', '成绩', '得分', '总分', 'score', 'grade', 'mark'],
  avg: ['平均分', '均分', '平均成绩', 'avg', 'average'],
  passRate: ['及格率', '合格率', 'passrate'],
  excellenceRate: ['优秀率', '优良率', 'excellencerate'],
  homework: ['作业完成率', '作业', 'homework', 'homeworkrate'],
}

/** 归一化表头：去空白/全角转半角/小写/去括号内容 */
function normHeader(h: string): string {
  return h
    .replace(/[（(].*?[)）]/g, '')
    .replace(/\s+/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase()
}

function matchField(header: string): string | null {
  const h = normHeader(header)
  if (!h) return null
  for (const [field, aliases] of Object.entries(ALIAS)) {
    if (aliases.some((a) => h === normHeader(a) || h.includes(normHeader(a)))) return field
  }
  return null
}

/* ---------- CSV 切分（支持逗号/分号/制表符，容忍引号包裹） ---------- */

function splitLine(line: string, delim: string): string[] {
  const cells: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQuote = !inQuote
      }
    } else if (ch === delim && !inQuote) {
      cells.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur)
  return cells.map((c) => c.trim())
}

function detectDelim(line: string): string {
  const counts: [string, number][] = [
    [',', (line.match(/,/g) ?? []).length],
    [';', (line.match(/;/g) ?? []).length],
    ['\t', (line.match(/\t/g) ?? []).length],
  ]
  return counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts.sort((a, b) => b[1] - a[1])[0][0] : ','
}

function toNum(v: string): number | null {
  if (!v) return null
  const n = Number(v.replace(/%$/, '').replace(/分$/, ''))
  return Number.isFinite(n) ? n : null
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function aggregate(values: number[]): { avg: number; passRate: number; excellenceRate: number } {
  const total = values.length
  const sum = values.reduce((a, b) => a + b, 0)
  const pass = values.filter((v) => v >= PASS_LINE).length
  const exc = values.filter((v) => v >= EXCELLENT_LINE).length
  return {
    avg: round1(sum / total),
    passRate: Math.round((pass / total) * 1000) / 10,
    excellenceRate: Math.round((exc / total) * 1000) / 10,
  }
}

/* ---------- 主解析 ---------- */

export function parseScoreCsv(text: string, opts?: { className?: string; fileName?: string }): CsvParseResult {
  const warnings: string[] = []
  const lines = text
    .replace(/^\uFEFF/, '') // BOM
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (lines.length < 2) {
    return { ok: false, error: 'CSV 内容过少：至少需要表头行 + 1 行数据。请确认导出的是成绩表。' }
  }
  if (lines.length > MAX_ROWS + 1) {
    return { ok: false, error: `数据行超过上限（${MAX_ROWS} 行），请拆分后分批导入。` }
  }

  const delim = detectDelim(lines[0])
  const headers = splitLine(lines[0], delim)
  if (headers.length < 2) {
    return { ok: false, error: '表头仅识别到 1 列：请使用逗号/分号/制表符分隔的标准 CSV。' }
  }
  if (headers.length > MAX_COLS) {
    return { ok: false, error: `列数超过上限（${MAX_COLS} 列），请精简导出列后重试。` }
  }

  const rows = lines.slice(1).map((l) => splitLine(l, delim))
  const fields = headers.map(matchField)

  // 字段占用检查：同一字段命中多列时取第一列，其余忽略
  const colOf = new Map<string, number>()
  fields.forEach((f, i) => {
    if (f && !colOf.has(f)) colOf.set(f, i)
  })
  for (let i = 0; i < headers.length; i++) {
    const f = fields[i]
    if (!f && headers[i]) warnings.push(`列「${headers[i]}」未识别，已忽略`)
    else if (f && colOf.get(f) !== i) warnings.push(`列「${headers[i]}」与「${headers[colOf.get(f)!]}」同义，已忽略后者`)
  }

  const hasSubjectCol = colOf.has('subject')
  const hasScoreCol = colOf.has('score')
  const isLong = hasSubjectCol && (hasScoreCol || colOf.has('avg'))

  let className = opts?.className?.trim() || ''
  const scores: SubjectScore[] = []
  let rowCount = 0
  let homeworkCompletion: number | null = null
  const columnMap: { column: string; as: string }[] = []
  const FIELD_LABEL: Record<string, string> = {
    name: '姓名', className: '班级', subject: '科目', score: '分数',
    avg: '平均分', passRate: '及格率', excellenceRate: '优秀率', homework: '作业完成率',
  }
  for (const [field, idx] of colOf) columnMap.push({ column: headers[idx], as: FIELD_LABEL[field] ?? field })

  if (isLong) {
    /* ---------- 长表：按科目分组 ---------- */
    const bySubject = new Map<string, { values: number[]; avg?: number; pass?: number; exc?: number }>()
    let skipped = 0
    for (const row of rows) {
      const subject = colOf.has('subject') ? row[colOf.get('subject')!] : ''
      if (!subject) { skipped++; continue }
      const entry = bySubject.get(subject) ?? { values: [] }
      if (colOf.has('score')) {
        const v = toNum(row[colOf.get('score')!])
        if (v === null) skipped++
        else entry.values.push(v)
      }
      if (colOf.has('avg')) entry.avg = toNum(row[colOf.get('avg')!]) ?? entry.avg
      if (colOf.has('passRate')) entry.pass = toNum(row[colOf.get('passRate')!]) ?? entry.pass
      if (colOf.has('excellenceRate')) entry.exc = toNum(row[colOf.get('excellenceRate')!]) ?? entry.exc
      bySubject.set(subject, entry)
    }
    if (skipped > 0) warnings.push(`${skipped} 行科目为空或分数非数值，已跳过`)
    if (bySubject.size === 0) {
      return { ok: false, error: '未解析到任何科目数据：请确认包含「科目」列与「分数/平均分」列。' }
    }
    rowCount = rows.length
    for (const [subject, e] of bySubject) {
      if (e.values.length > 0) {
        const agg = aggregate(e.values)
        scores.push({ subject, avg: agg.avg, passRate: agg.passRate, excellenceRate: agg.excellenceRate, trend: 0 })
      } else if (typeof e.avg === 'number') {
        // 已聚合行：无明细分数，及格/优秀率缺省按均分口径估算并提示
        scores.push({
          subject,
          avg: round1(e.avg),
          passRate: e.pass ?? Math.max(0, Math.min(100, (e.avg - 30) * 2)),
          excellenceRate: e.exc ?? Math.max(0, Math.min(100, (e.avg - 55) * 2.2)),
          trend: 0,
        })
        warnings.push(`「${subject}」无明细分数，及格/优秀率按均分口径估算`)
      }
    }
    const classCol = colOf.get('className')
    if (!className && classCol !== undefined) className = rows.find((r) => r[classCol])?.[classCol] ?? ''
  } else {
    /* ---------- 宽表：科目列逐列聚合 ---------- */
    const subjectCols: number[] = []
    fields.forEach((f, i) => {
      if (!f && headers[i]) subjectCols.push(i)
    })
    if (subjectCols.length === 0 && colOf.has('score')) {
      // 单科成绩表：姓名 + 单个分数列（如「姓名,数学成绩」），把分数列视为科目列
      const idx = colOf.get('score')!
      subjectCols.push(idx)
      warnings.push(`未识别到独立科目列，已将「${headers[idx]}」视为单科成绩`)
    }
    if (subjectCols.length === 0) {
      return {
        ok: false,
        error: '未识别到科目列：宽表需包含「姓名」+ 至少一列科目成绩；长表需包含「科目」「分数」列。可修正表头后重试。',
      }
    }
    let skipped = 0
    const perSubject = subjectCols.map((idx) => ({ subject: headers[idx], idx, values: [] as number[] }))
    for (const row of rows) {
      let any = false
      for (const entry of perSubject) {
        const v = toNum(row[entry.idx])
        if (v !== null) {
          entry.values.push(v)
          any = true
        }
      }
      if (any) rowCount++
      else skipped++
    }
    if (skipped > 0) warnings.push(`${skipped} 行无有效成绩，已跳过`)
    for (const e of perSubject) {
      if (e.values.length === 0) {
        warnings.push(`科目「${e.subject}」无有效数值，已忽略`)
        continue
      }
      const agg = aggregate(e.values)
      scores.push({ subject: e.subject, avg: agg.avg, passRate: agg.passRate, excellenceRate: agg.excellenceRate, trend: 0 })
    }
    const classCol = colOf.get('className')
    if (!className && classCol !== undefined) className = rows.find((r) => r[classCol])?.[classCol] ?? ''
  }

  /* ---------- 作业完成率（可选列） ---------- */
  const hwIdx = colOf.get('homework')
  if (hwIdx !== undefined) {
    const vals = rows.map((r) => toNum(r[hwIdx])).filter((v): v is number => v !== null)
    if (vals.length > 0) {
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length
      homeworkCompletion = Math.round((mean <= 1 ? mean * 100 : mean) * 10) / 10
    }
  }

  if (scores.length === 0) {
    return { ok: false, error: '未解析出有效科目成绩：请检查分数列是否为数值（可含 % 或「分」后缀）。' }
  }

  if (!className) {
    className = (opts?.fileName ?? '').replace(/\.[^.]+$/, '') || '导入班级'
    warnings.push('未找到班级列，已用文件名作为班级名（可在确认前修改）')
  }

  scores.sort((a, b) => b.avg - a.avg)
  return {
    ok: true,
    preview: { className, rowCount, scores, homeworkCompletion, warnings, columnMap },
  }
}

/** 由预览生成薄弱点标签（均分最低的至多 3 科） */
export function weakPointsFrom(preview: CsvImportPreview): string[] {
  return [...preview.scores]
    .sort((a, b) => a.avg - b.avg)
    .slice(0, 3)
    .map((s) => `${s.subject}（均分 ${s.avg}）`)
}
