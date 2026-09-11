/**
 * v0.9.4 画布 × 真实 LLM（模拟）接入评估用例
 *
 * 评测范围（Loom 各功能在 API 模式下的真实行为），v0.9.4-03 修复后按「期望行为」断言：
 *  S1 依赖链：A(function-calling，补 plan) → B(上游注入 + Plan-JSON 降级 + 文档流)
 *     + 文档节点自动出现 / artifact 事件入 trace / 文档承接上游 / 打开直达右栏
 *  S2 人工确认：checkpoint 暂停 → 继续；上游结果穿透 checkpoint 注入下游
 *  S3 便签边界：便签不参与执行、不消耗 LLM 调用
 *  S4 LLM 失败兜底：500 → 回退 Mock 剧本，且画布通知可见降级
 *  S6 简报采纳：API 生成的卡片采纳 → 画布任务节点
 *  S7 单飞互斥：用户执行中「开始处理」→ 节点回队，消息完成后可再跑
 *
 * 说明：LLM 由 scripts/loom-eval/mock-llm-server.mjs 扮演（OpenAI 兼容，行为与文案由 AI 生成），
 * 前端以 API 模式真实走 DeepSeekAdapter → Orchestrator → 工具 → ArtifactApiAdapter 全链路。
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const MOCK = 'http://localhost:8788'

const TEACHER = {
  account: 'teacher@edustudio.cn',
  password: 'demo1234',
}

interface MockReq {
  at: number
  kind: string
  hasTools: boolean
  toolNames: string[]
  hasToolResult: boolean
  messageCount: number
  user: string
  /** v0.9.4-03：任务型目标 system 是否携带【执行要求】约束 */
  taskHint: boolean
  response: string
  status: number
}

/* ---------------- 场景画布 ---------------- */

