#!/usr/bin/env node
/**
 * v0.9.4 画布 × 真实 LLM 接入评估 —— 模拟 LLM 服务器（OpenAI 兼容 /chat/completions + SSE 流式）
 *
 * 由 AI（CodeBuddy）扮演真实 LLM 的行为与文案，用于在 API 模式下评估空间任务台（Loom）各项功能：
 *  - function-calling：返回分片 tool_calls（queryClassLearning）
 *  - 直接文字回答：触发前端 Plan-JSON 降级链路
 *  - Plan-JSON：返回 steps（tool + text + artifact）
 *  - 文档流：返回 Markdown（ArtifactApiAdapter 消费）
 *  - 简报卡组：返回结构化卡片 JSON 数组（ApiBriefingProvider 消费）
 *  - 技能复盘：返回 {"action":"none"}（LlmSkillDistiller 消费，静默跳过）
 *
 * 管控接口：
 *  - GET  /__health             健康检查
 *  - GET  /__log                请求日志（评估断言用）
 *  - POST /__reset              清空日志与失败注入
 *  - POST /__config             运行时配置：{ failNext, failStatus, failMatch }
 */
import http from 'node:http'

const PORT = Number(process.env.MOCK_LLM_PORT || 8788)

const config = {
  /** 剩余需注入失败的请求数 */
  failNext: 0,
  failStatus: 500,
  /** 只有 user 内容包含该关键词的请求才注入失败（空 = 全部） */
  failMatch: '',
  /** 仅对 function-calling 轮（下发 tools 的请求）注入失败，避免被简报等其它请求消耗 */
  failOnlyTools: false,
}

/** 请求日志 */
const requests = []

/* ================= 内容工厂（AI 扮演 LLM 输出） ================= */

const FINAL_ANALYSIS = `完成分析。高一（3）班函数单调性判定掌握率 61%，明显低于数学均分 78.6 对应的整体水平；主要失分点：

1. 单调区间判断忽略定义域限制（约占错题 46%）；
2. 复合函数「同增异减」规则误用（约占 33%）；
3. 含参讨论对参数分界点遗漏（约占 21%）。

建议优先安排 1 课时专项干预，并配合三档分层练习。`

const PLAN_JSON = JSON.stringify({
  steps: [
    { type: 'tool', tool: 'genQuiz', args: { knowledgePoint: '函数单调性判定', difficulty: 'A/B/C 三档分层' } },
    {
      type: 'text',
      text: 'A 档基础 8 题、B 档提升 6 题、C 档挑战 4 题已命制完成，重点覆盖单调区间判断与含参讨论两类失分点。',
    },
    { type: 'artifact', kind: 'lessonPlan' },
  ],
})

const ARTIFACT_MD = `# 高一（3）班函数单调性分层练习（含学情依据）

## 一、学情依据

- 数学均分 78.6，函数单调性判定掌握率仅 61%，为当前首要薄弱点。
- 错题分布：忽略定义域限制 46%、「同增异减」规则误用 33%、含参讨论遗漏 21%。
- 作业完成率 93%、专注度 86，具备完成分层任务的学习习惯基础。

## 二、A 档 · 基础巩固（8 题）

1. 判断函数 f(x)=x²-2x 在区间 [0,3] 上的单调性，并说明理由。
2. 写出函数 y=1/x 的单调递减区间，注意定义域限制。
3. ……

## 三、B 档 · 能力提升（6 题）

1. 讨论函数 f(x)=x+1/x 在 (0,+∞) 上的单调性，并求最小值。
2. 已知 f(x) 在 R 上单调递增，比较 f(-1)、f(0)、f(1) 的大小。
3. ……

## 四、C 档 · 思维挑战（4 题）

1. 设 f(x)=x³-3ax，讨论参数 a 对单调区间的影响。
2. ……

## 五、使用建议

建议课后服务时段完成 A 档，周末提交 B 档；C 档供学有余力学生选做，下周一集中讲评。`

