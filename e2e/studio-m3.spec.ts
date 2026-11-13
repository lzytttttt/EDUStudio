import { expect, test, type Page } from '@playwright/test'

/**
 * v1.2 M3 · 真执行内核 + 门与交付收口 E2E（统一工作区 `?v2=1`）
 *
 * 覆盖 roadmap §6 M3a/M3b 验收：
 * - Mock 执行可见（角标「Mock 执行」）且 mission 由 MissionRunner 驱动（拓扑/并发/门/产物）；
 * - 真执行（`?exec=real` + 固定 SSE）跑 4–8 节点 mission，角标「真执行」，交付物经证据校验入文档面板；
 * - 审批门统一决策卡（`approval-gate-card`）且通过一次只回执一次；
 * - 刷新续跑：门等待中 reload → 已暂停 · 继续 → 从断点续跑（completedTasks seed 不重跑已完成环节）；
 * - 旧 `?v1=1` 整屏与既有 43 条 E2E 零改动由全量套件保障。
 */

/** 固定 SSE 响应：content 增量 + [DONE]（OpenAI 兼容增量口径，见 src/harness/llm/sse.ts） */
function sseBody(content: string): string {
  const chunk = JSON.stringify({
    id: 'chatcmpl-m3-e2e',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  })
  return `data: ${chunk}\n\ndata: [DONE]\n\n`
}

/** 写入 API 模式 settings（与 src/stores/settingsStore.ts 持久化格式一致；baseUrl 指向不可解析测试域，全部走 route） */
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

/**
 * M3 真执行的固定 SSE 路由：
 * - 首轮 function-calling → 空内容（触发 Plan-JSON 降级，不依赖工具调用协议细节）；
 * - Plan-JSON 降级 → 一个 artifact 步骤；
 * - 文档生成 → 一份可发布的 Markdown（标题供 runner 收集为 RunnerArtifact）。
 */
async function mockRealExecutionLlm(page: Page): Promise<{ hits: number }> {
  const counter = { hits: 0 }
  await page.route('**/chat/completions', async (route) => {
    counter.hits += 1
    const payload = JSON.stringify(route.request().postDataJSON() ?? {})
    if (payload.includes('你现在直接产出一份完整的 Markdown 文档')) {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseBody('# 分层练习单\n\n依据本班学情数据编制，用于单元考后分层巩固。\n'),
      })
    }
    if (payload.includes('请仅输出一个 JSON 对象')) {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseBody(JSON.stringify({ steps: [{ type: 'artifact', kind: 'lessonPlan' }] })),
      })
    }
    /* 首轮：空内容 → Orchestrator 走 Plan-JSON 降级 */
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: [DONE]\n\n' })
  })
  return counter
}

async function dismissGuide(page: Page): Promise<void> {
  await page.getByTestId('guide-done').click({ timeout: 4000 }).catch(() => {})
}

async function openStudio(page: Page, query = '?v2=1&tour=0'): Promise<void> {
  await page.goto(`/${query}`)
  await expect(page.getByTestId('studio-shell')).toBeVisible()
}

/** 进入作战室并确认计划（模板 plan 已由 ?mission=exam_loop 种下） */
async function startMission(page: Page): Promise<void> {
  await page.getByTestId('studio-nav-mission').click()
  await expect(page.getByTestId('mission-plan')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: '开战' }).click()
  await expect(page.getByTestId('mission-live')).toBeVisible()
}

/**
 * 审批门（顺序由 runner ready-set 决定，测试不假设先后）：
 * 统一决策卡断言 + 放行；**等待「下一张门或 done 出现」**（最后一张门通过后 mission 收尾有短暂延迟），
 * 重复直到 mission-done 出现（最多 4 张门）。
 */
