import { test, expect } from '@playwright/test'

/**
 * v1.0 总指挥模式（原型）E2E：
 * - 少字界面靠 data-testid 定位，不依赖文案；
 * - `?v1=1` 直达（教师身份），`?tour=0` 关闭引导，保证可重复；
 * - 旧流程（?demo=1 → 今日简报）保留一条冒烟，防止入口改动回归。
 */

test.describe('Director 总指挥模式（v1.0 预览）', () => {
  test('战情台：3 张决策卡，先看再做，采纳后卡片完成', async ({ page }) => {
    await page.goto('/?v1=1&tour=0')
    await expect(page.getByTestId('director-inbox')).toBeVisible()
    await expect(page.getByTestId('director-decision-d-drill')).toBeVisible()
    await expect(page.getByTestId('director-decision-d-letters')).toBeVisible()
    await expect(page.getByTestId('director-decision-d-conflict')).toBeVisible()

    await page.getByTestId('director-decision-d-drill').click()
    await expect(page.getByText('分层练习已备好').last()).toBeVisible()
    await page.getByLabel('预览', { exact: true }).getByRole('button', { name: '采纳' }).click()
    await expect(page.getByText('已采纳 · 战队开始执行')).toBeVisible()
    await expect(page.getByTestId('director-decision-d-drill')).toContainText('已处理')
  })

  test('一句话委托 → 作战计划 → 异步托管 → 两次拍板 → 作战包', async ({ page }) => {
    await page.goto('/?v1=1&tour=0')
    await expect(page.getByTestId('director-inbox')).toBeVisible()

    await page.locator('input[aria-label="一句话委托"]').fill('下周三家长会，材料帮我备齐')
    await page.getByLabel('交给战队').click()
    await expect(page.getByTestId('mission-plan')).toBeVisible()

    await page.getByRole('button', { name: '开战' }).click()
    await expect(page.getByTestId('mission-live')).toBeVisible()

    // 第一道审批门（发言稿 / PPT）
    await expect(page.getByTestId('mission-gate')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: '放行' }).click()

    // 第二道审批门（3 封信）
    await expect(page.getByTestId('mission-gate')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: '发送' }).click()

    // 作战包
    await expect(page.getByTestId('mission-done')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('作战包已交付 · 你只做了 2 个决定')).toBeVisible()

    // 交付物预览
    await page.getByTestId('mission-artifact-a-letters').click()
    await expect(page.getByText('3 封家长信（草稿）')).toBeVisible()
    await page.keyboard.press('Escape')
  })

  test('引导：可逐步推进并跳过，收尾回到战情台', async ({ page }) => {
    await page.goto('/?v1=1&tour=1')
    await expect(page.getByText('事情已经备好，只等你点一下')).toBeVisible({ timeout: 8000 })
    await page.getByLabel('下一步').click()
    await expect(page.getByText('长链路事务，一句话交给战队')).toBeVisible()
    await page.getByLabel('跳过引导').click()
    await expect(page.getByText('事情已经备好，只等你点一下')).toBeHidden()
    await expect(page.getByTestId('director-inbox')).toBeVisible()
  })

  test('战队页：成员卡与授权调整（家校官升到 L2 仍锁发送）', async ({ page }) => {
    await page.goto('/?v1=1&tour=0')
    await page.getByTestId('director-dock-team').click()
    await expect(page.getByTestId('team-agent-communicator')).toBeVisible()
    await page.getByTestId('team-agent-communicator').click()
    await expect(page.getByTestId('team-detail')).toBeVisible()
    await page.getByTestId('team-autonomy-L2').click()
    await expect(page.getByText('已授信 · 对外发送仍需你拍板')).toBeVisible()
  })

  test('旧入口不回归：?demo=1 仍直达今日简报', async ({ page }) => {
    await page.goto('/?demo=1')
    await expect(page.getByTestId('adopt-btn')).toBeVisible()
  })
})
