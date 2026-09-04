/**
 * EDUStudio 轻后端代理 · Cloudflare Workers 版（零运维首选）
 *
 * 职责：统一保管 key、按客户端限额（10 次/分钟 + 200 次/天）、最小审计日志。
 * 接口：POST /v1/chat/completions（OpenAI 兼容透传，SSE 原样流式）、GET /health。
 * 安全：路径白名单（其余 404）、model 白名单、CORS 域名白名单、可选 X-EDU-TOKEN。
 *
 * 部署：
 *   wrangler kv namespace create EDU_RATE_KV
 *   wrangler kv namespace create EDU_AUDIT_KV
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
