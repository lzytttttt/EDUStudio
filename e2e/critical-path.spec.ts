import { expect, test, type Page } from '@playwright/test'

/**
 * v0.4 M3①：关键路径 E2E（Mock 模式，离线可跑）。
 * ① 登录 → 简报 → 采纳（专注模式后台执行）→ 批示完成 → 统一处理 → 工作台（v0.7 改写）
 * ② 对话出题 → 出题工作台联动
 * ③ 文档新建 → 导出下载
 * ④ 生成即见：教案任务后文档面板自动可见且正文持续增长（v0.9.3 P0-A④）
 * ⑤ 演示直达：登录页一键进入简报（v0.9.3 P1-B②）
 * ⑥ URL 演示直达：?demo=1 冷启动直接落在简报（v0.9.3 P1-B②）
 * ⑦ 重新生成弹窗内方向键不误触简报决策（v0.9.3 P0-B②）
 *
 * 注意：v0.7 专注模式默认开启，采纳不再立即跳工作台；需要中性工作台时用「跳过简报」入口。
 */

test.beforeEach(async ({ page }) => {
  // 每条用例从干净状态开始（清掉持久化的登录态/会话/文档）
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('edustudio:')) localStorage.removeItem(key)
    }
  })
})

/** 关闭首次进入的操作引导（未弹出时静默跳过） */
async function dismissGuide(page: Page) {
  await page.getByTestId('guide-done').click({ timeout: 4000 }).catch(() => {})
}

/** 快捷路径：教师身份经「跳过简报」进入中性工作台（不触发任何任务） */
async function loginAsTeacher(page: Page) {
  await page.goto('/')
  await page.getByTestId('login-account').fill('teacher@edustudio.cn')
  await page.getByTestId('login-password').fill('demo1234')
  await page.getByTestId('role-card-teacher').click()
  await page.getByTestId('login-submit').click()
  await dismissGuide(page) // 简报页首次引导
  await page.getByRole('button', { name: '跳过简报，直接进入工作台' }).click()
  await expect(page.getByTestId('chat-input')).toBeVisible()
}

test('① 登录 → 简报 → 采纳（后台执行）→ 批示完成 → 统一处理 → 工作台', async ({ page }) => {
  await page.goto('/')
  // 登录页：账号密码表单 + 三个身份选项
  await expect(page.getByTestId('login-account')).toBeVisible()
  await expect(page.getByTestId('login-password')).toBeVisible()
  await expect(page.getByTestId('role-card-teacher')).toBeVisible()
  await expect(page.getByTestId('role-card-schoolAdmin')).toBeVisible()
  await expect(page.getByTestId('role-card-bureau')).toBeVisible()

  // 填写账号密码、选择教师身份 → 登录进入简报（首次弹出操作引导）
  await page.getByTestId('login-account').fill('teacher@edustudio.cn')
  await page.getByTestId('login-password').fill('demo1234')
  await page.getByTestId('role-card-teacher').click()
  await page.getByTestId('login-submit').click()
  await expect(page.getByTestId('guide-done')).toBeVisible()
  await page.getByTestId('guide-done').click()
  await expect(page.getByTestId('adopt-btn')).toBeVisible()

  // 专注模式（v0.7）：采纳第一张卡 → 任务转入后台执行，浮动指示器出现，不跳工作台
  await page.getByTestId('adopt-btn').click()
  await expect(page.getByTestId('focus-indicator')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('adopt-btn')).toBeVisible() // 仍在简报页

  // 批示循环去硬编码（v0.9 M7②）：从 DOM 解析「已处理 n/N」的 N，剧本卡数变化不再挂测试
  const counterText = await page.getByText(/已处理 \d+\/\d+/).first().textContent()
  const total = Number(counterText?.match(/\/(\d+)/)?.[1] ?? 0)
  expect(total).toBeGreaterThan(0)
  for (let i = 2; i <= total; i++) {
    await page.getByTestId('adopt-btn').click()
    await expect(page.getByText(`已处理 ${i}/${total}`)).toBeVisible({ timeout: 5_000 })
  }

  // 全部批示完成 → 「批示完成」总结层（任务清单 + 统一处理入口）
  await expect(page.getByTestId('focus-enter-workbench')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('focus-task-list')).toBeVisible()

  // 一卡一任务：后台任务 N 条 ↔ 侧栏任务 N 条，不再全挤在一个会话里
  const adopted = await page.getByTestId('focus-task-item').count()
  expect(adopted).toBeGreaterThan(1)

  // 一键「统一处理」→ 进入工作台
  await page.getByTestId('focus-enter-workbench').click()
  await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('task-item')).toHaveCount(adopted)
})

