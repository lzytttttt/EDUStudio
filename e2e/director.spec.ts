import { test, expect, type Page } from '@playwright/test'

/**
 * v1.0/v1.1 总指挥模式 E2E：
 * - 少字界面靠 data-testid 定位，不依赖文案；
 * - `?v1=1` 直达（教师身份），`?tour=0` 关闭引导，保证可重复；
 * - v1.1 新增（M0–M3 收口后）：
 *   · 真 LLM 成功（page.route 固定 SSE → plan-source「真 LLM」）；
 *   · LLM 失败回退（500 + `?llm=0` 强制模板，route 0 命中）；
 *   · 刷新续跑（running → paused → 继续 → 两门 → 交付，决策保留）；
 *   · 第二剧本「单元考闭环」（4 环节 / 2 拍板 / 4 件交付，无「家长会」口径）；
 * - 旧入口（?demo=1 → 今日简报）保留一条冒烟，防止入口改动回归。
 */

/** 一句话委托输入框（设计冻结的 aria-label） */
const UTTERANCE_INPUT = 'input[aria-label="一句话委托"]'
/** 父剧本（v1.0 家长会）原话 */
const PARENT_UTTERANCE = '下周三家长会，材料帮我备齐'
/** 第二剧本（v1.1 单元考闭环）原话 */
const EXAM_UTTERANCE = '用高一（3）班这次单元考做个诊断，出一套分层练习，再备一节习题课。'

/* ------------------------------------------------------------------ */
/* 真 LLM 注入：settingsStore 存储键 `edustudio:settings` + API 模式     */
/* ------------------------------------------------------------------ */

/**
 * 在页面脚本执行前写入 api 模式 settings（与 src/stores/settingsStore.ts 的持久化格式一致）。
 * baseUrl 指向不可解析的测试域名：route 命中失败时请求会立刻失败（network 回退），
 * 保证 E2E 永不触碰真实模型服务。
 */
async function useApiMode(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'edustudio:settings',
      JSON.stringify({
        mode: 'api',
        baseUrl: 'https://e2e-llm.invalid/v1',
        model: 'e2e-mock-model',
        apiKey: 'sk-e2e-dummy',
        proxyUrl: '',
        dataSource: 'seed',
      }),
    )
  })
}

/** 固定 SSE 响应：一次 content 增量 + [DONE]（解析口径见 src/harness/llm/sse.ts） */
function sseBody(content: string): string {
  const chunk = JSON.stringify({
    id: 'chatcmpl-e2e',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  })
  return `data: ${chunk}\n\ndata: [DONE]\n\n`
}

/** 真 LLM 返回的合法 wire 计划（validatePlan 8 条矩阵全过；含可识别的自定义 title） */
const LLM_PLAN = {
  kind: 'parent_meeting',
  title: '家长会拆解',
  tasks: [
    { id: 'w1', agentId: 'analyst', title: '真拆解核对学情', deps: [] },
    { id: 'w2', agentId: 'curriculum', title: '起草发言稿与 PPT 大纲', deps: ['w1'], gate: 'speech' },
    { id: 'w3', agentId: 'communicator', title: '写 3 封家长信', deps: ['w1'], gate: 'letters' },
    { id: 'w4', agentId: 'curriculum', title: '校准语气与合规', deps: ['w3'] },
    { id: 'w5', agentId: 'chief', title: '汇总与三道校验', deps: ['w2', 'w3'] },
  ],
  gates: ['speech', 'letters'],
  deliverables: ['简报', '讲稿', '大纲', '信件'],
  estimateMinutes: 8,
}

/* ------------------------------------------------------------------ */
/* 通用步骤                                                            */
/* ------------------------------------------------------------------ */

async function openInbox(page: Page, query = '?v1=1&tour=0'): Promise<void> {
  await page.goto(`/${query}`)
  await expect(page.getByTestId('director-inbox')).toBeVisible()
}

async function dispatch(page: Page, utterance: string): Promise<void> {
  await page.locator(UTTERANCE_INPUT).fill(utterance)
  await page.getByLabel('交给战队').click()
}

/** 等计划卡出现（真 LLM 路径最长 15s 超时） */
async function waitPlan(page: Page): Promise<void> {
  await expect(page.getByTestId('mission-plan')).toBeVisible({ timeout: 15_000 })
}

/** 从计划 chip 里取数字（如「4 环节」→ 4），并做范围断言 */
async function chipNumber(page: Page, pattern: RegExp): Promise<number> {
  const chip = page.getByTestId('mission-plan').getByText(pattern)
  await expect(chip).toBeVisible()
  const text = (await chip.textContent()) ?? ''
  return Number(text.replace(/[^\d]/g, ''))
}

