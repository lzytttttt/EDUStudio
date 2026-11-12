import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * v1.1 M4a：总指挥模式三屏视觉基线（独立于旧 e2e/visual.spec.ts，避免与旧 4 张基线互相牵连）。
 *
 * 覆盖（研究 02 §2.5 / roadmap §7.1）：director-inbox / director-mission-plan / director-team。
 * - 页面：`/?v1=1&tour=0&llm=0`（关闭引导；llm=0 强制模板兜底，避开模型请求的时序抖动）；
 * - 固定 clock（问候/日期不随运行日期漂移）+ prefers-reduced-motion + 清空 `edustudio:*`；
 * - mask 动态文本：问候 / 日期 / 省时 / toast 层（优先 data-testid，缺失时按结构兜底）；
 * - 阈值单独收紧到 2%（旧视觉基线仍用全局 5%）；
 * - 基线按平台区分（*-chromium-win32.png / *-chromium-linux.png）；
 *   首次/UI 冻结后生成：`npx playwright test e2e/director-visual.spec.ts --update-snapshots`。
 *
 * 注意：本 spec 依赖 M3/M4 的 UI 集成完成后才生成基线；Phase 1 只落用例，不跑截图。
 */

/** 固定时间：2026-11-10（周二）09:42，问候/日期/周报均与运行日期解耦 */
const FIXED_NOW = '2026-11-10T09:42:00'

/**
 * 显式固定 1440×900：playwright.config 的 project use 会覆盖全局 viewport（Desktop Chrome 默认 1280×720），
 * 这里按 roadmap §7.5 的桌面走查档位锁定，保证基线不随配置层叠变化。
 */
test.use({ viewport: { width: 1440, height: 900 } })

/** director 三屏统一收缩阈值 2%（研究 02 §2.5 / 附录 D11） */
const SHOT = { maxDiffPixelRatio: 0.02, animations: 'disabled' as const }

/** 干净状态进入三屏：清持久化 → 固定时钟 → 减弱动效 → 直达指挥官模式（关引导、强制模板） */
async function openDirector(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('edustudio:')) localStorage.removeItem(key)
    }
  })
  await page.clock.install({ time: FIXED_NOW })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?v1=1&tour=0&llm=0')
}

/**
 * 动态文本 mask。
 * - 问候 / 日期 / 省时：Phase 2 会补 data-testid="director-greeting|date|saved"；
 *   当前阶段用结构兜底（inbox 头部 h1 / header 第一行 p），两种都写进同一条 locator 联合匹配；
 * - toast：容器本身已带 data-testid，即使空也 mask，防止 2.8s 内的提示入镜。
 */
function dynamicMasks(page: Page): Locator[] {
  return [
    page.locator('[data-testid="director-greeting"], [data-testid="director-inbox"] h1'),
    page.locator('[data-testid="director-date"], [data-testid="director-saved"]'),
    page.locator('[data-testid="director-inbox"] header p').first(),
    page.getByTestId('director-toasts'),
  ]
}

test.describe('Director 三屏视觉基线（v1.1 M4a）', () => {
  test('视觉基线 · director-inbox', async ({ page }) => {
    await openDirector(page)
    await expect(page.getByTestId('director-inbox')).toBeVisible()
    await expect(page.getByTestId('director-decision-d-drill')).toBeVisible()
    /* 等入场动效（d-rise 420ms + 错峰）在减弱动效下收尾 */
    await page.waitForTimeout(500)
    await expect(page).toHaveScreenshot('director-inbox.png', { ...SHOT, mask: dynamicMasks(page) })
  })

  test('视觉基线 · director-mission-plan', async ({ page }) => {
    await openDirector(page)
    await expect(page.getByTestId('director-inbox')).toBeVisible()

    /* 一句话委托 → 计划待确认（llm=0：模板兜底，计划内容确定） */
    await page.locator('input[aria-label="一句话委托"]').fill('下周三家长会，材料帮我备齐')
    await page.getByLabel('交给战队').click()
    await expect(page.getByTestId('mission-plan')).toBeVisible({ timeout: 15_000 })

    /* 等 toast（2.8s 自动消失）与切屏淡入结束，再截图，基线更稳 */
    await page.waitForTimeout(3200)
    await expect(page).toHaveScreenshot('director-mission-plan.png', { ...SHOT, mask: dynamicMasks(page) })
  })

  test('视觉基线 · director-team', async ({ page }) => {
    await openDirector(page)
    await expect(page.getByTestId('director-inbox')).toBeVisible()

    await page.getByTestId('director-dock-team').click()
    await expect(page.getByTestId('team-agent-chief')).toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(500)
    await expect(page).toHaveScreenshot('director-team.png', { ...SHOT, mask: dynamicMasks(page) })
  })
})
