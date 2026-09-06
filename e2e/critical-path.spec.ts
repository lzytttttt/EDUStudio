import { expect, test, type Page } from '@playwright/test'

/**
 * v0.4 M3①：3 条关键路径 E2E（Mock 模式，离线可跑）。
 * ① 登录 → 简报 → 采纳（专注模式后台执行）→ 批示完成 → 统一处理 → 工作台（v0.7 改写）
 * ② 对话出题 → 出题工作台联动
 * ③ 文档新建 → 导出下载
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