/** A（分析学情）→ B（生成分层练习），dependency 边 */
const CHAIN_AB = {
  schemaVersion: 1,
  boards: [
    {
      id: 'board-teacher',
      role: 'teacher',
      title: '教学画布',
      removedCardIds: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      updatedAt: 0,
      nodes: [
        {
          id: 'lnode-a',
          type: 'agent',
          title: '分析学情',
          instruction: '分析高一（3）班函数单调性薄弱点',
          position: { x: 40, y: 60 },
          status: 'idle',
          createdAt: 0,
          updatedAt: 0,
        },
        {
          id: 'lnode-b',
          type: 'agent',
          title: '生成分层练习',
          instruction: '根据上游分析结果生成三档分层练习',
          position: { x: 360, y: 60 },
          status: 'idle',
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      edges: [{ id: 'e-ab', from: 'lnode-a', to: 'lnode-b', type: 'dependency', createdAt: 0 }],
    },
  ],
}

/** A → checkpoint → B */
const CHAIN_CHECKPOINT = {
  schemaVersion: 1,
  boards: [
    {
      id: 'board-teacher',
      role: 'teacher',
      title: '教学画布',
      removedCardIds: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      updatedAt: 0,
      nodes: [
        {
          id: 'lnode-a',
          type: 'agent',
          title: '分析学情',
          instruction: '分析高一（3）班函数单调性薄弱点',
          position: { x: 40, y: 60 },
          status: 'idle',
          createdAt: 0,
          updatedAt: 0,
        },
        {
          id: 'lnode-cp',
          type: 'checkpoint',
          title: '人工确认',
          position: { x: 360, y: 60 },
          status: 'idle',
          createdAt: 0,
          updatedAt: 0,
        },
        {
          id: 'lnode-b',
          type: 'agent',
          title: '生成分层练习',
          instruction: '根据上游分析结果生成三档分层练习',
          position: { x: 680, y: 60 },
          status: 'idle',
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      edges: [
        { id: 'e-a-cp', from: 'lnode-a', to: 'lnode-cp', type: 'dependency', createdAt: 0 },
        { id: 'e-cp-b', from: 'lnode-cp', to: 'lnode-b', type: 'dependency', createdAt: 0 },
      ],
    },
  ],
}

/** 便签 + AI 模块（无边） */
const BOARD_WITH_NOTE = {
  schemaVersion: 1,
  boards: [
    {
      id: 'board-teacher',
      role: 'teacher',
      title: '教学画布',
      removedCardIds: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      updatedAt: 0,
      nodes: [
        {
          id: 'lnode-note',
          type: 'note',
          title: '随手记：周五前收作业',
          instruction: '便签备注，不参与执行',
          position: { x: 40, y: 60 },
          status: 'idle',
          createdAt: 0,
          updatedAt: 0,
        },
        {
          id: 'lnode-a',
          type: 'agent',
          title: '分析学情',
          instruction: '分析高一（3）班函数单调性薄弱点',
          position: { x: 360, y: 60 },
          status: 'idle',
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      edges: [],
    },
  ],
}

/** 单 AI 模块 */
const SINGLE_AGENT = {
  schemaVersion: 1,
  boards: [
    {
      id: 'board-teacher',
      role: 'teacher',
      title: '教学画布',
      removedCardIds: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      updatedAt: 0,
      nodes: [
        {
          id: 'lnode-a',
          type: 'agent',
          title: '分析学情',
          instruction: '分析高一（3）班函数单调性薄弱点',
          position: { x: 40, y: 60 },
          status: 'idle',
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      edges: [],
    },
  ],
}

/* ---------------- 工具函数 ---------------- */

/** 预置：API 模式设置 + 画布数据（每次导航前注入，先做防御性清库） */
async function prepare(page: Page, board: unknown): Promise<void> {
  await page.addInitScript(
    ({ board }) => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('edustudio:')) localStorage.removeItem(key)
      }
      localStorage.setItem(
        'edustudio:settings',
        JSON.stringify({
          mode: 'api',
          baseUrl: 'http://localhost:8788/v1',
          model: 'eval-mock-llm',
          apiKey: 'sk-eval',
          proxyUrl: '',
          dataSource: 'seed',
          sourceUrl: 'http://localhost:8787/api/sources',
        }),
      )
      localStorage.setItem('edustudio:loom', JSON.stringify(board))
    },
    { board },
  )
}

async function loginAsTeacher(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByTestId('login-account').fill(TEACHER.account)
  await page.getByTestId('login-password').fill(TEACHER.password)
  await page.getByTestId('role-card-teacher').click()
  await page.getByTestId('login-submit').click()
  await page.getByTestId('guide-done').click({ timeout: 5000 }).catch(() => {})
  await page.getByRole('button', { name: '跳过简报，直接进入工作台' }).click()
  await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 15_000 })
}

async function openLoom(page: Page): Promise<void> {
  await page.getByTestId('center-view-loom').click()
  await expect(page.getByTestId('loom-panel')).toBeVisible()
  await expect(page.getByTestId('loom-canvas')).toBeVisible()
}

async function waitNodeDone(page: Page, nodeId: string, timeout = 90_000): Promise<void> {
  await expect
    .poll(
      async () => page.locator(`[data-node-id="${nodeId}"]`).filter({ hasText: '已完成' }).count(),
      { timeout, intervals: [500] },
    )
    .toBe(1)
}

async function getLog(request: APIRequestContext): Promise<MockReq[]> {
  const res = await request.get(`${MOCK}/__log`)
  const body = (await res.json()) as { requests: MockReq[] }
  return body.requests
}

async function resetMock(request: APIRequestContext): Promise<void> {
  await request.post(`${MOCK}/__reset`)
}

/** 读取画布持久化（localStorage） */
async function readBoard(
  page: Page,
): Promise<{ nodes: { id: string; title: string; type: string; status: string; artifactId?: string; runOutput?: string }[] }> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('edustudio:loom')
    const parsed = raw ? JSON.parse(raw) : { boards: [] }
    return parsed.boards?.[0] ?? { nodes: [] }
  })
}

async function readNodeRunOutput(page: Page, nodeId: string): Promise<string> {
  const board = await readBoard(page)
  return board.nodes.find((n) => n.id === nodeId)?.runOutput ?? ''
}

/* ---------------- S1 · 依赖链真实执行 ---------------- */

