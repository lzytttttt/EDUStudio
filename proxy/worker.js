/**
 * EDUStudio 轻后端代理 · Cloudflare Workers 版（零运维首选）
 *
 * 职责：统一保管 key、按客户端限额（10 次/分钟 + 200 次/天）、最小审计日志。
 * 接口：POST /v1/chat/completions（OpenAI 兼容透传，SSE 原样流式）、GET /health。
 * 安全：路径白名单（其余 404）、model 白名单、CORS 域名白名单、可选 X-EDU-TOKEN。
 *
 * v0.5 M2/M4/M5 新增（与 server.mjs 行为一致，数据存 KV）：
 *   POST /v1/share · GET /v1/share/:id · POST /v1/share/:id/annotations（分享短链 + 批注回传，M5① 内容审计）
 *   POST /v1/flows · GET /v1/flows · POST /v1/flows/:id/acknowledge|submit（下发任务链，M2③）
 *   POST /v1/telemetry（前端错误上报，M4⑤）
 *
 * 部署：
 *   wrangler kv namespace create EDU_RATE_KV
 *   wrangler kv namespace create EDU_AUDIT_KV
 *   wrangler kv namespace create EDU_SHARE_KV
 *   （将返回的 id 填入 wrangler.toml 的 kv_namespaces）
 *   wrangler secret put DEEPSEEK_KEY
 *   wrangler deploy
 */

const MODEL_WHITELIST = new Set([
  'deepseek-chat',
  'deepseek-reasoner',
  'deepseek-v4-flash',
  'deepseek-v4-flash-free',
  'deepseek-v4-pro',
])
const MAX_MESSAGES = 100
const MAX_CONTENT_CHARS = 32000
const RATE_PER_MINUTE = 10
const RATE_PER_DAY = 200

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url)

    if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), env, req)

    if (req.method === 'GET' && url.pathname === '/health') {
      return cors(
        json(
          {
            ok: true,
            upstream: env.UPSTREAM ?? 'https://api.deepseek.com/v1',
            rate: { perMinute: RATE_PER_MINUTE, perDay: RATE_PER_DAY },
            models: [...MODEL_WHITELIST],
          },
          200,
        ),
        env,
        req,
      )
    }

    // 数据源演示端点（v0.5 M1③）：与 server.mjs 同构，供 RemoteSourceProvider 联调
    if (req.method === 'GET' && url.pathname.startsWith('/api/sources/')) {
      return cors(sourcesEndpoint(url), env, req)
    }

    // 分享短链 + 批注回传（v0.5 M2①②，M5① 内容审计）
    if (url.pathname === '/v1/share' && req.method === 'POST') {
      return cors(await shareCreate(env, req), env, req)
    }
    if (req.method === 'GET' && url.pathname.startsWith('/v1/share/')) {
      return cors(await shareGet(env, url.pathname), env, req)
    }
    if (req.method === 'POST' && /^\/v1\/share\/[^/]+\/annotations$/.test(url.pathname)) {
      return cors(await shareAnnotations(env, req, url.pathname), env, req)
    }

    // 下发任务链（v0.5 M2③）
    if (url.pathname === '/v1/flows' && req.method === 'GET') {
      return cors(await flowsList(env), env, req)
    }
    if (url.pathname === '/v1/flows' && req.method === 'POST') {
      return cors(await flowCreate(env, req), env, req)
    }
    if (req.method === 'POST' && /^\/v1\/flows\/[^/]+\/(acknowledge|submit)$/.test(url.pathname)) {
      return cors(await flowUpdate(env, req, url.pathname), env, req)
    }

    // 前端错误上报（v0.5 M4⑤）
    if (url.pathname === '/v1/telemetry' && req.method === 'POST') {
      return cors(await telemetry(env, req), env, req)
    }

    // 路径白名单：只允许 /v1/chat/completions，缩小攻击面
    if (req.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
      return cors(json({ error: 'not_found' }, 404), env, req)
    }

    // CORS 域名白名单（未配置时放行，便于本地联调）
    const origin = req.headers.get('Origin') ?? ''
    const allowed = (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (allowed.length > 0 && origin && !allowed.includes(origin)) {
      return cors(json({ error: 'origin_not_allowed' }, 403), env, req)
    }

    // 可选静态 token 鉴权（机构内统一分发）
    if (env.EDU_TOKEN && req.headers.get('X-EDU-TOKEN') !== env.EDU_TOKEN) {
      return cors(json({ error: 'unauthorized' }, 401), env, req)
    }

    // 限额（两级：瞬时/日额；未绑定 KV 时跳过）
    const clientKey = await clientIdentity(req)
    const limited = await rateLimit(env, clientKey)
    if (limited) {
      return cors(
        json({ error: 'rate_limited', retryAfter: limited.retryAfter }, 429, {
          'Retry-After': String(limited.retryAfter),
        }),
        env,
        req,
      )
    }

    // 请求体校验
    let body
    try {
      body = await req.json()
    } catch {
      return cors(json({ error: 'invalid_json' }, 400), env, req)
    }
    const invalid = sanitize(body)
    if (invalid) return cors(json({ error: invalid }, 400), env, req)

    // 转发上游（key 仅存在于 Worker Secret，绝不落前端）
    const upstreamBase = (env.UPSTREAM ?? 'https://api.deepseek.com/v1').replace(/\/+$/, '')
    const upstream = await fetch(`${upstreamBase}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.DEEPSEEK_KEY}` },
      body: JSON.stringify(body),
    })

    // 审计不阻塞响应
    ctx.waitUntil(audit(env, req, upstream, body, clientKey))

    // body 是流，直接透传 = 天然 SSE 无缓冲
    const headers = new Headers()
    headers.set('Content-Type', upstream.headers.get('Content-Type') ?? 'application/json')
    return cors(new Response(upstream.body, { status: upstream.status, headers }), env, req)
  },
}

