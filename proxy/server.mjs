/**
 * EDUStudio 轻后端代理 · Express 版（内网/自有服务器部署）
 *
 * 与 worker.js 行为一致：POST /v1/chat/completions 透传（SSE 无缓冲）、GET /health、
 * 路径/model 白名单、CORS 白名单、可选 X-EDU-TOKEN、内存限额（10/分钟 + 200/天）、
 * JSONL 审计（proxy-logs/audit-YYYY-MM-DD.jsonl，不记录对话内容明文）。
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

// 路径白名单：其余一律 404
app.all('*', (_req, res) => res.status(404).json({ error: 'not_found' }))

app.listen(PORT, () => {
  console.log(`[edustudio-proxy] listening on http://localhost:${PORT} → ${UPSTREAM}`)
  console.log(`[edustudio-proxy] rate: ${RATE_PER_MINUTE}/min, ${RATE_PER_DAY}/day · audit dir: ${AUDIT_DIR}`)
})
