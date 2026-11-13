import { expect, test, type Page } from '@playwright/test'

/**
 * v1.2 M1 · 统一工作区 E2E（影子期，仅 `?v2=1` 生效；`?v1=1` / 旧三屏在 M4 前零改动）
 *
 * 覆盖 roadmap §8.1 的第 1/6/7 条在 M1 的可演部分 + §6 M1 验收：
 * - `?v2=1&view=inbox|mission|team` 深链可达、URL 与视图一致；
 * - 工作区切换（总指挥 ⇄ 经典）与浏览器返回逐级；
 * - 移动端同一时刻只有一套底部导航（总指挥 3 tab / 经典 AppShell tabbar）；
 * - 旧入口不回归（`?v1=1&legacy=1` 仍是旧整屏、`?v2=1&legacy=1` 不进统一壳）；
 * - 一句话委托从经典工作区顶栏发起 → 统一壳切作战室并出计划。
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('edustudio:')) localStorage.removeItem(key)
    }
  })
})

/** 关闭首次进入的操作引导（未弹出时静默跳过；经典工作台沿用旧引导弹窗） */
async function dismissGuide(page: Page): Promise<void> {
  await page.getByTestId('guide-done').click({ timeout: 3000 }).catch(() => {})
}

/** `?v2=1` 影子期统一壳入口（自动教师身份 + 关闭引导，保证可重复） */
async function openStudio(page: Page, query = '?v2=1&tour=0'): Promise<void> {
  await page.goto(`/${query}`)
  await expect(page.getByTestId('studio-shell')).toBeVisible()
}

test.describe('统一工作区（M1 影子期）', () => {
  test('冷启动：?v2=1 自动教师身份落战情台，一套壳 + 工作区切换 + 总指挥导航齐全', async ({ page }) => {
    await openStudio(page)
    await expect(page.getByTestId('studio-shell-topbar')).toBeVisible()
    await expect(page.getByTestId('studio-workspace-switcher')).toBeVisible()
    await expect(page.getByTestId('studio-nav-inbox')).toBeVisible()
    await expect(page.getByTestId('command-center')).toBeVisible()
    await expect(page.getByTestId('director-inbox')).toBeVisible()
    await expect(page).toHaveURL(/v2=1/)
  })

  test('深链：view=mission / view=team 直接可达，URL 与视图一致', async ({ page }) => {
    await page.goto('/?v2=1&view=mission&tour=0')
    await expect(page.getByTestId('command-center')).toBeVisible()
    await expect(page.getByTestId('mission-surface')).toBeVisible()
    await expect(page).toHaveURL(/view=mission/)

    await page.goto('/?v2=1&view=team&tour=0')
    await expect(page.getByTestId('team-weekly-review')).toBeVisible()
    await expect(page).toHaveURL(/view=team/)
  })

  test('工作区切换：总指挥 → 经典三栏工作台 → 回总指挥，URL 同步', async ({ page }) => {
    await openStudio(page)
    await page.getByTestId('studio-workspace-classic').click()
    await expect(page.getByTestId('chat-input')).toBeVisible()
    await dismissGuide(page) // 首次进经典工作台会弹旧操作引导
    /* 统一壳模式跨工作区保留（?v2=1 + view=chat）：URL 是刷新/返回的事实源 */
    await expect(page).toHaveURL(/v2=1/)
    await expect(page).toHaveURL(/view=chat/)
    await expect(page.getByTestId('studio-shell')).toBeVisible()

    await page.getByTestId('studio-workspace-director').click()
    await expect(page.getByTestId('director-inbox')).toBeVisible()
    await expect(page).toHaveURL(/v2=1/)
    /* 非路由参数（?tour=0）跨工作区切换保留：不会因跳转丢失而重弹引导 */
    await expect(page).toHaveURL(/tour=0/)
    await expect(page.getByTestId('director-guide')).toHaveCount(0)
  })

  test('刷新保持：经典工作区刷新后仍在统一壳（不退回旧壳），可继续切回总指挥', async ({ page }) => {
    await openStudio(page)
    await page.getByTestId('studio-workspace-classic').click()
    await expect(page.getByTestId('chat-input')).toBeVisible()
    await dismissGuide(page)

    await page.reload()
    await expect(page.getByTestId('studio-shell')).toBeVisible()
    await expect(page.getByTestId('chat-input')).toBeVisible()
    await dismissGuide(page) // beforeEach 的 addInitScript 在 reload 时又清了一次 localStorage → 旧引导重弹
    await expect(page.getByTestId('studio-workspace-classic')).toHaveAttribute('aria-pressed', 'true')

    await page.getByTestId('studio-workspace-director').click()
    await expect(page.getByTestId('director-inbox')).toBeVisible()
  })

  test('返回键逐级：战情台 → 作战室 → 战队 → 浏览器返回逐级回退', async ({ page }) => {
    await openStudio(page)
    await page.getByTestId('studio-nav-mission').click()
    await expect(page.getByTestId('mission-surface')).toBeVisible()

    await page.getByTestId('studio-nav-team').click()
    await expect(page.getByTestId('team-weekly-review')).toBeVisible()

    await page.goBack()
    await expect(page.getByTestId('mission-surface')).toBeVisible()
    await page.goBack()
    await expect(page.getByTestId('director-inbox')).toBeVisible()
  })

  test('一句话委托：经典工作区顶栏提交 → 统一壳切作战室并出计划', async ({ page }) => {
    await openStudio(page)
    await page.getByTestId('studio-workspace-classic').click()
    await expect(page.getByTestId('chat-input')).toBeVisible()
    await dismissGuide(page)

    await page.getByTestId('studio-intent-input').fill('下周三家长会，材料帮我备齐')
    await page.getByTestId('studio-intent-input').press('Enter')

    await expect(page.getByTestId('mission-plan')).toBeVisible({ timeout: 15_000 })
    await expect(page).toHaveURL(/view=mission/)
  })

  test('旧入口不回归：?v1=1&legacy=1 仍是旧整屏；?v2=1&legacy=1 不进统一壳', async ({ page }) => {
    await page.goto('/?v1=1&legacy=1&tour=0')
    await expect(page.getByTestId('director-dock-inbox')).toBeVisible()
    await expect(page.getByTestId('studio-shell')).toHaveCount(0)

    await page.goto('/?v2=1&legacy=1')
    await expect(page.getByTestId('studio-shell')).toHaveCount(0)
    await expect(page.getByTestId('login-account')).toBeVisible()
  })
})

test.describe('统一工作区移动端（390×844）', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('同一时刻只有一套底部导航：总指挥 3 tab / 经典 AppShell tabbar', async ({ page }) => {
    await openStudio(page)
    await expect(page.getByTestId('studio-nav-inbox')).toBeVisible()
    /* 总指挥工作区不渲染旧 AppShell tabbar */
    await expect(page.getByRole('button', { name: '打开任务列表' })).toHaveCount(0)

    await page.getByTestId('studio-workspace-classic').click()
    await expect(page.getByRole('button', { name: '打开任务列表' })).toBeVisible()
    /* 经典工作区不渲染总指挥底部导航 */
    await expect(page.getByTestId('studio-nav-inbox')).toHaveCount(0)
  })
})