/* ---------- 工具函数 ---------- */

/* 数据源演示数据（与 server.mjs 保持同构；生产替换为真实数据平台查询） */
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

/** GET /api/sources/{classes,region,school} → 演示数据 + fetchedAt */
function sourcesEndpoint(url) {
  const kw = (url.searchParams.get('kw') ?? '').trim()
  switch (url.pathname) {
    case '/api/sources/classes': {
      const classes = kw ? DEMO_CLASSES.filter((c) => c.className.includes(kw) || c.classId === kw) : DEMO_CLASSES
      return json({ classes, fetchedAt: Date.now() }, 200)
    }
    case '/api/sources/region':
      return json({ metrics: DEMO_REGION, fetchedAt: Date.now() }, 200)
    case '/api/sources/school':
      return json({ trend: DEMO_TREND, alerts: DEMO_ALERTS, fetchedAt: Date.now() }, 200)
    default:
      return json({ error: 'not_found' }, 404)
  }
}

/* ---------- 分享短链 + 批注回传（v0.5 M2①②，M5① 内容审计） ---------- */

const MAX_SHARE_CONTENT_CHARS = 200000
const MAX_ANNOTATIONS = 200
const SHARE_TTL_SECONDS = 7 * 86400

/** 内容审计：长度上限 + 敏感词命中（词表可用 env.SENSITIVE_WORDS 覆盖）；返回 null 表示放行 */
function contentIssue(snapshot, env) {
  if (!snapshot || typeof snapshot !== 'object') return 'invalid_body'
  if (typeof snapshot.content !== 'string' || !snapshot.content) return 'content_required'
  if (snapshot.content.length > MAX_SHARE_CONTENT_CHARS) return 'content_too_long'
  const words = (env.SENSITIVE_WORDS ?? '赌博,色情,毒品,枪支,爆炸物,代考,作弊器')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const text = `${snapshot.title ?? ''}\n${snapshot.content}`
  const hit = words.find((w) => w && text.includes(w))
  return hit ? `content_blocked:${hit}` : null
}

async function shareCreate(env, req) {
  let body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  const issue = contentIssue(body, env)
  if (issue) return json({ error: issue }, 400)
  if (!env.EDU_SHARE_KV) return json({ error: 'kv_not_configured' }, 500)
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
  const rec = { snapshot: body, annotations: [], createdAt: Date.now() }
  await env.EDU_SHARE_KV.put(`share:${id}`, JSON.stringify(rec), { expirationTtl: SHARE_TTL_SECONDS })
  return json({ id }, 200)
}

async function shareGet(env, pathname) {
  const id = pathname.slice('/v1/share/'.length)
  if (!env.EDU_SHARE_KV || !id) return json({ error: 'not_found' }, 404)
  const raw = await env.EDU_SHARE_KV.get(`share:${id}`)
  if (!raw) return json({ error: 'not_found' }, 404)
  try {
    const rec = JSON.parse(raw)
    return json({ snapshot: rec.snapshot, annotations: rec.annotations ?? [] })
  } catch {
    return json({ error: 'not_found' }, 404)
  }
}

