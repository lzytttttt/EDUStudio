/**
 * EDUStudio 轻后端代理 · Express 版（内网/自有服务器部署）
 *
 * 与 worker.js 行为一致：POST /v1/chat/completions 透传（SSE 无缓冲）、GET /health、
 * 路径/model 白名单、CORS 白名单、可选 X-EDU-TOKEN、内存限额（10/分钟 + 200/天）、
 * JSONL 审计（proxy-logs/audit-YYYY-MM-DD.jsonl，不记录对话内容明文）。
 *
 * v0.5 M2/M4/M5 新增：
 *   POST /v1/share                     分享短链（内容审计 + 敏感词拦截，M5①）
 *   GET  /v1/share/:id                 拉取分享快照 + 已收批注
 *   POST /v1/share/:id/annotations     批注回传（评审闭环）
 *   POST /v1/flows · GET /v1/flows     下发任务链（M2③）
 *   POST /v1/flows/:id/acknowledge|submit  回执确认/提交
 *   POST /v1/telemetry                 前端错误上报采样落盘（M4⑤）
 * 数据落盘目录由 SHARE_DIR 控制（默认 ./proxy-data），Docker 部署挂载 /data。
 *
 * 运行：
 *   npm install express
 *   DEEPSEEK_KEY=sk-xxx node proxy/server.mjs
 *   （Windows PowerShell：$env:DEEPSEEK_KEY='sk-xxx'; node proxy/server.mjs）
 */

import express from 'express'
import { Readable } from 'node:stream'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const PORT = Number(process.env.PORT || 8787)
const UPSTREAM = (process.env.UPSTREAM || 'https://api.deepseek.com/v1').replace(/\/+$/, '')
const DEEPSEEK_KEY = process.env.DEEPSEEK_KEY || ''
const RATE_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE || 10)
const RATE_PER_DAY = Number(process.env.RATE_LIMIT_PER_DAY || 200)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const EDU_TOKEN = process.env.EDU_TOKEN || ''
const AUDIT_DIR = process.env.AUDIT_DIR || path.join(process.cwd(), 'proxy-logs')

const MODEL_WHITELIST = new Set([
  'deepseek-chat',
  'deepseek-reasoner',
  'deepseek-v4-flash',
  'deepseek-v4-flash-free',
  'deepseek-v4-pro',
])
const MAX_MESSAGES = 100
const MAX_CONTENT_CHARS = 32000

/* ---------- 内存限额（单实例足够；多实例可换 Redis） ---------- */

const minuteBuckets = new Map() // key -> { windowStart, count }
const dayBuckets = new Map()

function checkRate(clientKey) {
  const now = Date.now()
  const minuteWindow = Math.floor(now / 60000) * 60000
  const dayKey = new Date(now).toISOString().slice(0, 10)

  const m = minuteBuckets.get(clientKey)
  const mCount = m && m.windowStart === minuteWindow ? m.count : 0
  if (mCount >= RATE_PER_MINUTE) return { retryAfter: 60 }

  const d = dayBuckets.get(clientKey)
  const dCount = d && d.day === dayKey ? d.count : 0
  if (dCount >= RATE_PER_DAY) return { retryAfter: 3600 }

  minuteBuckets.set(clientKey, { windowStart: minuteWindow, count: mCount + 1 })
  dayBuckets.set(clientKey, { day: dayKey, count: dCount + 1 })

  // 清理过期桶，防内存膨胀
  if (minuteBuckets.size > 5000) {
    for (const [k, v] of minuteBuckets) if (v.windowStart < now - 120000) minuteBuckets.delete(k)
  }
  if (dayBuckets.size > 5000) {
    for (const [k, v] of dayBuckets) if (v.day !== dayKey) dayBuckets.delete(k)
  }
  return null
}

/* ---------- 审计 ---------- */

function audit(entry) {
  try {
    fs.mkdirSync(AUDIT_DIR, { recursive: true })
    const day = new Date().toISOString().slice(0, 10)
    fs.appendFileSync(path.join(AUDIT_DIR, `audit-${day}.jsonl`), JSON.stringify(entry) + '\n')
  } catch {
    /* 审计失败不影响主流程 */
  }
}

