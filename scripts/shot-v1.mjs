/**
 * v1 原型截图脚本（本地视觉验收用，不进产品包）
 * 用法：先起 `npm run dev`（127.0.0.1:5173），再 `node scripts/shot-v1.mjs`
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.V1_BASE || 'http://127.0.0.1:5173'
const OUT = '.tmp-v1'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await desktop.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console.error]', m.text())
})
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

const shot = async (name) => {
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log('shot', name)
}

// 1) 战情台
await page.goto(`${BASE}/?v1=1&tour=0`, { waitUntil: 'networkidle' })
await page.waitForSelector('[data-testid="director-inbox"]', { timeout: 15000 })
await page.waitForTimeout(900)
await shot('01-inbox')

// 2) 决策卡预览
await page.locator('[data-testid="director-decision-d-drill"]').click()
await page.waitForTimeout(500)
await shot('02-decision-sheet')
await page.keyboard.press('Escape')

// 3) 一句话委托 -> 作战计划
await page.locator('input[aria-label="一句话委托"]').fill('下周三家长会，材料帮我备齐')
await page.locator('button[aria-label="交给战队"]').click()
await page.waitForSelector('[data-testid="mission-plan"]', { timeout: 8000 })
await shot('03-mission-plan')

// 4) 开战 -> 运行中
await page.getByRole('button', { name: '开战' }).click()
await page.waitForSelector('[data-testid="mission-live"]', { timeout: 8000 })
await page.waitForTimeout(1200)
await shot('04-mission-running')

// 5) 审批门
await page.waitForSelector('[data-testid="mission-gate"]', { timeout: 12000 })
await shot('05-mission-gate')
await page.getByRole('button', { name: '放行' }).click()
await page.waitForTimeout(1200)

// 6) 第二道门 -> 发送
await page.waitForSelector('[data-testid="mission-gate"]', { timeout: 12000 })
await page.getByRole('button', { name: '发送' }).click()

// 7) 作战包
await page.waitForSelector('[data-testid="mission-done"]', { timeout: 12000 })
await page.waitForTimeout(900)
await shot('06-mission-done')

// 8) 交付物预览
await page.locator('[data-testid="mission-artifact-a-letters"]').click()
await page.waitForTimeout(500)
await shot('07-artifact-sheet')
await page.keyboard.press('Escape')

// 9) 战队页
await page.locator('[data-testid="director-dock-team"]').click()
await page.waitForSelector('[data-guide="roster"]', { timeout: 8000 })
await page.waitForTimeout(900)
await shot('08-team')

// 10) 成员详情 / 授权
await page.locator('[data-testid="team-agent-communicator"]').click()
await page.waitForTimeout(500)
await shot('09-team-detail')
await page.keyboard.press('Escape')

// 11) 引导条（强制）
await page.goto(`${BASE}/?v1=1&tour=1`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1900)
await shot('10-guide')

// 12) 移动端
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const mpage = await mobile.newPage()
await mpage.goto(`${BASE}/?v1=1&tour=0`, { waitUntil: 'networkidle' })
await mpage.waitForSelector('[data-testid="director-inbox"]', { timeout: 15000 })
await mpage.waitForTimeout(900)
await mpage.screenshot({ path: `${OUT}/11-mobile-inbox.png` })
await mpage.locator('[data-testid="director-dock-team"]').click()
await mpage.waitForTimeout(800)
await mpage.screenshot({ path: `${OUT}/12-mobile-team.png` })
console.log('shot 11-12 mobile')

await browser.close()
console.log('done')