async function shareAnnotations(env, req, pathname) {
  const id = pathname.slice('/v1/share/'.length).replace(/\/annotations$/, '')
  let body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  const list = body?.annotations
  if (!env.EDU_SHARE_KV || !id || !Array.isArray(list) || list.length > MAX_ANNOTATIONS) {
    return json({ error: 'invalid_annotations' }, 400)
  }
  for (const a of list) {
    if (!a || typeof a.text !== 'string' || !a.text || a.text.length > 2000) {
      return json({ error: 'invalid_annotations' }, 400)
    }
  }
  const raw = await env.EDU_SHARE_KV.get(`share:${id}`)
  if (!raw) return json({ error: 'not_found' }, 404)
  const rec = JSON.parse(raw)
  rec.annotations = list
  await env.EDU_SHARE_KV.put(`share:${id}`, JSON.stringify(rec), { expirationTtl: SHARE_TTL_SECONDS })
  return json({ ok: true, count: list.length })
}

/* ---------- 下发任务链（v0.5 M2③） ---------- */

function buildFlow(b) {
  const now = Date.now()
  return {
    id: `flow-${now.toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
    title: String(b.title).slice(0, 200),
    content: String(b.content).slice(0, MAX_SHARE_CONTENT_CHARS),
    deadline: typeof b.deadline === 'string' ? b.deadline.slice(0, 40) : '',
    from: typeof b.from === 'string' ? b.from.slice(0, 100) : '',
    fromRole: typeof b.fromRole === 'string' ? b.fromRole.slice(0, 40) : '',
    createdAt: now,
    receipts: b.targets.map((t, i) => ({
      id: `rc-${i}-${crypto.randomUUID().slice(0, 6)}`,
      name: String(t?.name ?? '').slice(0, 100),
      role: String(t?.role ?? 'teacher'),
      status: 'pending',
      note: '',
      updatedAt: now,
    })),
  }
}

async function flowsList(env) {
  if (!env.EDU_SHARE_KV) return json({ flows: [] })
  const raw = await env.EDU_SHARE_KV.get('flows')
  return json({ flows: JSON.parse(raw ?? '[]') })
}

async function flowCreate(env, req) {
  let b
  try {
    b = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  if (typeof b?.title !== 'string' || !b.title || typeof b.content !== 'string' || !b.content) {
    return json({ error: 'title_content_required' }, 400)
  }
  if (!Array.isArray(b.targets) || b.targets.length === 0 || b.targets.length > 50) {
    return json({ error: 'targets_required' }, 400)
  }
  if (!env.EDU_SHARE_KV) return json({ error: 'kv_not_configured' }, 500)
  const flow = buildFlow(b)
  const list = JSON.parse((await env.EDU_SHARE_KV.get('flows')) ?? '[]')
  list.unshift(flow)
  await env.EDU_SHARE_KV.put('flows', JSON.stringify(list.slice(0, 200)))
  return json({ flow })
}

async function flowUpdate(env, req, pathname) {
  const m = pathname.match(/^\/v1\/flows\/([^/]+)\/(acknowledge|submit)$/)
  if (!m) return json({ error: 'not_found' }, 404)
  let body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  if (!env.EDU_SHARE_KV) return json({ error: 'kv_not_configured' }, 500)
  const list = JSON.parse((await env.EDU_SHARE_KV.get('flows')) ?? '[]')
  const flow = list.find((f) => f.id === m[1])
  const receipt = flow?.receipts.find((r) => r.id === body?.receiptId)
  if (!flow || !receipt) return json({ error: 'not_found' }, 404)
  if (m[2] === 'acknowledge') {
    if (receipt.status === 'pending') {
      receipt.status = 'acknowledged'
      receipt.updatedAt = Date.now()
    }
  } else {
    receipt.status = 'submitted'
    receipt.note = typeof body?.note === 'string' ? body.note.slice(0, 2000) : ''
    receipt.updatedAt = Date.now()
  }
  await env.EDU_SHARE_KV.put('flows', JSON.stringify(list))
  return json({ flow })
}

/* ---------- 前端错误上报（v0.5 M4⑤） ---------- */

async function telemetry(env, req) {
  let b
  try {
    b = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  if (typeof b?.type !== 'string' || typeof b?.message !== 'string') {
    return json({ error: 'invalid_body' }, 400)
  }
  if (b.message.length > 2000) b.message = b.message.slice(0, 2000)
  if (env.EDU_AUDIT_KV) {
    try {
      const day = new Date().toISOString().slice(0, 10)
      const key = `telemetry:${day}`
      const list = JSON.parse((await env.EDU_AUDIT_KV.get(key)) ?? '[]')
      list.push({ t: new Date().toISOString(), type: b.type, message: b.message, source: b.source ?? '', url: b.url ?? '' })
      await env.EDU_AUDIT_KV.put(key, JSON.stringify(list.slice(-300)), { expirationTtl: 30 * 86400 })
    } catch {
      /* 落盘失败不阻塞 */
    }
  }
  return json({ ok: true })
}

function json(obj, status, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  })
}

function cors(res, env, req) {
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const origin = req?.headers.get('Origin') ?? ''
  if (allowed.length === 0 || allowed.includes(origin)) {
    res.headers.set('Access-Control-Allow-Origin', origin || '*')
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-EDU-Client, X-EDU-TOKEN')
    res.headers.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  }
  return res
}

/** 请求体白名单校验：model / messages 长度 / 单条内容长度 */
function sanitize(body) {
  if (!body || typeof body !== 'object') return 'invalid_body'
  if (typeof body.model !== 'string' || !MODEL_WHITELIST.has(body.model)) return 'model_not_allowed'
  if (!Array.isArray(body.messages) || body.messages.length === 0) return 'messages_required'
  if (body.messages.length > MAX_MESSAGES) return 'too_many_messages'
  for (const m of body.messages) {
    if (!m || typeof m.content !== 'string' || m.content.length > MAX_CONTENT_CHARS) {
      return 'content_too_long'
    }
  }
  return null
}

/** 客户端标识摘要：优先 X-EDU-TOKEN，其次 CF-Connecting-IP（SHA-256 前 12 位，不存明文） */
async function clientIdentity(req) {
  const raw = req.headers.get('X-EDU-TOKEN') || req.headers.get('CF-Connecting-IP') || 'anonymous'
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return [...new Uint8Array(digest)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** KV 计数限额：分钟桶 TTL 60s，日桶 TTL 24h（KV 有秒级延迟，阈值已留余量） */
async function rateLimit(env, clientKey) {
  if (!env.EDU_RATE_KV) return null
  const now = Date.now()
  const minuteKey = `m:${clientKey}:${Math.floor(now / 60000)}`
  const dayKey = `d:${clientKey}:${new Date(now).toISOString().slice(0, 10)}`
  const [m, d] = await Promise.all([env.EDU_RATE_KV.get(minuteKey), env.EDU_RATE_KV.get(dayKey)])
  if (Number(m ?? 0) >= RATE_PER_MINUTE) return { retryAfter: 60 }
  if (Number(d ?? 0) >= RATE_PER_DAY) return { retryAfter: 3600 }
  await Promise.all([
    env.EDU_RATE_KV.put(minuteKey, String(Number(m ?? 0) + 1), { expirationTtl: 60 }),
    env.EDU_RATE_KV.put(dayKey, String(Number(d ?? 0) + 1), { expirationTtl: 86400 }),
  ])
  return null
}

/** 最小审计：时间/客户端摘要/角色/model/状态码/usage（不记录对话内容明文），按日分 key 保留 30 天 */
async function audit(env, req, upstream, body, clientKey) {
  if (!env.EDU_AUDIT_KV) return
  try {
    let usage = null
    if (!body.stream) {
      try {
        const j = await upstream.clone().json()
        usage = j?.usage?.total_tokens ?? null
      } catch {
        /* ignore */
      }
    }
    const day = new Date().toISOString().slice(0, 10)
    const key = `audit:${day}`
    const list = JSON.parse((await env.EDU_AUDIT_KV.get(key)) ?? '[]')
    list.push({
      t: new Date().toISOString(),
      client: clientKey,
      role: req.headers.get('X-EDU-Client') ?? '',
      model: body.model,
      status: upstream.status,
      usage,
    })
    await env.EDU_AUDIT_KV.put(key, JSON.stringify(list.slice(-500)), { expirationTtl: 30 * 86400 })
  } catch {
    /* 审计失败不影响主流程 */
  }
}