function clientIdentity(req) {
  const raw = req.get('X-EDU-TOKEN') || req.ip || 'anonymous'
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12)
}

/* ---------- 应用 ---------- */

const app = express()
app.disable('x-powered-by')
// 注意：不要挂 compression 中间件，否则 SSE 会被缓冲
app.use(express.json({ limit: '2mb' }))

// CORS 白名单（未配置时放行，便于本地联调）
app.use((req, res, next) => {
  const origin = req.get('Origin') || ''
  if (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-EDU-Client, X-EDU-TOKEN')
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    upstream: UPSTREAM,
    rate: { perMinute: RATE_PER_MINUTE, perDay: RATE_PER_DAY },
    models: [...MODEL_WHITELIST],
  })
})

app.post('/v1/chat/completions', async (req, res) => {
  if (!DEEPSEEK_KEY) return res.status(500).json({ error: 'server_misconfigured', detail: 'DEEPSEEK_KEY 未设置' })

  if (EDU_TOKEN && req.get('X-EDU-TOKEN') !== EDU_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const clientKey = clientIdentity(req)
  const limited = checkRate(clientKey)
  if (limited) {
    res.setHeader('Retry-After', String(limited.retryAfter))
    return res.status(429).json({ error: 'rate_limited', retryAfter: limited.retryAfter })
  }

  const body = req.body ?? {}
  if (typeof body.model !== 'string' || !MODEL_WHITELIST.has(body.model)) {
    return res.status(400).json({ error: 'model_not_allowed' })
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return res.status(400).json({ error: 'messages_required' })
  }
  if (body.messages.length > MAX_MESSAGES) return res.status(400).json({ error: 'too_many_messages' })
  for (const m of body.messages) {
    if (!m || typeof m.content !== 'string' || m.content.length > MAX_CONTENT_CHARS) {
      return res.status(400).json({ error: 'content_too_long' })
    }
  }

  const startedAt = Date.now()
  let upstream
  try {
    upstream = await fetch(`${UPSTREAM}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_KEY}` },
      body: JSON.stringify(body),
    })
  } catch (err) {
    audit({ t: new Date().toISOString(), client: clientKey, role: req.get('X-EDU-Client') || '', model: body.model, status: 502, usage: null, ms: Date.now() - startedAt })
    return res.status(502).json({ error: 'upstream_unreachable', detail: String(err?.message ?? err) })
  }

  audit({
    t: new Date().toISOString(),
    client: clientKey,
    role: req.get('X-EDU-Client') || '',
    model: body.model,
    status: upstream.status,
    usage: body.stream ? null : (await upstream.clone().json().catch(() => null))?.usage?.total_tokens ?? null,
    ms: Date.now() - startedAt,
  })

  // SSE 无缓冲透传：直接把上游 body 管道到响应
  res.status(upstream.status)
  res.setHeader('Content-Type', upstream.headers.get('Content-Type') ?? 'application/json')
  if (upstream.body) {
    Readable.fromWeb(upstream.body).pipe(res)
  } else {
    res.end()
  }
})

/* ---------- 数据源演示端点（v0.5 M1③） ----------
 * 与前端 seed 同构的演示数据 + fetchedAt，供 RemoteSourceProvider 联调：
 *   GET /api/sources/classes            → { classes: [...], fetchedAt }
 *   GET /api/sources/classes?kw=高一3班  → 按班级名过滤
 *   GET /api/sources/region             → { metrics: [...], fetchedAt }
 *   GET /api/sources/school             → { trend, alerts, fetchedAt }
 * 生产环境将这里的静态数组替换为真实数据平台查询即可，前端契约不变。
 */
