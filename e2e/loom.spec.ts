import { expect, test, type Page } from '@playwright/test'

/**
 * v0.9.4 Loom 空间任务台 E2E（Mock 模式，离线可跑）。
 *
 * ① 中栏视图切换：进入空间任务台 → 空状态引导可见 → 返回对话
 * ② 添加模块：菜单建节点 → 画布出现节点卡片 → 选中后编辑器可保存名称
 * ③ 简报采纳 → 空间任务台出现任务节点（一卡一节点）
 * ④ 拖动节点 → 刷新 → 坐标保持（结构持久化）
 * ⑤ 工具条：归中 / 缩放入口可用
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    /* 每条用例默认从干净存储开始（context 本身隔离，此处为防御性清理）；
     * ④ 持久化用例在 reload 前置 e2e-keep-storage 标记（sessionStorage 跨 reload 存活）以保留现场 */
    if (sessionStorage.getItem('e2e-keep-storage') === '1') return
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('edustudio:')) localStorage.removeItem(key)
    }
  })
})

/** 关闭首次进入的操作引导（未弹出时静默跳过） */
async function dismissGuide(page: Page) {
  await page.getByTestId('guide-done').click({ timeout: 4000 }).catch(() => {})
}

/** 教师身份经「跳过简报」进入中性工作台 */
async function loginAsTeacher(page: Page) {
  await page.goto('/')
  await page.getByTestId('login-account').fill('teacher@edustudio.cn')
  await page.getByTestId('login-password').fill('demo1234')
  await page.getByTestId('role-card-teacher').click()
  await page.getByTestId('login-submit').click()
  await dismissGuide(page)
  await page.getByRole('button', { name: '跳过简报，直接进入工作台' }).click()
  await expect(page.getByTestId('chat-input')).toBeVisible()
}

/** 打开空间任务台（中栏第二视图） */
async function openLoom(page: Page) {
  await page.getByTestId('center-view-loom').click()
  await expect(page.getByTestId('loom-panel')).toBeVisible()
  await expect(page.getByTestId('loom-canvas')).toBeVisible()
}

test('① 空间任务台入口与空状态引导', async ({ page }) => {
  await loginAsTeacher(page)
  await openLoom(page)

  /* 空状态：把今天的任务摊开来处理（面板副标题与画布空状态同文案，取其一） */
  await expect(page.getByText('把今天的任务摊开来处理').first()).toBeVisible()
  await expect(page.getByTestId('loom-add')).toBeVisible()

  /* 返回对话：面板收起、对话区恢复 */
  await page.getByTestId('center-view-chat').click()
  await expect(page.getByTestId('loom-panel')).toHaveCount(0)
  await expect(page.getByTestId('chat-input')).toBeVisible()
})

test('② 添加模块 → 节点出现 → 编辑器可改名', async ({ page }) => {
  await loginAsTeacher(page)
  await openLoom(page)

  await page.getByTestId('loom-add').click()
  await page.getByTestId('loom-add-agent').click()

  /* 画布出现节点卡与编辑器浮层（用 data-node-id 精确定位卡片，避免匹配到卡片内按钮） */
  await expect(page.locator('[data-node-id]').first()).toBeVisible()
  await expect(page.getByTestId('loom-node-editor')).toBeVisible()

  /* 改名保存后卡片标题更新 */
  const titleInput = page.getByTestId('loom-node-editor').locator('input').first()
  await titleInput.fill('生成分层练习')
  await page.getByTestId('loom-node-save').click()
  await expect(page.locator('[data-node-id]').first()).toContainText('生成分层练习')
})

test('③ 简报采纳 → 空间任务台出现任务节点（一卡一节点）', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('login-account').fill('teacher@edustudio.cn')
  await page.getByTestId('login-password').fill('demo1234')
  await page.getByTestId('role-card-teacher').click()
  await page.getByTestId('login-submit').click()
  await dismissGuide(page)

  /* 采纳多张卡（专注模式后台执行，不跳工作台）——卡组中带任务动作的卡会进入空间任务台 */
  await expect(page.getByTestId('adopt-btn')).toBeVisible()
  for (let i = 0; i < 6; i += 1) {
    const adopt = page.getByTestId('adopt-btn')
    if ((await adopt.count()) === 0) break
    await adopt.click()
    await page.waitForTimeout(450)
  }

  /* 简报页顶部入口直接进工作台（后台任务继续执行，任务节点此时已在画布） */
  await page.getByRole('button', { name: /跳过简报/ }).click()
  await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 8000 })
  await openLoom(page)

  /* 至少 1 个任务节点（一卡一节点）：类型标签为「任务」 */
  const nodes = page.locator('[data-node-id]')
  await expect.poll(async () => nodes.count(), { timeout: 8000 }).toBeGreaterThan(0)
  await expect(nodes.first()).toContainText('任务')
})