async function fight(page: Page): Promise<void> {
  await page.getByRole('button', { name: '开战' }).click()
  await expect(page.getByTestId('mission-live')).toBeVisible()
}

/** 审批门：等出现 → 校验 data-gate → 点主按钮（speech/worksheet/lesson 是「放行」，letters 是「发送」） */
async function approveGate(page: Page, gate: string, primary = '放行'): Promise<void> {
  const card = page.getByTestId('mission-gate')
  await expect(card).toBeVisible({ timeout: 15_000 })
  await expect(card).toHaveAttribute('data-gate', gate)
  await card.getByRole('button', { name: primary }).click()
}

/**
 * done 页统计由 StatCell 渲染成「值」「标签」两个 span（不是「4 件交付」连写），
 * 这里用标签 span 的父容器断言完整文本。
 */
async function expectStat(page: Page, label: string, expected: string): Promise<void> {
  const labelSpan = page.getByTestId('mission-done').getByText(label, { exact: true })
  await expect(labelSpan).toBeVisible()
  await expect(labelSpan.locator('..')).toContainText(expected)
}

/* ------------------------------------------------------------------ */
/* v1.1 新增 1：真 LLM 成功                                             */
/* ------------------------------------------------------------------ */

test.describe('Director 总指挥模式（v1.0 预览）', () => {
  test('战情台：3 张决策卡，先看再做，采纳后卡片完成并联动单元考计划', async ({ page }) => {
    await openInbox(page)
    await expect(page.getByTestId('director-decision-d-drill')).toBeVisible()
    await expect(page.getByTestId('director-decision-d-letters')).toBeVisible()
    await expect(page.getByTestId('director-decision-d-conflict')).toBeVisible()

    await page.getByTestId('director-decision-d-drill').click()
    await expect(page.getByText('分层练习已备好').last()).toBeVisible()
    await page.getByLabel('预览', { exact: true }).getByRole('button', { name: '采纳' }).click()
    /* v1.1：d-drill 采纳 = 种下 exam_loop 计划（只种计划、不跳屏） */
    await expect(page.getByText('已采纳 · 单元考闭环计划待确认')).toBeVisible()
    await expect(page.getByTestId('director-decision-d-drill')).toContainText('已处理')
    await expect(page.getByTestId('director-mission-strip')).toContainText('单元考闭环')
    await expect(page.getByTestId('director-mission-strip')).toContainText('计划待确认')
    await expect(page.getByTestId('director-inbox')).toBeVisible()
  })

  test('一句话委托 → 作战计划 → 异步托管 → 两次拍板 → 作战包', async ({ page }) => {
    await openInbox(page)

    await dispatch(page, PARENT_UTTERANCE)
    await expect(page.getByTestId('mission-plan')).toBeVisible()

    /* v1.1：计划必须显示来源；Mock 模式给模板兜底 + 原因一行 */
    await expect(page.getByTestId('plan-source')).toContainText('模板兜底')
    await expect(page.getByTestId('plan-reason')).toContainText('Mock 模式')
    await expect(page.getByTestId('mission-plan')).toContainText('5 环节')
    await expect(page.getByTestId('mission-plan')).toContainText('2 次拍板')

    await fight(page)

    // 第一道审批门（发言稿 / PPT）
    await approveGate(page, 'speech')

    // 第二道审批门（3 封信）
    await approveGate(page, 'letters', '发送')

    // 作战包：v1.1 toast 口径 + done 页统计走 StatCell（两个 span）
    await expect(page.getByTestId('mission-done')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('已交付 · 可导出')).toBeVisible()
    await expect(page.getByTestId('mission-done')).toContainText('你只做了 2 个决定')
    await expectStat(page, '件交付', '4件交付')
    await expectStat(page, '次拍板', '2次拍板')

    // 交付物预览
    await page.getByTestId('mission-artifact-a-letters').click()
    await expect(page.getByTestId('director-sheet')).toContainText('3 封家长信（草稿）')
    await page.keyboard.press('Escape')
  })

  test('引导：可逐步推进并跳过，收尾回到战情台', async ({ page }) => {
    await page.goto('/?v1=1&tour=1')
    await expect(page.getByText('先看这一张')).toBeVisible({ timeout: 8000 })
    await page.getByLabel('下一步').click()
    await expect(page.getByText('长链路事务，一句话交给战队')).toBeVisible()
    await page.getByLabel('跳过引导').click()
    await expect(page.getByText('先看这一张')).toBeHidden()
    await expect(page.getByTestId('director-inbox')).toBeVisible()
  })

  test('战队页：成员卡与授权调整（家校官升到 L2 仍锁发送）', async ({ page }) => {
    await openInbox(page)
    await page.getByTestId('director-dock-team').click()
    await expect(page.getByTestId('team-agent-communicator')).toBeVisible()
    await page.getByTestId('team-agent-communicator').click()
    await expect(page.getByTestId('team-detail')).toBeVisible()
    await page.getByTestId('team-autonomy-L2').click()
    await expect(page.getByText('已授信 · 对外发送仍需你拍板')).toBeVisible()
  })

  test('旧入口不回归：?demo=1 仍直达今日简报', async ({ page }) => {
    await page.goto('/?demo=1')
    await expect(page.getByTestId('adopt-btn')).toBeVisible()
  })

  /* ---------------------------------------------------------------- */
  /* v1.1 新增：真 LLM 成功（route 固定 SSE）                           */
  /* ---------------------------------------------------------------- */

  test('真 LLM 成功：固定 SSE → 计划 4–8 环节、成员/门合法、plan-source 真 LLM', async ({ page }) => {
    await useApiMode(page)
    let hits = 0
    let requestBody: Record<string, unknown> | null = null
    await page.route('**/chat/completions', async (route) => {
      hits += 1
      requestBody = route.request().postDataJSON() as Record<string, unknown>
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream; charset=utf-8' },
        body: sseBody(JSON.stringify(LLM_PLAN)),
      })
    })

    await openInbox(page)
    await dispatch(page, PARENT_UTTERANCE)
    await waitPlan(page)

    /* 1) 计划来源角标 = 真 LLM */
    const source = page.getByTestId('plan-source')
    await expect(source).toContainText('真 LLM')
    await expect(source).not.toContainText('模板兜底')

    /* 2) 计划 4–8 环节 / ≥2 位执行成员 / 1–2 次拍板（数字取自 UI chip，再验范围） */
    const steps = await chipNumber(page, /^\d+ 环节$/)
    const members = await chipNumber(page, /^\d+ 位成员$/)
    const gates = await chipNumber(page, /^\d+ 次拍板$/)
    expect(steps).toBeGreaterThanOrEqual(4)
    expect(steps).toBeLessThanOrEqual(8)
    expect(members).toBeGreaterThanOrEqual(2)
    expect(gates).toBeGreaterThanOrEqual(1)
    expect(gates).toBeLessThanOrEqual(2)

    /* 3) 计划正文确实来自模型（自定义 title / 任务名），不是模板常量 */
    const plan = page.getByTestId('mission-plan')
    await expect(plan).toContainText('家长会拆解')
    await expect(plan).toContainText('真拆解核对学情')
    await expect(plan).not.toContainText('家长会材料包')

    /* 4) 请求只发 1 次；参数与 prompt 契约（temperature/max_tokens/事实快照） */
    expect(hits).toBe(1)
    expect(requestBody).not.toBeNull()
    const body = requestBody as unknown as {
      model: string
      stream: boolean
      temperature: number
      max_tokens: number
      messages: { role: string; content: string }[]
    }
    expect(body.model).toBe('e2e-mock-model')
    expect(body.stream).toBe(true)
    expect(body.temperature).toBe(0.2)
    expect(body.max_tokens).toBe(800)
    expect(body.messages).toHaveLength(2)
    expect(body.messages[1].content).toContain('<utterance>')
    /* P0 事实快照随计划冻结并进入 prompt（82.4 物理均分） */
    expect(body.messages[1].content).toContain('82.4')
  })

  /* ---------------------------------------------------------------- */
  /* v1.1 新增：真 LLM 失败回退 + llm=0 护栏                            */
  /* ---------------------------------------------------------------- */

  test('真 LLM 失败回退：500 → 模板兜底可开战；?llm=0 强制模板 route 0 命中', async ({ page }) => {
    await useApiMode(page)
    let hits = 0
    await page.route('**/chat/completions', async (route) => {
      hits += 1
      await route.fulfill({
        status: 500,
        headers: { 'content-type': 'application/json' },
        body: '{"error":{"message":"e2e boom"}}',
      })
    })

    /* --- ① ?llm=0 彩排护栏：即使 api 模式也不发请求 --- */
    await openInbox(page, '?v1=1&tour=0&llm=0')
    await dispatch(page, PARENT_UTTERANCE)
    await waitPlan(page)
    await expect(page.getByTestId('plan-source')).toContainText('模板兜底')
    await expect(page.getByTestId('plan-reason')).toContainText('已关闭真 LLM')
    expect(hits).toBe(0)
    await fight(page)
    await expect(page.getByTestId('mission-live')).toBeVisible()

    /* --- ② 真实失败：500 重试后回模板，仍然可开战 --- */
    /* 清掉上一段导演状态，保证重新进入是干净战情台（新文档 init script 先于应用执行） */
    await page.addInitScript(() => {
      window.localStorage.removeItem('edustudio:director')
    })
    await openInbox(page)
    await dispatch(page, PARENT_UTTERANCE)
    await waitPlan(page)
    await expect(page.getByTestId('plan-source')).toContainText('模板兜底')
    await expect(page.getByTestId('plan-reason')).toContainText('接口错误')
    /* 5xx 属可重试错误：2 次尝试后回模板（roadmap §4.5） */
    expect(hits).toBe(2)
    await fight(page)
    await expect(page.getByTestId('mission-live')).toBeVisible()
  })

  /* ---------------------------------------------------------------- */
  /* v1.1 新增：刷新续跑（M2）                                          */
  /* ---------------------------------------------------------------- */

  test('刷新续跑：首道门前 reload → 已暂停 · 继续 → 两门 → 交付，决策保留', async ({ page }) => {
    await openInbox(page)
    await dispatch(page, EXAM_UTTERANCE)
    await waitPlan(page)
    await fight(page)

    /* 等到首道门前（feed 出现「分层练习完成」）；此时 cursor 已指向 worksheet 门 */
    await expect(page.getByText('分层练习完成（基础 70% / 提高 30% · 12 题）')).toBeVisible({ timeout: 15_000 })

    await page.reload()
    await expect(page.getByTestId('mission-surface')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('mission-paused')).toBeVisible()
    await expect(page.getByText('已暂停 · 继续')).toBeVisible()

    await page.getByRole('button', { name: '继续', exact: true }).click()

    /* 续跑不重放已完成 feed：直接到 worksheet 门 */
    await approveGate(page, 'worksheet')
    await approveGate(page, 'lesson')

    await expect(page.getByTestId('mission-done')).toBeVisible({ timeout: 15_000 })
    await expectStat(page, '件交付', '4件交付')
    await expectStat(page, '次拍板', '2次拍板')
    await expect(page.getByTestId('mission-artifact-a-drill')).toBeVisible()
    await expect(page.getByTestId('mission-artifact-a-lesson')).toBeVisible()

    /* 决策/授权状态保留：回战情台仍见 3 张决策卡 */
    await page.getByRole('button', { name: '回战情台' }).click()
    await expect(page.getByTestId('director-inbox')).toBeVisible()
    await expect(page.getByTestId('director-decision-d-drill')).toBeVisible()
    await expect(page.getByTestId('director-decision-d-letters')).toBeVisible()
    await expect(page.getByTestId('director-decision-d-conflict')).toBeVisible()
  })

  /* ---------------------------------------------------------------- */
  /* v1.1 新增：第二剧本（单元考闭环）                                  */
  /* ---------------------------------------------------------------- */

  test('第二剧本：单元考闭环 4 环节 / 2 拍板 → worksheet+lesson 两门 → 4 件交付（无家长会）', async ({ page }) => {
    await openInbox(page)
    await dispatch(page, EXAM_UTTERANCE)
    await waitPlan(page)

    const plan = page.getByTestId('mission-plan')
    await expect(plan).toContainText('单元考闭环')
    await expect(plan).toContainText('4 环节')
    await expect(plan).toContainText('2 次拍板')
    await expect(plan).toContainText('3 位成员')

    await fight(page)
    await approveGate(page, 'worksheet')
    await approveGate(page, 'lesson')

    const done = page.getByTestId('mission-done')
    await expect(done).toBeVisible({ timeout: 15_000 })
    await expect(done).toContainText('你只做了 2 个决定')
    await expectStat(page, '件交付', '4件交付')
    await expectStat(page, '次拍板', '2次拍板')
    await expectStat(page, '演示加速', '7s')

    /* 第二剧本 4 件交付物：简报 / 分层练习单 / 习题课教案 / 摘要 */
    for (const id of ['a-brief', 'a-drill', 'a-lesson', 'a-pack']) {
      await expect(page.getByTestId(`mission-artifact-${id}`)).toBeVisible()
    }

    /* 产物口径：含「物理均分 82.4」、不含「家长会」 */
    await page.getByTestId('mission-artifact-a-brief').click()
    const sheet = page.getByTestId('director-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText('物理均分 82.4')
    await expect(sheet).not.toContainText('家长会')
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
  })
})
