import { defineConfig, devices } from '@playwright/test'

/**
 * E2E 配置（v0.4 M3① → v0.5 M4① 视觉回归）。
 * - Mock 模式离线可跑，不依赖外部 API；
 * - retries: 1（CI 环境偶发不稳定的兜底，见 v0.4 roadmap 风险对策）；
 * - 关键断言一律 data-testid，不依赖文案；
 * - 视觉回归：toHaveScreenshot 全局阈值 5%（首月观察期，CI 上该 job 允许失败）。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.05,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