async function resolveAllGates(page: Page): Promise<void> {
  const done = page.getByTestId('mission-done')
  const card = page.getByTestId('mission-gate')
  for (let i = 0; i < 4; i += 1) {
    await expect
      .poll(
        async () => {
          if (await done.isVisible().catch(() => false)) return 'done'
          if (await card.isVisible().catch(() => false)) return 'gate'
          return 'wait'
        },
        { timeout: 45_000, intervals: [250, 500, 1000] },
      )
      .not.toBe('wait')
    if (await done.isVisible().catch(() => false)) break
    await expect(card.getByTestId('approval-gate-card')).toBeVisible()
    const approve = card.getByRole('button', { name: '放行' })
    if ((await approve.count()) > 0) await approve.click()
    else await card.getByTestId('approval-gate-approve').click()
    /* 这张门收口（下一张门 / done 由下一轮 poll 等待） */
    await expect.poll(async () => (await card.isVisible().catch(() => false)) === false, { timeout: 15_000 }).toBe(true)
  }
  await expect(done).toBeVisible({ timeout: 30_000 })
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => console.log('[pageerror]', error.message))
  /* 只在同一 tab 首次导航时清库：刷新续跑用例需要 reload 后保留 director 持久化状态 */
  await page.addInitScript(() => {
    if (sessionStorage.getItem('edustudio-e2e-cleared') === '1') return
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('edustudio:')) localStorage.removeItem(key)
    }
    sessionStorage.setItem('edustudio-e2e-cleared', '1')
  })
})

test.describe('M3 · 真执行内核（Mock 兜底可见）', () => {
  test('Mock 执行：MissionRunner 驱动 mission，门走统一决策卡，交付物进入文档面板', async ({ page }) => {
    test.setTimeout(150_000)
    await openStudio(page, '?v2=1&mission=exam_loop&tour=0')
    await startMission(page)

    /* 角标必须显式标「Mock 执行」（不假装真 LLM） */
    const badge = page.getByTestId('command-execution-badge')
    await expect(badge).toBeVisible()
    await expect(badge).toContainText('Mock 执行')

    await resolveAllGates(page)

    /* 切换经典工作区：Mock 模式沿用模板交付物（M2 行为），作战包应出现 */
    await page.getByTestId('studio-workspace-classic').click()
    await dismissGuide(page)
    await expect(page.getByTestId('chat-input')).toBeVisible()
    await page.getByTestId('tab-doc').click()
    await expect(page.getByTestId('artifact-package-group')).toBeVisible({ timeout: 15_000 })
  })

  test('刷新续跑：门等待中 reload → 已暂停 · 继续 → 从断点完成（不重跑已完成环节）', async ({ page }) => {
    test.setTimeout(150_000)
    await openStudio(page, '?v2=1&mission=exam_loop&tour=0')
    await startMission(page)

    /* 等首道门出现（runner 在门处等待，mission.status=waiting 已持久化） */
    await expect(page.getByTestId('mission-gate')).toBeVisible({ timeout: 30_000 })
    await page.reload()

    /* 刷新后 URL 未带 view=mission：先回作战室，应显示「已暂停 · 继续」 */
    await expect(page.getByTestId('studio-shell')).toBeVisible()
    await page.getByTestId('studio-nav-mission').click()
    await expect(page.getByTestId('mission-paused')).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: '继续', exact: true }).click()

    await resolveAllGates(page)
  })
})

test.describe('M3 · 真执行（固定 SSE）', () => {
  test('真 LLM 路径：角标真执行，4–8 节点跑通，交付物经证据校验进入作战包', async ({ page }) => {
    test.setTimeout(210_000)
    await useApiMode(page)
    const counter = await mockRealExecutionLlm(page)

    await openStudio(page, '?v2=1&exec=real&mission=exam_loop&tour=0')
    await startMission(page)

    const badge = page.getByTestId('command-execution-badge')
    await expect(badge).toContainText('真执行')
    await expect(badge).not.toContainText('Mock 执行')

    await resolveAllGates(page)
    expect(counter.hits).toBeGreaterThan(0)

    /* 真执行：交付物由 runner 产物经 verifyCitations 后发布（includeTemplates=false） */
    await page.getByTestId('studio-workspace-classic').click()
    await dismissGuide(page)
    await expect(page.getByTestId('chat-input')).toBeVisible()
    await page.getByTestId('tab-doc').click()
    await expect(page.getByTestId('artifact-package-group')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('doc-list-btn').click()
    await expect(page.getByTestId('doc-list-panel')).toBeVisible()
    await expect(page.getByTestId('doc-list-panel')).toContainText('分层练习单')
  })
})