const DEMO_CLASSES = [
  {
    classId: 'c-g1-3',
    className: '高一（3）班',
    scores: [
      { subject: '语文', avg: 78.2, passRate: 82.5, excellenceRate: 22.5, trend: 1.2 },
      { subject: '数学', avg: 72.6, passRate: 70.0, excellenceRate: 15.0, trend: -2.1 },
      { subject: '英语', avg: 81.4, passRate: 87.5, excellenceRate: 30.0, trend: 0.8 },
      { subject: '物理', avg: 68.9, passRate: 65.0, excellenceRate: 12.5, trend: -1.5 },
    ],
    homeworkCompletion: 86.4,
    attentionIndex: 78,
    weakPoints: ['物理（均分 68.9）', '数学（均分 72.6）', '函数图像变换'],
  },
  {
    classId: 'c-g1-4',
    className: '高一（4）班',
    scores: [
      { subject: '语文', avg: 80.1, passRate: 85.0, excellenceRate: 25.0, trend: 0.6 },
      { subject: '数学', avg: 75.3, passRate: 75.0, excellenceRate: 18.8, trend: 1.1 },
      { subject: '英语', avg: 79.8, passRate: 82.5, excellenceRate: 26.3, trend: -0.4 },
      { subject: '物理', avg: 71.2, passRate: 68.8, excellenceRate: 15.0, trend: 0.9 },
    ],
    homeworkCompletion: 89.1,
    attentionIndex: 81,
    weakPoints: ['物理（均分 71.2）', '英语（均分 79.8）'],
  },
]

const DEMO_REGION = [
  { name: '区域教学质量指数', value: '86.4', trend: 1.8, note: '12 所监测校综合评分，较上季度稳步提升', history: [82.1, 82.9, 83.6, 84.5, 85.2, 86.4] },
  { name: 'AI 分析覆盖率', value: '78%', trend: 12.0, note: '使用 AI 教研工具的学校占比', history: [52, 58, 63, 69, 74, 78] },
  { name: '师资达标率', value: '91.2%', trend: 0.6, note: '专任教师学历与资质达标比例', history: [89.8, 90.1, 90.4, 90.6, 90.9, 91.2] },
  { name: '校际均衡度', value: '0.83', trend: -1.2, note: '1 为完全均衡，低于 0.8 需重点帮扶', history: [0.86, 0.85, 0.85, 0.84, 0.84, 0.83] },
]

const DEMO_TREND = [
  { week: 'W1', avgScore: 74.2, homework: 82.1, attention: 75.4 },
  { week: 'W2', avgScore: 74.8, homework: 82.9, attention: 76.1 },
  { week: 'W3', avgScore: 73.9, homework: 81.2, attention: 74.8 },
  { week: 'W4', avgScore: 75.1, homework: 83.5, attention: 76.9 },
  { week: 'W5', avgScore: 75.8, homework: 84.2, attention: 77.5 },
  { week: 'W6', avgScore: 75.2, homework: 83.8, attention: 76.8 },
  { week: 'W7', avgScore: 76.0, homework: 84.9, attention: 78.2 },
  { week: 'W8', avgScore: 76.6, homework: 85.6, attention: 79.0 },
]

const DEMO_ALERTS = [
  { level: 'high', title: '高一（3）班数学均分连续 3 周下滑', detail: '均分由 75.4 降至 72.6，及格率跌破 70%；建议本周安排备课组集体诊断，定位函数单元薄弱点。', className: '高一（3）班' },
  { level: 'mid', title: '初二（5）班作业完成率低于年级均值 8 个百分点', detail: '近两周作业提交率 78%，显著低于年级 86%；建议班主任联合科任教师核查作业量与难度梯度。', className: '初二（5）班' },
  { level: 'low', title: '高三（1）班课堂专注度波动上升', detail: '专注度指数 81→84，趋势向好；建议保持当前课堂节奏并沉淀为教研案例。', className: '高三（1）班' },
]

app.get('/api/sources/classes', (req, res) => {
  const kw = String(req.query.kw ?? '').trim()
  const classes = kw ? DEMO_CLASSES.filter((c) => c.className.includes(kw) || c.classId === kw) : DEMO_CLASSES
  res.json({ classes, fetchedAt: Date.now() })
})

app.get('/api/sources/region', (_req, res) => {
  res.json({ metrics: DEMO_REGION, fetchedAt: Date.now() })
})

app.get('/api/sources/school', (_req, res) => {
  res.json({ trend: DEMO_TREND, alerts: DEMO_ALERTS, fetchedAt: Date.now() })
})

/* ---------- 分享短链 + 批注回传（v0.5 M2①②）+ 内容审计（M5①） ---------- */

