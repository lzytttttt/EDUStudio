import { expect, test, type Page } from '@playwright/test'

/**
 * v0.5 M4①：视觉回归基线（Mock 模式，离线可跑）。
 * - 首次生成基线：npx playwright test e2e/visual.spec.ts --update-snapshots
 * - 基线按平台区分（*-chromium-win32.png / *-chromium-linux.png），随仓库提交；
 *   CI（Linux）缺 linux 基线时 visual job 会自动生成并上传 linux-baselines 工件，
 *   下载后放入本目录提交，之后即为真实对比；
 * - CI 上字体渲染差异可能造成误报（首月观察期，job 允许失败）；
 * - 全局阈值 5%（playwright.config.ts expect.toHaveScreenshot）。
 */

const SHOTS: { name: string; setup: (page: Page) => Promise<void> }[] = [
  {
    name: 'login',
    setup: async () => {},
  },
  {
    name: 'briefing',
    setup: async (page) => {
      await page.getByTestId('role-card-teacher').click()
      await page.getByTestId('guide-done').click({ timeout: 4000 }).catch(() => {})
      await expect(page.getByTestId('adopt-btn')).toBeVisible()
    },
  },
  {
    name: 'workbench',
    setup: async (page) => {
      await page.getByTestId('role-card-teacher').click()
      await page.getByTestId('guide-done').click({ timeout: 4000 }).catch(() => {})
      await page.getByRole('button', { name: '跳过简报，直接进入工作台' }).click()
      await expect(page.getByTestId('chat-input')).toBeVisible()
    },
  },
  {
    name: 'board-school',
    setup: async (page) => {
      await page.getByTestId('role-card-schoolAdmin').click()
      await page.getByTestId('guide-done').click({ timeout: 4000 }).catch(() => {})
      await page.getByRole('button', { name: '跳过简报，直接进入工作台' }).click()
      await expect(page.getByTestId('chat-input')).toBeVisible()
    },
  },
]

for (const { name, setup } of SHOTS) {
  test(`视觉回归 · ${name}`, async ({ page }) => {
    // 每条用例从干净状态开始（清掉持久化的登录态/会话/文档）
    await page.addInitScript(() => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('edustudio:')) localStorage.removeItem(key)
      }
    })
    await page.goto('/')
    await setup(page)
    await page.waitForTimeout(400) // 等待入场动画结束
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: false })
  })
}
