import { expect, test, type Page } from '@playwright/test'

/**
 * v0.6 M5②：自进化演示向导关键路径（Mock 模式，离线可跑）。
 * 三幕走完自进化闭环：技能发现（沉淀 v1）→ 技能复用（命中学习技能）→ 技能进化（版本+1）。
 * 幕1 启动前自动清空学习技能，保证演示可重复。
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('edustudio:')) localStorage.removeItem(key)
    }
  })
})

/** 快捷路径：教师身份经「跳过简报」进入中性工作台 */
async function loginAsTeacher(page: Page) {
  await page.goto('/')
  await page.getByTestId('role-card-teacher').click()
  await page.getByTestId('guide-done').click({ timeout: 4000 }).catch(() => {})
  await page.getByRole('button', { name: '跳过简报，直接进入工作台' }).click()
  await expect(page.getByTestId('chat-input')).toBeVisible()
}

test('自进化演示：三幕走完 发现 → 复用 → 进化', async ({ page }) => {
  await loginAsTeacher(page)

  // 打开演示向导
  await page.getByTestId('demo-entry').click()
  await expect(page.getByTestId('demo-wizard')).toBeVisible()
  await expect(page.getByTestId('demo-act-title')).toContainText('技能发现')

  // 幕1：通用探索执行 → 自动沉淀新技能（轨迹出现「已沉淀新技能」徽标）
  await page.getByTestId('demo-run').click()
  await expect(page.getByText('已沉淀新技能').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('demo-wizard')).toContainText('新技能已沉淀', { timeout: 10_000 })

  // 幕2：同类任务 → 命中学习技能（轨迹出现「命中技能」徽标）
  await page.getByTestId('demo-run').click()
  await expect(page.getByTestId('demo-act-title')).toContainText('技能复用')
  await expect(page.getByText('命中技能').first()).toBeVisible({ timeout: 30_000 })

  // 幕3：变化任务 → 合并进化（轨迹出现「技能已进化」徽标）
  await page.getByTestId('demo-run').click()
  await expect(page.getByTestId('demo-act-title')).toContainText('技能进化')
  await expect(page.getByText('技能已进化').first()).toBeVisible({ timeout: 30_000 })

  // 技能库面板：学习技能版本已进化至 v2
  await page.getByRole('button', { name: /^技能/ }).click()
  await expect(page.getByText('v2').first()).toBeVisible({ timeout: 10_000 })
})

test('重置演示：清空学习技能，可重复演示', async ({ page }) => {
  await loginAsTeacher(page)

  await page.getByTestId('demo-entry').click()
  await page.getByTestId('demo-run').click()
  await expect(page.getByText('已沉淀新技能').first()).toBeVisible({ timeout: 30_000 })

  // 重置 → 学习技能清空，回到第一幕
  await page.getByTestId('demo-reset').click()
  await expect(page.getByTestId('demo-act-title')).toContainText('技能发现')

  // 再次演示幕1 仍可沉淀（v1 而非 v2）
  await page.getByTestId('demo-run').click()
  await expect(page.getByText('已沉淀新技能').first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: /^技能/ }).click()
  await expect(page.getByText('v1').first()).toBeVisible({ timeout: 10_000 })
})