test('④ 拖动节点 → 刷新 → 坐标保持', async ({ page }) => {
  await loginAsTeacher(page)
  await openLoom(page)
  await page.getByTestId('loom-add').click()
  await page.getByTestId('loom-add-note').click()

  const card = page.locator('[data-node-id]').first()
  await expect(card).toBeVisible()
  const before = (await card.boundingBox()) as { x: number; y: number }
  await page.mouse.move(before.x + 60, before.y + 30)
  await page.mouse.down()
  await page.mouse.move(before.x + 220, before.y + 120, { steps: 8 })
  await page.mouse.up()
  const after = (await card.boundingBox()) as { x: number; y: number }
  expect(Math.abs(after.x - before.x)).toBeGreaterThan(60)

  /* 刷新后（localStorage 持久化）坐标不回到初始位置 */
  await page.evaluate(() => sessionStorage.setItem('e2e-keep-storage', '1'))
  await page.reload()
  await openLoom(page)
  const reloaded = (await page.locator('[data-node-id]').first().boundingBox()) as { x: number }
  expect(Math.abs(reloaded.x - after.x)).toBeLessThan(16)
})

test('⑤ 工具条：缩放显示与归中入口可用', async ({ page }) => {
  await loginAsTeacher(page)
  await openLoom(page)

  await expect(page.getByTestId('loom-zoom-label')).toHaveText('100%')
  await page.getByTestId('loom-fit').click()
  await expect(page.getByTestId('loom-zoom-label')).toBeVisible()
  await expect(page.getByTestId('loom-immersive')).toBeVisible()
})

/** 预置 20 节点 / 30 边画布（性能 smoke 用；直接写 edustudio:loom，避免逐项 UI 创建） */
const BIG_BOARD = {
  schemaVersion: 1,
  boards: [
    {
      id: 'board-teacher',
      role: 'teacher',
      title: '今日教学任务',
      removedCardIds: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      updatedAt: 0,
      nodes: Array.from({ length: 20 }, (_, i) => ({
        id: `lnode-${i}`,
        type: i < 8 ? 'task' : i % 5 === 0 ? 'checkpoint' : 'agent',
        title: `节点 ${i + 1}`,
        position: { x: (i % 5) * 280, y: Math.floor(i / 5) * 160 },
        status: 'idle',
        createdAt: 0,
        updatedAt: 0,
      })),
      edges: Array.from({ length: 30 }, (_, i) => ({
        /* 同层右连 + 相邻层下连，保证无环 */
        id: `e-${i}`,
        from: `lnode-${i % 20}`,
        to: `lnode-${((i % 20) + (i % 2 === 0 ? 1 : 5)) % 20}`,
        type: 'dependency',
        createdAt: 0,
      })).filter((e) => e.from !== e.to),
    },
  ],
}