const BRIEFING_CARDS = JSON.stringify([
  {
    id: 'ai-eval-i1',
    type: 'insight',
    tag: '学情洞察',
    title: '函数单调性掌握率 61%，为高一（3）班首要薄弱点',
    body: '数学均分 78.6、作业完成率 93% 的背景下，函数单调性判定掌握率仅 61%，错题集中于定义域限制与含参讨论。',
    confidence: 3,
    source: '班级成绩分析 · 本周',
  },
  {
    id: 'ai-eval-c1',
    type: 'creation',
    tag: '练习设计',
    title: '生成函数单调性三档分层练习',
    body: '按 A 基础 / B 提升 / C 挑战三档命制练习，覆盖定义域限制与同增异减两类高频错因。',
    confidence: 2,
    source: '教学建议 · 本周',
    action: { kind: 'openTask', goal: '为函数单调性薄弱学生生成三档分层练习' },
  },
])

/* ================= HTTP / SSE 工具 ================= */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-EDU-Client',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...CORS })
  res.end(JSON.stringify(data))
}

async function readBody(req) {
  let raw = ''
  for await (const c of req) raw += c
  try {
    return JSON.parse(raw || '{}')
  } catch {
    return {}
  }
}

function sseHead(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...CORS,
  })
}

function frame(delta, finish = null) {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-eval',
    object: 'chat.completion.chunk',
    model: 'eval-mock-llm',
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`
}

/** 流式输出纯文本（模拟真实 LLM 逐 token 输出；slow=true 用于需要更长执行窗口的场景） */
async function streamText(res, text, slow = false) {
  sseHead(res)
  const size = 8
  for (let i = 0; i < text.length; i += size) {
    if (res.destroyed || res.writableEnded) return
    res.write(frame({ content: text.slice(i, i + size) }))
    await sleep(slow ? 55 + Math.random() * 25 : 8 + Math.random() * 16)
  }
  res.write(frame({}, 'stop'))
  res.write('data: [DONE]\n\n')
  res.end()
}

/** 流式输出 tool_calls（分 3 片，模拟真实分片累积） */
async function streamToolCalls(res, name, argsJson) {
  sseHead(res)
  const cut = Math.max(1, Math.floor(argsJson.length / 2))
  res.write(
    frame({ tool_calls: [{ index: 0, id: `call_eval_${Date.now().toString(36)}`, type: 'function', function: { name, arguments: '' } }] }),
  )
  await sleep(24)
  res.write(frame({ tool_calls: [{ index: 0, function: { arguments: argsJson.slice(0, cut) } }] }))
  await sleep(24)
  res.write(frame({ tool_calls: [{ index: 0, function: { arguments: argsJson.slice(cut) } }] }, 'tool_calls'))
  res.write('data: [DONE]\n\n')
  res.end()
}

/* ================= 请求路由判定 ================= */

function pickMessages(body) {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join('\n')
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
  return { messages, system, lastUser: typeof lastUser === 'string' ? lastUser : '' }
}

function detectKind(body) {
  const { system, lastUser, messages } = pickMessages(body)
  const hasTools = Array.isArray(body.tools) && body.tools.length > 0
  const hasToolMsg = messages.some((m) => m.role === 'tool')
  const base = { hasTools, hasToolMsg, lastUser, taskHint: system.includes('【执行要求】') }
  if (!hasTools && system.includes('今日简报')) return { kind: 'briefing', ...base }
  if (!hasTools && system.includes('智能体技能提炼器')) return { kind: 'distill', ...base }
  if (!hasTools && system.includes('完整的 Markdown 文档')) return { kind: 'artifact', ...base }
  if (hasTools) return { kind: 'tools', ...base }
  /* Plan-JSON 降级：格式要求拼在 user 消息里（见 Orchestrator.runPlanJsonFallback） */
  if (!hasTools && (system.includes('只输出一个 JSON 对象') || lastUser.includes('请仅输出一个 JSON 对象'))) {
    return { kind: 'plan', ...base }
  }
  if (lastUser.includes('只回复两个字')) return { kind: 'ping', ...base }
  return { kind: 'chat', ...base }
}

/* ================= /v1/chat/completions ================= */

async function handleChat(req, res) {
  const body = await readBody(req)
  const info = detectKind(body)

  const entry = {
    at: Date.now(),
    kind: info.kind,
    hasTools: info.hasTools,
    toolNames: Array.isArray(body.tools) ? body.tools.map((t) => t?.function?.name).filter(Boolean) : [],
    hasToolResult: info.hasToolMsg,
    messageCount: Array.isArray(body.messages) ? body.messages.length : 0,
    user: info.lastUser.slice(0, 6000),
    /* v0.9.4-03：任务型目标 system 执行约束是否进入请求体 */
    taskHint: !!info.taskHint,
    response: '',
    status: 200,
  }

  // 失败注入（评估「LLM 失败兜底」用）
  const failHit =
    config.failNext > 0 &&
    (!config.failMatch || info.lastUser.includes(config.failMatch)) &&
    (!config.failOnlyTools || info.hasTools)
  if (failHit) {
    config.failNext -= 1
    entry.response = 'injected_error'
    entry.status = config.failStatus
    requests.push(entry)
    json(res, { error: { message: `injected failure (eval) for ${info.kind}` } }, config.failStatus)
    return
  }

  /* 「家长会」类目标故意放慢（单飞互斥场景需要更长的执行窗口） */
  const slow = info.lastUser.includes('家长会')

  try {
    if (info.kind === 'briefing') {
      entry.response = 'briefing_cards'
      await streamText(res, BRIEFING_CARDS)
      requests.push(entry)
      return
    }
    if (info.kind === 'distill') {
      entry.response = 'distill_none'
      await streamText(res, '{"action":"none"}')
      requests.push(entry)
      return
    }
    if (info.kind === 'artifact') {
      entry.response = 'artifact_markdown'
      await streamText(res, ARTIFACT_MD, slow)
      requests.push(entry)
      return
    }
    if (info.kind === 'plan') {
      entry.response = 'plan_json'
      await streamText(res, PLAN_JSON, slow)
      requests.push(entry)
      return
    }
    if (info.kind === 'ping') {
      entry.response = 'ping'
      await streamText(res, '正常')
      requests.push(entry)
      return
    }
    if (info.kind === 'tools') {
      if (info.hasToolMsg) {
        // 工具结果已回填 → 收尾总结
        entry.response = 'final_text'
        await streamText(res, FINAL_ANALYSIS, slow)
        requests.push(entry)
        return
      }
      // 首轮：带上游结果 / 非分析类目标 → 直接文字回答（触发前端 Plan-JSON 降级）
      if (info.lastUser.includes('上游任务结果') || !info.lastUser.includes('分析')) {
        entry.response = 'text_first_round'
        await streamText(res, '好的，我先整理一下思路，再给出完整方案。', slow)
        requests.push(entry)
        return
      }
      // 分析类目标 → function-calling
      entry.response = 'tool_calls:queryClassLearning'
      await streamToolCalls(res, 'queryClassLearning', JSON.stringify({ className: '高一（3）班' }))
      requests.push(entry)
      return
    }
    entry.response = 'chat_fallback'
    await streamText(res, '好的，已了解你的需求。')
    requests.push(entry)
  } catch (err) {
    entry.response = `stream_error:${err?.message ?? 'unknown'}`
    requests.push(entry)
    try {
      res.end()
    } catch {
      /* ignore */
    }
  }
}

/* ================= server ================= */

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    res.end()
    return
  }
  const url = new URL(req.url || '/', `http://localhost:${PORT}`)
  try {
    if (url.pathname === '/__health') return json(res, { ok: true })
    if (url.pathname === '/__log') return json(res, { requests })
    if (url.pathname === '/__reset' && req.method === 'POST') {
      requests.length = 0
      Object.assign(config, { failNext: 0, failMatch: '', failOnlyTools: false })
      return json(res, { ok: true })
    }
    if (url.pathname === '/__config' && req.method === 'POST') {
      const patch = await readBody(req)
      Object.assign(config, patch)
      return json(res, { ok: true, config })
    }
    if (url.pathname === '/v1/chat/completions' && req.method === 'POST') return await handleChat(req, res)
    return json(res, { error: 'not found' }, 404)
  } catch (err) {
    console.error('[mock-llm] handler error:', err)
    try {
      return json(res, { error: 'internal' }, 500)
    } catch {
      /* ignore */
    }
  }
})

server.listen(PORT, () => {
  console.log(`[mock-llm] listening on http://localhost:${PORT} (OpenAI compatible)`)
})