test('S1 依赖链：A(function-calling) → B(上游注入 + Plan-JSON 降级 + 文档流)', async ({ page, request }) => {
  await resetMock(request)
  await prepare(page, CHAIN_AB)
  await loginAsTeacher(page)
  await openLoom(page)

  const t0 = Date.now()
  await page.getByTestId('loom-run').click()
  await waitNodeDone(page, 'lnode-a')
  const aDoneAt = Date.now()
  await waitNodeDone(page, 'lnode-b')
  const bDoneAt = Date.now()

  const reqs = await getLog(request)
  const list = reqs.filter((r) => r.kind !== 'briefing') // 去掉简报生成噪声

  /* ---- A：function-calling 主路径 ---- */
  const aTool = list.find((r) => r.kind === 'tools' && r.response.startsWith('tool_calls'))
  expect(aTool, 'A 首轮应下发 tools 并返回 tool_calls').toBeTruthy()
  expect(aTool!.toolNames).toContain('queryClassLearning')
  /* v0.9.4-03：任务型目标 system 追加执行约束（降低「只给文字不调工具」白跑一次） */
  expect(aTool!.taskHint, '任务型目标应注入【执行要求】约束').toBe(true)
  const aFinal = list.find((r) => r.kind === 'tools' && r.hasToolResult)
  expect(aFinal?.response, 'A 工具结果回填后应产出收尾文本').toBe('final_text')

  /* ---- B：上游注入 ---- */
  const bFirst = list.find((r) => r.kind === 'tools' && r.user.includes('上游任务结果'))
  expect(bFirst, 'B 请求应注入「上游任务结果」').toBeTruthy()
  expect(bFirst!.user).toContain('- 分析学情：')
  expect(bFirst!.user).toContain('61%')
  expect(bFirst!.user).toContain('当前目标：根据上游分析结果生成三档分层练习')

  /* ---- B：Plan-JSON 降级（同样携带上游） ---- */
  const bPlan = list.find((r) => r.kind === 'plan' && r.user.includes('上游任务结果'))
  expect(bPlan, 'B 应触发 Plan-JSON 降级并保留上游结果').toBeTruthy()

  /* ---- 文档流 ---- */
  const art = list.find((r) => r.kind === 'artifact')
  expect(art, '应真实调用 LLM 流式生成文档').toBeTruthy()
  expect(art!.response).toBe('artifact_markdown')
  /* v0.9.4-03 修复：文档生成携带上游节点输出（承接上游结论，而非只带目标） */
  expect(art!.user, '文档生成应携带上游结果段').toContain('【上游任务结果】')
  expect(art!.user).toContain('61%')

  /* ---- 画布 / 存储断言 ---- */
  /* v0.9.4-03 修复：Agent 产出文档 → 画布出现「📄 文档」节点（A + B + 文档 = 3） */
  const nodeCount = await page.locator('[data-node-id]').count()
  expect(nodeCount, 'A + B + 自动出现的文档节点').toBe(3)
  const board = await readBoard(page)
  const docNode = board.nodes.find((n) => n.type === 'artifact')
  expect(docNode?.artifactId, '文档节点应绑定 artifactId').toBeTruthy()
  expect(docNode?.status, '生成完成后文档节点应为已完成（done）').toBe('done')

  await expect
    .poll(async () => readNodeRunOutput(page, 'lnode-a'), { timeout: 15_000, intervals: [400] })
    .toContain('61%')
  const outA = await readNodeRunOutput(page, 'lnode-a')
  expect(outA, 'A 输出应含工具结果摘要').toContain('工具结果')
  const outB = await readNodeRunOutput(page, 'lnode-b')
  expect(outB.length, 'B 输出应被采集').toBeGreaterThan(20)

  const docs = await page.evaluate(() => {
    const raw = localStorage.getItem('edustudio:artifacts')
    return raw ? JSON.parse(raw) : { docs: [] }
  })
  expect(docs.docs.length, '文档应真实产出并持久化').toBeGreaterThan(0)
  expect(docs.docs[0].content).toContain('函数单调性')

  /* 文档节点「打开」入口存在（v0.9.4-03 补接线）→ 点击后右栏文档正文可见 */
  const openBtn = page.locator('[data-testid="loom-artifact-open"]')
  await expect(openBtn, '文档节点应有「打开」入口').toHaveCount(1)
  await openBtn.click()
  await expect(page.getByTestId('doc-body')).toBeVisible()
  await expect(page.getByTestId('doc-body')).toContainText('分层练习')

  /* ---- Trace 空间投影（真实 LLM trace → 节点内子图） ---- */
  const kindsOf = async (nodeId: string): Promise<string[]> => {
    await page.locator(`[data-node-id="${nodeId}"] [data-testid="loom-node-expand"]`).click()
    await expect(page.locator(`[data-node-id="${nodeId}"] [data-testid="loom-trace-subgraph"]`)).toBeVisible()
    return page
      .locator(`[data-node-id="${nodeId}"] [data-testid="loom-trace-item"]`)
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-kind') ?? ''))
  }
  const kindsA = await kindsOf('lnode-a')
  expect(kindsA, 'A（function-calling 路径）投影应含 plan（v0.9.4-03 补齐）').toContain('plan')
  expect(kindsA, 'A 投影应含工具项').toContain('tool')
  const kindsB = await kindsOf('lnode-b')
  expect(kindsB, 'B（Plan-JSON 降级路径）投影应含 plan').toContain('plan')
  expect(kindsB, 'B 投影应含工具项').toContain('tool')
  expect(kindsB, 'B 投影应含文档项（v0.9.4-03 接通 artifact 事件入 trace）').toContain('artifact')

  const traceKinds = await page.evaluate(() => {
    const chat = JSON.parse(localStorage.getItem('edustudio:chat') || '[]')
    const entries = chat.flatMap((s: { entries: { role: string; trace: { kind: string }[] }[] }) => s.entries)
    return entries
      .filter((e: { role: string }) => e.role === 'assistant')
      .flatMap((e: { trace: { kind: string }[] }) => e.trace.map((t) => t.kind))
  })
  expect(traceKinds, 'artifact 事件已写入 entry.trace').toContain('artifact_meta')
  expect(traceKinds, 'artifact_done 已写入 entry.trace').toContain('artifact_done')

  console.log(
    `[eval] S1 耗时：A 完成 ${aDoneAt - t0}ms / 全链完成 ${bDoneAt - t0}ms / LLM 请求 ${list.length} 次 / 投影 A=[${kindsA.join(',')}] B=[${kindsB.join(',')}] / entry.trace kinds=[${[...new Set(traceKinds)].join(',')}]`,
  )
})