/** 预置依赖链：A（AI 模块）→ B（AI 模块），验证「按依赖真实执行」闭环 */
const CHAIN_BOARD = {
  schemaVersion: 1,
  boards: [
    {
      id: 'board-teacher',
      role: 'teacher',
      title: '今日教学任务',
      removedCardIds: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      updatedAt: 0,
      nodes: [
        {
          id: 'lnode-a',
          type: 'agent',
          title: '分析学情',
          instruction: '分析高一（3）班函数单调性薄弱点',
          position: { x: 40, y: 60 },
          status: 'idle',
          createdAt: 0,
          updatedAt: 0,
        },
        {
          id: 'lnode-b',
          type: 'agent',
          title: '生成分层练习',
          instruction: '根据上游分析结果生成三档练习',
          position: { x: 360, y: 60 },
          status: 'idle',
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      edges: [{ id: 'e-ab', from: 'lnode-a', to: 'lnode-b', type: 'dependency', createdAt: 0 }],
    },
  ],
}

test('⑧ 体验打磨：高度可拖拽 / 标题口径 / 通知分级', async ({ page }) => {
  await page.addInitScript((board) => {
    localStorage.setItem('edustudio:loom', JSON.stringify(board))
  }, CHAIN_BOARD)
  await loginAsTeacher(page)
  await openLoom(page)

  /* 标题口径：统一为「xx画布」 */
  await expect(page.getByTestId('loom-panel')).toContainText('教学画布')

  /* 向上拖拽条 → 画布增高 */
  const panel = page.getByTestId('loom-panel')
  const before = (await panel.boundingBox()) as { height: number }
  const handle = (await page.getByTestId('loom-resize').boundingBox()) as { x: number; y: number; width: number }
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 3)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2, handle.y - 160, { steps: 6 })
  await page.mouse.up()
  const grown = (await panel.boundingBox()) as { height: number }
  expect(grown.height).toBeGreaterThan(before.height + 100)

  /* 极限上拖 → 不超过中栏 80%；极限下拖 → 不低于 180px */
  await page.mouse.move(handle.x + handle.width / 2, handle.y - 160 + 3)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2, 0, { steps: 4 })
  await page.mouse.up()
  const viewport = page.viewportSize() as { height: number }
  const capped = (await panel.boundingBox()) as { height: number }
  expect(capped.height).toBeLessThanOrEqual(Math.ceil(viewport.height * 0.8))

  await page.mouse.move(handle.x + handle.width / 2, 3)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2, viewport.height, { steps: 4 })
  await page.mouse.up()
  const shrunk = (await panel.boundingBox()) as { height: number }
  expect(shrunk.height).toBeGreaterThanOrEqual(179)

  /* 通知分级：删除模块 → info 通知出现 */
  await page.locator('[data-node-id="lnode-a"]').click()
  await page.getByTestId('loom-node-delete').click()
  await expect(page.locator('[data-testid="loom-toast"][data-kind="info"]')).toContainText('模块已删除')
})

test('⑦ 开始处理：依赖链按拓扑真实执行到完成', async ({ page }) => {
  test.setTimeout(90_000)
  await page.addInitScript((board) => {
    sessionStorage.setItem('e2e-keep-storage', '1')
    localStorage.setItem('edustudio:loom', JSON.stringify(board))
  }, CHAIN_BOARD)

  await loginAsTeacher(page)
  await openLoom(page)
  await expect(page.locator('[data-node-id]')).toHaveCount(2)
  await expect(page.getByTestId('loom-run')).toBeVisible()

  await page.getByTestId('loom-run').click()

  /* 执行开始（按钮进入处理中）→ 至少 A 完成（mint「已完成」），随后 B 解锁执行 */
  await expect(page.getByTestId('loom-run')).toContainText(/处理中|开始处理|继续处理/, { timeout: 10_000 })
  await expect
    .poll(
      async () =>
        page.locator('[data-node-id]').filter({ hasText: '已完成' }).count(),
      { timeout: 80_000, intervals: [800] },
    )
    .toBeGreaterThan(0)

  /* 上游完成后下游节点被解锁并执行：等待第二个节点也完成 */
  await expect
    .poll(
      async () =>
        page.locator('[data-node-id]').filter({ hasText: '已完成' }).count(),
      { timeout: 80_000, intervals: [800] },
    )
    .toBe(2)
})

test('⑥ 性能 smoke：20 节点 / 30 边下拖动不卡死且坐标更新', async ({ page }) => {
  await page.addInitScript((board) => {
    localStorage.setItem('edustudio:loom', JSON.stringify(board))
  }, BIG_BOARD)

  await loginAsTeacher(page)
  await openLoom(page)
  await expect(page.locator('[data-node-id]')).toHaveCount(20)

  /* 连续拖动同一节点，测量每次移动的响应（长任务会在 DevTools 复核，这里只保功能与流畅下限） */
  const card = page.locator('[data-node-id="lnode-0"]')
  const box = (await card.boundingBox()) as { x: number; y: number }
  await page.mouse.move(box.x + 60, box.y + 30)
  await page.mouse.down()
  const start = Date.now()
  for (let i = 0; i < 20; i++) {
    await page.mouse.move(box.x + 60 + i * 4, box.y + 30 + i * 2)
  }
  await page.mouse.up()
  const elapsed = Date.now() - start

  const moved = (await card.boundingBox()) as { x: number }
  expect(Math.abs(moved.x - box.x)).toBeGreaterThan(30)
  /* 拖动 20 帧的耗时（含 Playwright 往返），明显卡死会远超该阈值 */
  expect(elapsed).toBeLessThan(6000)
})
