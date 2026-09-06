import { expect, test, type Page } from '@playwright/test'

/**
 * v0.5 M4①：视觉回归基线（Mock 模式，离线可跑）。
 * - 首次生成基线：npx playwright test e2e/visual.spec.ts --update-snapshots
 * - 基线按平台区分（*-chromium-win32.png / *-chromium-linux.png），随仓库提交；
 *   CI（Linux）缺 linux 基线时 visual job 会自动生成并上传 linux-baselines 工件，
 *   下载后放入本目录提交，之后即为真实对比；
 * - CI 上字体渲染差异可能造成误报（首月观察期，job 允许失败）；
 * - 全局阈值 5%（playwright.config.ts expect.toHaveScreenshot）。
 * - v0.7：简报页堆叠卡视差（缩放/透明度内联化）与卡片动效调整影响 briefing 基线，
 *   合并后需执行 --update-snapshots 重新生成 briefing.png（其余页面不受影响）。
 * - v0.9 M8②：clock 固定日期对齐 M6④ 卡组周派生——运行日期跨周后卡组轮换会使快照漂移；
 *   固定在 2024-01-01（deckGroupIndex = 0，即原剧本组），基线与 v0.8 时代保持一致。
 */

/** 视觉回归固定日期：floor(days/7) % 3 = 0 → 第 0 组（原剧本），快照不随运行日期漂移 */
const FIXED_NOW = '2024-01-01T08:00:00'

/** 账号密码登录（v0.6.1 登录页改版）：填表 → 选身份 → 提交 */
async function loginAs(page: Page, role: 'teacher' | 'schoolAdmin' | 'bureau') {
  await page.getByTestId('login-account').fill('demo@edustudio.cn')
  await page.getByTestId('login-password').fill('demo1234')
  await page.getByTestId(`role-card-${role}`).click()
  await page.getByTestId('login-submit').click()
}

const SHOTS: { name: string; setup: (page: Page) => Promise<void> }[] = [
  {
    name: 'login',
    setup: async () => {},
  },
  {
    name: 'briefing',
    setup: async (page) => {
      await loginAs(page, 'teacher')
      await page.getByTestId('guide-done').click({ timeout: 4000 }).catch(() => {})
      await expect(page.getByTestId('adopt-btn')).toBeVisible()
    },
  },
  {
    name: 'workbench',
    setup: async (page) => {
      await loginAs(page, 'teacher')
      await page.getByTestId('guide-done').click({ timeout: 4000 }).catch(() => {})
      await page.getByRole('button', { name: '跳过简报，直接进入工作台' }).click()
      await expect(page.getByTestId('chat-input')).toBeVisible()
    },
  },
  {
    name: 'board-school',
    setup: async (page) => {
      await loginAs(page, 'schoolAdmin')
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
    await page.clock.install({ time: FIXED_NOW }) // v0.9 M8②：固定日期对齐派生卡组
    await page.goto('/')
    await setup(page)
    await page.waitForTimeout(400) // 等待入场动画结束
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: false })
  })
}
