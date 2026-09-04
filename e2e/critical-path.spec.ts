import { expect, test, type Page } from '@playwright/test'

/**
 * v0.4 M3①：3 条关键路径 E2E（Mock 模式，离线可跑）。
 * ① 登录 → 简报 → 采纳 → 工作台（采纳自动触发 Agent 执行）
 * ② 对话出题 → 出题工作台联动
 * ③ 文档新建 → 导出下载
 *
 * 注意：简报「采纳」会自动下发任务并执行；需要中性工作台时用「跳过简报」入口。
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
  await page.getByTestId('role-card-teacher').click()
  await dismissGuide(page) // 简报页首次引导
  await page.getByRole('button', { name: '跳过简报，直接进入工作台' }).click()
  await expect(page.getByTestId('chat-input')).toBeVisible()
}

test('① 登录 → 简报 → 采纳 → 工作台', async ({ page }) => {
  await page.goto('/')
  // 登录页：三个角色卡片
  await expect(page.getByTestId('role-card-teacher')).toBeVisible()
  await expect(page.getByTestId('role-card-schoolAdmin')).toBeVisible()
  await expect(page.getByTestId('role-card-bureau')).toBeVisible()

  // 选择教师 → 进入简报（首次弹出操作引导）
  await page.getByTestId('role-card-teacher').click()
  await expect(page.getByTestId('guide-done')).toBeVisible()
  await page.getByTestId('guide-done').click()
  await expect(page.getByTestId('adopt-btn')).toBeVisible()

  // 采纳卡片 → 进入工作台，Agent 自动开始执行（对话输入可见）
  await page.getByTestId('adopt-btn').click()
  await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 10_000 })
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