const SHARE_DIR = process.env.SHARE_DIR || path.join(process.cwd(), 'proxy-data')
const MAX_SHARE_CONTENT_CHARS = 200000
const MAX_ANNOTATIONS = 200
const SENSITIVE_WORDS = (process.env.SENSITIVE_WORDS || '赌博,色情,毒品,枪支,爆炸物,代考,作弊器')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

let shares = new Map()
function loadShares() {
  try {
    shares = new Map(JSON.parse(fs.readFileSync(path.join(SHARE_DIR, 'shares.json'), 'utf8')))
  } catch {
    /* 首次启动无数据文件 */
  }
}
function saveShares() {
  try {
    fs.mkdirSync(SHARE_DIR, { recursive: true })
    fs.writeFileSync(path.join(SHARE_DIR, 'shares.json'), JSON.stringify([...shares]))
  } catch {
    /* 磁盘失败不阻塞主流程 */
  }
}
loadShares()

function genShareId() {
  return crypto.randomBytes(4).toString('base64url')
}

/** 内容审计（M5①）：长度上限 + 敏感词命中；返回 null 表示放行 */
function contentIssue(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return 'invalid_body'
  if (typeof snapshot.content !== 'string' || !snapshot.content) return 'content_required'
  if (snapshot.content.length > MAX_SHARE_CONTENT_CHARS) return 'content_too_long'
  const text = `${snapshot.title ?? ''}\n${snapshot.content}`
  const hit = SENSITIVE_WORDS.find((w) => w && text.includes(w))
  return hit ? `content_blocked:${hit}` : null
}

app.post('/v1/share', (req, res) => {
  const clientKey = clientIdentity(req)
  const limited = checkRate(clientKey)
  if (limited) {
    res.setHeader('Retry-After', String(limited.retryAfter))
    return res.status(429).json({ error: 'rate_limited', retryAfter: limited.retryAfter })
  }
  const issue = contentIssue(req.body)
  if (issue) {
    audit({ t: new Date().toISOString(), client: clientKey, kind: 'share', status: 400, issue })
    return res.status(400).json({ error: issue })
  }
  const id = genShareId()
  shares.set(id, { snapshot: req.body, annotations: [], createdAt: Date.now() })
  saveShares()
  audit({ t: new Date().toISOString(), client: clientKey, kind: 'share', status: 200, id, chars: req.body.content.length })
  res.json({ id })
})

app.get('/v1/share/:id', (req, res) => {
  const rec = shares.get(req.params.id)
  if (!rec) return res.status(404).json({ error: 'not_found' })
  res.json({ snapshot: rec.snapshot, annotations: rec.annotations })
})

app.post('/v1/share/:id/annotations', (req, res) => {
  const rec = shares.get(req.params.id)
  if (!rec) return res.status(404).json({ error: 'not_found' })
  const list = req.body?.annotations
  if (!Array.isArray(list) || list.length > MAX_ANNOTATIONS) {
    return res.status(400).json({ error: 'invalid_annotations' })
  }
  for (const a of list) {
    if (!a || typeof a.text !== 'string' || !a.text || a.text.length > 2000) {
      return res.status(400).json({ error: 'invalid_annotations' })
    }
  }
  rec.annotations = list
  saveShares()
  audit({ t: new Date().toISOString(), client: clientIdentity(req), kind: 'annotation', status: 200, id: req.params.id, count: list.length })
  res.json({ ok: true, count: list.length })
})

/* ---------- 下发任务链（v0.5 M2③） ---------- */

let flows = []
function loadFlows() {
  try {
    flows = JSON.parse(fs.readFileSync(path.join(SHARE_DIR, 'flows.json'), 'utf8'))
  } catch {
    /* 首次启动无数据文件 */
  }
}
function saveFlows() {
  try {
    fs.mkdirSync(SHARE_DIR, { recursive: true })
    fs.writeFileSync(path.join(SHARE_DIR, 'flows.json'), JSON.stringify(flows))
  } catch {
    /* 磁盘失败不阻塞主流程 */
  }
}
loadFlows()