/* ---------------- S2 · 人工确认 ---------------- */

test('S2 人工确认：执行到 checkpoint 暂停，确认后继续下游（上游穿透注入）', async ({ page, request }) => {
  await resetMock(request)
  await prepare(page, CHAIN_CHECKPOINT)
  await loginAsTeacher(page)
  await openLoom(page)

  await page.getByTestId('loom-run').click()
  await waitNodeDone(page, 'lnode-a')
  await expect(page.locator('[data-node-id="lnode-cp"]')).toContainText('需要你的确认', { timeout: 30_000 })

  /* 暂停期间下游不应执行 */
  const mid = (await getLog(request)).filter((r) => r.kind !== 'briefing')
  expect(
    mid.some((r) => r.user.includes('根据上游分析结果生成三档分层练习')),
    'checkpoint 暂停期间下游不应发起 LLM 请求',
  ).toBe(false)

  /* 确认继续 → 下游执行 */
  await page.getByTestId('loom-checkpoint-continue').click()
  await waitNodeDone(page, 'lnode-b')

  const reqs = (await getLog(request)).filter((r) => r.kind !== 'briefing')
  const bFirst = reqs.find((r) => r.kind === 'tools' && r.user.includes('上游任务结果'))
  expect(bFirst, 'B 请求应携带上游结果段').toBeTruthy()
  /* v0.9.4-03 修复：checkpoint 不构成信息边界 → 下游收到更上游 A 的分析结果 */
  expect(bFirst!.user).toContain('- 分析学情：')
  expect(bFirst!.user).toContain('61%')
  expect(bFirst!.user).not.toContain('（暂无文本输出）')
})

/* ---------------- S3 · 便签与执行边界 ---------------- */

test('S3 便签边界：便签不参与执行、不消耗 LLM 调用（v0.9.4-03 修复）', async ({ page, request }) => {
  await resetMock(request)
  await prepare(page, BOARD_WITH_NOTE)
  await loginAsTeacher(page)
  await openLoom(page)

  await page.getByTestId('loom-run').click()
  /* 只等待 AI 模块完成（便签不执行） */
  await waitNodeDone(page, 'lnode-a', 120_000)

  const reqs = (await getLog(request)).filter((r) => r.kind !== 'briefing')
  const noteReq = reqs.find((r) => r.user.includes('随手记'))
  const board = await readBoard(page)
  const note = board.nodes.find((n) => n.id === 'lnode-note')

  console.log(
    `[eval] S3 便签被发起 LLM 请求: ${!!noteReq}；便签最终状态: ${note?.status}；本轮 LLM 请求 ${reqs.length} 次`,
  )
  /* v0.9.4-03 修复：便签不参与执行、不消耗 LLM 调用、保持待处理 */
  expect(!!noteReq, '便签不应发起 LLM 请求').toBe(false)
  expect(note?.status, '便签保持待处理（idle）').toBe('idle')
})

/* ---------------- S4 · LLM 失败兜底 ---------------- */

