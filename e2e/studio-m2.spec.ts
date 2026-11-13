import { expect, test, type Page } from '@playwright/test'

/**
 * v1.2 M2 · 实体融合 E2E（统一工作区 `?v2=1` 影子期）
 *
 * 覆盖 roadmap §6 M2 验收：
 * - 简报采纳 → 战情台出现同源待办（不重复计数：列表条数 = 战情台角标）；
 * - mission 交付物出现在旧「文档」面板（作战包分组），可继续导出/分享；
 * - 右栏只读「团队」tab（成员状态 + 待批准数）；
 * - 设置页「工作区」分组（启动页 / 默认执行模式 / 引导重看）；
 * - 旧入口（`?v1=1` 整屏、默认旧三屏）零回归由既有 35 条 E2E 保障。
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('edustudio:')) localStorage.removeItem(key)
    }
  })
})

async function dismissGuide(page: Page): Promise<void> {
  await page.getByTestId('guide-done').click({ timeout: 4000 }).catch(() => {})
}

/** `?v2=1` 统一壳入口（自动教师身份 + 关引导） */
async function openStudio(page: Page, query = '?v2=1&tour=0'): Promise<void> {
  await page.goto(`/${query}`)
  await expect(page.getByTestId('studio-shell')).toBeVisible()
}

test.describe('M2 · 简报采纳 → 战情台同源待办', () => {
  test('采纳后战情台出现同源待办，角标与列表同口径（不出现两套计数）', async ({ page }) => {
    /* 经典工作区简报：采纳一张 Mock 卡（卡片均带 openTask 动作；专注模式默认不跳转） */
    await openStudio(page, '?v2=1&view=briefing&tour=0')
    await dismissGuide(page)
    await expect(page.getByTestId('adopt-btn')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('adopt-btn').click()

    /* 切到总指挥工作区：派生收件箱应出现该「已代办」条目 */
    await page.getByTestId('studio-workspace-director').click()
    await expect(page.getByTestId('command-inbox-derived')).toBeVisible()
    const items = page.locator('[data-testid="command-inbox-item"]')
    await expect(items.first()).toBeVisible({ timeout: 10_000 })

    /* 双计数为 0：战情台导航角标 = 派生列表条数 */
    const count = await items.count()
    await expect(page.getByTestId('studio-nav-inbox-badge')).toHaveText(String(count))
    /* 顶栏收件箱角标存在（= 待办 + 未读通知，同一口径的含通知总角标） */
    await expect(page.getByTestId('studio-inbox-bell-badge')).toBeVisible()

    /* 点开同源待办：可看到它关联的会话（跳到经典工作区对应会话） */
    await items.first().getByTestId('command-inbox-open').click()
    await expect(page).toHaveURL(/view=chat/)
    await expect(page.getByTestId('chat-input')).toBeVisible()
  })

  test('旧整屏 ?v1=1 战情台不回归（仍为旧决策卡，非派生列表）', async ({ page }) => {
    await page.goto('/?v1=1&tour=0')
    await expect(page.getByTestId('director-inbox')).toBeVisible()
    await expect(page.getByTestId('director-decision-d-drill')).toBeVisible()
    await expect(page.getByTestId('command-inbox-derived')).toHaveCount(0)
  })
})

test.describe('M2 · mission 交付物进入旧文档面板', () => {
  test('单元考闭环跑完 → 经典工作区文档面板「作战包」可见并可导出', async ({ page }) => {
    test.setTimeout(120_000)
    /* `?mission=exam_loop` 一次性种计划（不跳屏）；再进入作战室开战 */
    await openStudio(page, '?v2=1&mission=exam_loop&tour=0')
    await page.getByTestId('studio-nav-mission').click()
    await expect(page.getByTestId('mission-plan')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: '开战' }).click()
    await expect(page.getByTestId('mission-live')).toBeVisible()

    /* exam_loop 两道门：worksheet → lesson */
    for (const gate of ['worksheet', 'lesson']) {
      const card = page.getByTestId('mission-gate')
      await expect(card).toBeVisible({ timeout: 20_000 })
      await expect(card).toHaveAttribute('data-gate', gate)
      await card.getByRole('button', { name: '放行' }).click()
    }
    await expect(page.getByTestId('mission-done')).toBeVisible({ timeout: 30_000 })

    /* 切经典工作区 → 右栏文档：交付物应已由发布桥写入 artifactStore */
    await page.getByTestId('studio-workspace-classic').click()
    await dismissGuide(page)
    await expect(page.getByTestId('chat-input')).toBeVisible()
    await page.getByTestId('tab-doc').click()
    await expect(page.getByTestId('artifact-package-group')).toBeVisible({ timeout: 15_000 })
    /* 作战包内至少 1 份交付物可打开正文（导出/分享沿用旧能力） */
    await page.getByTestId('doc-list-btn').click()
    await expect(page.getByTestId('doc-list-panel')).toBeVisible()
    await expect(page.getByTestId('doc-list-panel').getByText('分层练习')).toBeVisible()
  })
})

test.describe('M2 · 右栏只读团队 + 设置工作区', () => {
  test('经典工作区右栏「团队」tab：成员状态与待批准数只读可见', async ({ page }) => {
    await openStudio(page)
    await page.getByTestId('studio-workspace-classic').click()
    await dismissGuide(page)
    await expect(page.getByTestId('chat-input')).toBeVisible()
    await page.getByTestId('tab-team').click()
    await expect(page.getByTestId('team-summary')).toBeVisible()
    await expect(page.getByTestId('team-summary-pending')).toBeVisible()
    await expect(page.getByTestId('team-summary-agent-chief')).toBeVisible()
    /* 只读：不出现授权编辑控件（旧战队页才可授权） */
    await expect(page.getByTestId('team-summary').getByTestId('team-autonomy-L2')).toHaveCount(0)
  })

  test('设置页「工作区」分组：启动页 / 默认执行模式 / 引导重看', async ({ page }) => {
    await openStudio(page)
    await page.getByTestId('studio-settings').click()
    await expect(page.getByTestId('studio-settings-group')).toBeVisible()
    await expect(page.getByTestId('studio-landing-select')).toBeVisible()
    await expect(page.getByTestId('studio-execution-select')).toBeVisible()
    await page.getByTestId('studio-landing-select').selectOption('inbox')
    await page.getByTestId('studio-execution-select').selectOption('mock')
    await page.getByTestId('studio-guide-reset').click()
    /* 关闭设置后设置已持久化（重新打开仍为 inbox） */
    await page.keyboard.press('Escape')
    await page.getByTestId('studio-settings').click()
    await expect(page.getByTestId('studio-landing-select')).toHaveValue('inbox')
    await expect(page.getByTestId('studio-execution-select')).toHaveValue('mock')
  })
})