test('② 对话出题 → 出题工作台联动', async ({ page }) => {
  await loginAsTeacher(page)

  // 发送出题目标（Mock 剧本：查学情 → 出题）
  await page.getByTestId('chat-input').fill('针对高一（3）班函数单调性薄弱点出分层练习')
  await page.getByTestId('chat-send').click()

  // 等待 Agent 执行完成：streaming 结束后「发送」按钮恢复可见
  await expect(page.getByTestId('chat-send')).toBeVisible({ timeout: 20_000 })

  // 切到出题工作台：试题已自动出现（空状态消失）
  await page.getByRole('button', { name: '出题工作台' }).click()
  await expect(page.getByText('试题工作台为空')).toBeHidden({ timeout: 10_000 })
})

test('③ 文档新建 → 导出下载', async ({ page }) => {
  await loginAsTeacher(page)

  // v0.9.2 P0-B：右栏默认直达主工作台，先切回「文档」tab 再新建（tab 按钮带 testid，避免「文档」重名）
  await page.getByTestId('tab-doc').click()

  // 新建空白文档（右栏文档面板空状态）
  await page.getByTestId('new-doc-btn').click()
  await expect(page.getByTestId('new-doc-btn')).toBeHidden()

  // 导出 Markdown → 触发下载
  await page.getByLabel('导出文档').click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByText('Markdown', { exact: true }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/\.md$/)
})

test('④ 生成即见：教案任务后文档面板自动可见且正文持续增长', async ({ page }) => {
  await loginAsTeacher(page)

  // 教师默认停在角色主工作台（v0.9.2 P0-B）
  await expect(page.getByTestId('tab-board')).toHaveClass(/border-primary/)

  // 发送教案目标（Mock 剧本：genLessonPlan → 教案文档流式生成）
  await page.getByTestId('chat-input').fill('帮我备一节《摩擦力》公开课')
  await page.getByTestId('chat-send').click()

  // 占位即切（v0.9.3 P0-A①②）：无需手点 tab，右栏自动切「文档」并显示生成中提示
  await expect(page.getByTestId('doc-generating-bar')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('tab-doc')).toHaveClass(/border-primary/)
  await expect(page.getByTestId('doc-focus-notice')).toBeVisible()

  // 正文逐字增长（流式渲染，而非生成完一次性出现）
  const body = page.getByTestId('doc-body')
  await expect(body).toBeVisible()
  const first = (await body.innerText()).length
  await expect.poll(async () => (await body.innerText()).length, { timeout: 15_000 }).toBeGreaterThan(first)

  // 生成收敛：生成中提示与中栏轻提示自动收起（v0.9.3 P0-A③）
  await expect(page.getByTestId('doc-generating-bar')).toBeHidden({ timeout: 20_000 })
  await expect(page.getByTestId('doc-focus-notice')).toBeHidden()
})

test('⑤ 演示直达：登录页一键进入简报（默认教师 · 跳过引导）', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('demo-login')).toBeVisible()

  // 一键直达（v0.9.3 P1-B②）：不填账号密码，1 次点击落到简报
  await page.getByTestId('demo-login').click()
  await expect(page.getByTestId('adopt-btn')).toBeVisible({ timeout: 5_000 })

  // 跳过首次引导：欢迎弹窗不出现（卡牌切入动画可直接播放）
  await expect(page.getByTestId('guide-done')).toHaveCount(0)
})

test('⑥ URL 演示直达：?demo=1 冷启动直接落在简报', async ({ page }) => {
  await page.goto('/?demo=1')
  await expect(page.getByTestId('adopt-btn')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('guide-done')).toHaveCount(0)
})

test('⑦ 重新生成弹窗内方向键不误触简报决策', async ({ page }) => {
  await page.goto('/?demo=1')
  await expect(page.getByTestId('adopt-btn')).toBeVisible({ timeout: 5_000 })

  const counter = page.getByText(/已处理 \d+\/\d+/).first()
  const before = await counter.textContent()

  await page.getByTestId('regen-btn').click()
  await expect(page.getByTestId('regen-dialog')).toBeVisible()

  // 输入态守卫（v0.9.3 P0-B①）：提示词输入框内连按 ←/↑/→，不触发跳过 / 收藏 / 采纳
  const prompt = page.locator('#regen-prompt')
  await prompt.click()
  for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight']) {
    for (let i = 0; i < 20; i++) await prompt.press(key)
  }

  // 弹窗态守卫（v0.9.3 P0-B②）：焦点移出输入框后继续按方向键，全局决策键同样不响应
  await page.getByTestId('regen-dialog').getByRole('heading', { name: '重新生成简报' }).click()
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight')
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowUp')

  // 关闭弹窗：决策计数与卡片状态零变化
  await page.getByTestId('regen-dialog').getByLabel('关闭').click()
  await expect(page.getByTestId('regen-dialog')).toBeHidden()
  await expect(counter).toHaveText(before ?? '')
  await expect(page.getByTestId('adopt-btn')).toBeVisible()
})