test('S4 失败兜底：500 错误 → 回退 Mock 剧本且画布可见（v0.9.4-03）', async ({ page, request }) => {
  await resetMock(request)
  await request.post(`${MOCK}/__config`, { data: { failNext: 1, failOnlyTools: true } })
  await prepare(page, SINGLE_AGENT)
  await loginAsTeacher(page)
  await openLoom(page)

  await page.getByTestId('loom-run').click()
  /* v0.9.4-03 修复：降级在画布上可见（toast 提示回退内置剧本执行） */
  await expect(
    page.locator('[data-testid="loom-toast"]').filter({ hasText: '回退内置剧本' }),
  ).toBeVisible({ timeout: 30_000 })
  await waitNodeDone(page, 'lnode-a', 120_000)

  const reqs = (await getLog(request)).filter((r) => r.kind !== 'briefing')
  const failed = reqs.filter((r) => r.response === 'injected_error')
  expect(failed.length, '应有 1 次注入的 500 失败').toBe(1)

  /* 节点最终仍完成（Mock 兜底），trace 中可见回退说明 */
  const traceText = await page.evaluate(() => {
    const chat = JSON.parse(localStorage.getItem('edustudio:chat') || '[]')
    const entry = chat
      .flatMap((s: { entries: { role: string; trace: unknown[] }[] }) => s.entries)
      .filter((e: { role: string }) => e.role === 'assistant')
      .pop()
    return JSON.stringify(entry?.trace ?? [])
  })
  expect(traceText).toContain('已自动切换 Mock 剧本')

  console.log(`[eval] S4 失败次数 ${failed.length}，节点兜底后状态：已完成`)
})

/* ---------------- S6 · 简报采纳 → 画布任务节点 ---------------- */

test('S6 简报采纳（API 生成的卡片）：采纳 → 画布出现任务节点', async ({ page, request }) => {
  test.setTimeout(120_000)
  await resetMock(request)
  await prepare(page, null)

  await page.goto('/')
  await page.getByTestId('login-account').fill(TEACHER.account)
  await page.getByTestId('login-password').fill(TEACHER.password)
  await page.getByTestId('role-card-teacher').click()
  await page.getByTestId('login-submit').click()
  await page.getByTestId('guide-done').click({ timeout: 5000 }).catch(() => {})

  /* API 模式：卡组由（模拟）LLM 生成 —— 断言 mock 输出的卡片标题真实上屏 */
  await expect(page.getByText('函数单调性掌握率 61%').first()).toBeVisible({ timeout: 30_000 })
  const briefingReqs = (await getLog(request)).filter((r) => r.kind === 'briefing')
  expect(briefingReqs.length, '应发生 LLM 简报生成请求').toBeGreaterThan(0)

  /* 采纳多张卡（只有带 openTask 动作的卡才立项进画布；专注模式后台执行，不跳工作台） */
  for (let i = 0; i < 4; i += 1) {
    const adopt = page.getByTestId('adopt-btn')
    if ((await adopt.count()) === 0) break
    await adopt.first().click()
    await page.waitForTimeout(700)
  }

  /* 跳过简报进工作台 → 打开画布：任务节点应已在（幂等绑定） */
  await page.getByRole('button', { name: /跳过简报/ }).click()
  await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 10_000 })
  await openLoom(page)
  const nodes = page.locator('[data-node-id]')
  await expect.poll(async () => nodes.count(), { timeout: 10_000 }).toBeGreaterThan(0)
  await expect(nodes.first()).toContainText('任务')
  console.log(`[eval] S6 简报采纳 → 画布任务节点数：${await nodes.count()}`)
})

/* ---------------- S7 · 单飞互斥 ---------------- */

test('S7 单飞互斥：用户执行中点「开始处理」→ 节点回队，消息完成后可再跑', async ({ page, request }) => {
  test.setTimeout(180_000)
  await resetMock(request)
  await prepare(page, SINGLE_AGENT)
  await loginAsTeacher(page)

  /* 用户手动发一条消息（模拟 LLM 对「家长会」目标慢速响应，制造执行窗口） */
  await page.getByTestId('chat-input').fill('帮我写一份家长会发言要点')
  await page.getByTestId('chat-input').press('Enter')
  await page.waitForTimeout(500)

  /* 执行中切到画布点「开始处理」：单飞被占用 → 节点回 queued 等待 */
  await openLoom(page)
  await page.getByTestId('loom-run').click()
  await expect
    .poll(async () => (await readBoard(page)).nodes[0]?.status, { timeout: 10_000, intervals: [300] })
    .toBe('queued')
  console.log(`[eval] S7 单飞占用时节点状态：${(await readBoard(page)).nodes[0]?.status}`)

  /* 等用户消息执行完（发送按钮恢复），再次「开始处理」→ 节点真正执行完成 */
  await expect(page.getByTestId('chat-send')).toHaveCount(1, { timeout: 120_000 })
  await page.getByTestId('loom-run').click()
  await waitNodeDone(page, 'lnode-a', 120_000)
  console.log('[eval] S7 用户消息完成后再次「开始处理」→ 节点已完成')
})
