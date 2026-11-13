import { expect, test, type Page } from '@playwright/test'

/**
 * v1.2 M4 · 新壳视觉基线（统一工作区默认期，roadmap §5.6 / §8.2）
 *
 * 覆盖三屏：`studio-inbox.png` / `studio-mission.png` / `studio-team.png`。
 * - 页面：`/?v2=1&view=<inbox|mission|team>&tour=0`（显式新壳；关闭引导避免遮罩）；
 * - 固定 clock 2024-01-01T08:00:00 + 减弱动效 + 清空 `edustudio:*` + seed auth teacher，
 *   保证问候/日期/派生卡组/入场动画不随运行日期漂移；
 * - 1440×900 桌面走查档位（与 director-visual 一致）；
 * - 首次生成基线：npx playwright test e2e/studio-visual.spec.ts --update-snapshots
 * - 基线按平台区分（*-chromium-win32.png / *-chromium-linux.png）。
 */

/** 视觉回归固定日期：问候/日期/派生卡组与运行日期解耦 */
const FIXED_NOW = '2024-01-01T08:00:00'

/** 显式锁定 1440×900（playwright.config 的 project use 会覆盖全局 viewport） */
test.use({ viewport: { width: 1440, height: 900 } })

/** 干净状态进入新壳：清持久化 → 固定时钟 → seed 教师身份 → 减弱动效 */
async function openStudio(page: Page, view: 'inbox' | 'mission' | 'team'): Promise<void> {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('edustudio:')) localStorage.removeItem(key)
    }
    /* 教师已登录：新壳作为默认期入口（M4 起无参数也会进战情台，这里仍用显式 v2 保证可复现） */
    localStorage.setItem('edustudio:auth', JSON.stringify({ role: 'teacher', stage: 'briefing' }))
  })
  await page.clock.install({ time: FIXED_NOW })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`/?v2=1&view=${view}&tour=0`)
  await expect(page.getByTestId('studio-shell')).toBeVisible({ timeout: 15_000 })
}

test.describe('统一壳三屏视觉基线（v1.2 M4 默认期）', () => {
  test('视觉基线 · studio-inbox', async ({ page }) => {
    await openStudio(page, 'inbox')
    await expect(page.getByTestId('director-inbox')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('command-center')).toBeVisible()
    /* 等懒加载 chunk（CommandCenter 三视图）与入场动效收尾 */
    await page.waitForTimeout(700)
    await expect(page).toHaveScreenshot('studio-inbox.png', { animations: 'disabled', caret: 'hide' })
  })

  test('视觉基线 · studio-mission', async ({ page }) => {
    await openStudio(page, 'mission')
    await expect(page.getByTestId('mission-surface')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('mission-plan')).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(700)
    await expect(page).toHaveScreenshot('studio-mission.png', { animations: 'disabled', caret: 'hide' })
  })

  test('视觉基线 · studio-team', async ({ page }) => {
    await openStudio(page, 'team')
    await expect(page.getByTestId('team-weekly-review')).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(700)
    await expect(page).toHaveScreenshot('studio-team.png', { animations: 'disabled', caret: 'hide' })
  })
})