app.post('/v1/flows', (req, res) => {
  const b = req.body ?? {}
  if (typeof b.title !== 'string' || !b.title || typeof b.content !== 'string' || !b.content) {
    return res.status(400).json({ error: 'title_content_required' })
  }
  if (!Array.isArray(b.targets) || b.targets.length === 0 || b.targets.length > 50) {
    return res.status(400).json({ error: 'targets_required' })
  }
  const now = Date.now()
  const flow = {
    id: `flow-${now.toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
    title: String(b.title).slice(0, 200),
    content: String(b.content).slice(0, MAX_SHARE_CONTENT_CHARS),
    deadline: typeof b.deadline === 'string' ? b.deadline.slice(0, 40) : '',
    from: typeof b.from === 'string' ? b.from.slice(0, 100) : '',
    fromRole: typeof b.fromRole === 'string' ? b.fromRole.slice(0, 40) : '',
    createdAt: now,
    receipts: b.targets.map((t, i) => ({
      id: `rc-${i}-${crypto.randomBytes(2).toString('hex')}`,
      name: String(t?.name ?? '').slice(0, 100),
      role: String(t?.role ?? 'teacher'),
      status: 'pending',
      note: '',
      updatedAt: now,
    })),
  }
  flows = [flow, ...flows].slice(0, 200)
  saveFlows()
  audit({ t: new Date().toISOString(), client: clientIdentity(req), kind: 'flow', status: 200, id: flow.id })
  res.json({ flow })
})

app.get('/v1/flows', (_req, res) => res.json({ flows }))

app.post('/v1/flows/:id/acknowledge', (req, res) => {
  const flow = flows.find((f) => f.id === req.params.id)
  const receipt = flow?.receipts.find((r) => r.id === req.body?.receiptId)
  if (!flow || !receipt) return res.status(404).json({ error: 'not_found' })
  if (receipt.status === 'pending') {
    receipt.status = 'acknowledged'
    receipt.updatedAt = Date.now()
    saveFlows()
  }
  res.json({ flow })
})

app.post('/v1/flows/:id/submit', (req, res) => {
  const flow = flows.find((f) => f.id === req.params.id)
  const receipt = flow?.receipts.find((r) => r.id === req.body?.receiptId)
  if (!flow || !receipt) return res.status(404).json({ error: 'not_found' })
  receipt.status = 'submitted'
  receipt.note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 2000) : ''
  receipt.updatedAt = Date.now()
  saveFlows()
  audit({ t: new Date().toISOString(), client: clientIdentity(req), kind: 'flow-submit', status: 200, id: flow.id })
  res.json({ flow })
})

/* ---------- 前端错误上报（v0.5 M4⑤）：采样落 JSONL ---------- */

const TELEMETRY_SAMPLE = Math.min(Math.max(Number(process.env.TELEMETRY_SAMPLE ?? 1), 0), 1)

app.post('/v1/telemetry', (req, res) => {
  const b = req.body ?? {}
  if (typeof b.type !== 'string' || typeof b.message !== 'string') {
    return res.status(400).json({ error: 'invalid_body' })
  }
  if (b.message.length > 2000) b.message = b.message.slice(0, 2000)
  if (Math.random() < TELEMETRY_SAMPLE) {
    try {
      fs.mkdirSync(AUDIT_DIR, { recursive: true })
      const day = new Date().toISOString().slice(0, 10)
      const entry = { t: new Date().toISOString(), client: clientIdentity(req), type: b.type, message: b.message, source: b.source ?? '', url: b.url ?? '' }
      fs.appendFileSync(path.join(AUDIT_DIR, `telemetry-${day}.jsonl`), JSON.stringify(entry) + '\n')
    } catch {
      /* 落盘失败不阻塞 */
    }
  }
  res.json({ ok: true })
})

// 路径白名单：其余一律 404
app.all('*', (_req, res) => res.status(404).json({ error: 'not_found' }))

app.listen(PORT, () => {
  console.log(`[edustudio-proxy] listening on http://localhost:${PORT} → ${UPSTREAM}`)
  console.log(`[edustudio-proxy] rate: ${RATE_PER_MINUTE}/min, ${RATE_PER_DAY}/day · audit dir: ${AUDIT_DIR}`)
})
