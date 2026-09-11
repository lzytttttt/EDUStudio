import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'

/**
 * v0.9.4 画布 × 真实 LLM（模拟）接入评估专用配置。
 * - 与项目 e2e 隔离：testDir 指向本目录，串行执行，便于观察执行节奏；
 * - 同时拉起「模拟 LLM 服务器（8788）」与「Vite dev server（5173）」。
 */
const here = fileURLToPath(new URL('.', import.meta.url))
const root = fileURLToPath(new URL('../../', import.meta.url))

export default defineConfig({
  testDir: here,
  /* 输出指向系统临时目录：避免频繁清理工作区目录时被安全策略拦截 */
  outputDir: path.join(os.tmpdir(), 'edustudio-loom-eval-out'),
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1440, height: 900 },
    trace: 'off',
    actionTimeout: 15_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node scripts/loom-eval/mock-llm-server.mjs',
      cwd: root,
      url: 'http://localhost:8788/__health',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'npm run dev',
      cwd: root,
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
})
