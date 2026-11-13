import { expect, test, type Page } from '@playwright/test'

/**
 * v1.2 M4 · 默认切换后的入口 / 迁移 / 回滚 E2E（roadmap §5.1 三阶段、§5.3 数据迁移、附录 C2）
 *
 * 覆盖：
 *  a. 冷启动默认：教师登录 → 统一壳战情台（URL 规范化 ?v2=1、无 view、不落旧简报）；
 *  b. `?v1=1` → 重定向统一壳战情台（URL 移除 v1、补 v2=1）；
 *  c. `?v1=1&legacy=1` → 旧整屏只读保留（无统一壳）；
 *  d. `?legacy=1` → 旧壳（登录后简报），无统一壳；
 *  e. director 持久化 v1→v2 迁移：waiting 归一 paused、runtime.cursor / migrations / artifactIds 保留；
 *  f. 启动页回滚：settings.studio.landing=briefing 无参数回旧壳简报；`?v2=1` 显式仍进新壳；
 *  g. 连续引导：老用户升级提示条 / 下一站 CTA / `?tour=1` 可重看。
 *
 * 纪律：旧 51 条语义零改动由既有套件保障；本文件只测 M4 新默认行为。
 */

/** 本地持久化键（与 src/lib/storage.ts 的 `edustudio:` 前缀一致） */
const AUTH_KEY = 'auth'
const SETTINGS_KEY = 'settings'
const DIRECTOR_KEY = 'director'

type Seeds = Record<string, unknown>

/** 教师已登录（旧阶段机落点 briefing，M4 默认期会被入口计划改写成战情台） */
const AUTH_TEACHER = { role: 'teacher', stage: 'briefing' }

/**
 * 先落地一个空应用页，再用 `page.evaluate` 写入种子（不用 addInitScript：
 * 迁移/引导用例需要「关闭后刷新仍生效」的持久化语义，init script 会在每次导航重置存储）。
 */
async function seedStorage(page: Page, seeds: Seeds = {}): Promise<void> {
  await page.goto('/')
  await page.evaluate(
    ({ keys, payload }: { keys: string[]; payload: Seeds }) => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('edustudio:')) localStorage.removeItem(key)
      }
      for (const [key, value] of Object.entries(payload)) {
        localStorage.setItem(`edustudio:${key}`, JSON.stringify(value))
      }
      void keys
    },
    { keys: [AUTH_KEY, SETTINGS_KEY, DIRECTOR_KEY], payload: seeds },
  )
}

/** 关闭旧操作引导（未弹出时静默跳过） */
async function dismissGuide(page: Page): Promise<void> {
  await page.getByTestId('guide-done').click({ timeout: 4000 }).catch(() => {})
}

function searchOf(page: Page): URLSearchParams {
  return new URL(page.url()).searchParams
}

/* ------------------------------------------------------------------ */
/* v1 director 持久化 payload（用于迁移用例）                            */
/* ------------------------------------------------------------------ */

const SEED_STARTED_AT = 1_700_000_000_000
const SEED_ARTIFACT_ID = `doc-m-${SEED_STARTED_AT}-a-brief`

const V1_DIRECTOR_PAYLOAD = {
  schemaVersion: 1,
  updatedAt: SEED_STARTED_AT,
  decisions: [],
  stats: { pending: 3, running: 1, hosted: 4, savedHours: 2.1 },
  mission: {
    status: 'waiting',
    kind: 'exam_loop',
    title: '单元考闭环',
    progress: 46,
    feed: [{ id: 'f-1', agentId: 'chief', text: '分层练习待你过目', at: SEED_STARTED_AT, kind: 'gate' }],
    plan: [
      { id: 't1', agentId: 'analyst', title: '核对单元考数据', seconds: 40 },
      { id: 't2', agentId: 'assessor', title: '分层练习单', seconds: 90, gate: 'worksheet' },
      { id: 't3', agentId: 'curriculum', title: '习题课教案', seconds: 90, gate: 'lesson' },
      { id: 't4', agentId: 'chief', title: '作战包', seconds: 30 },
    ],
    doneTasks: ['t1'],
    gate: 'worksheet',
    planSource: 'template',
    startedAt: SEED_STARTED_AT,
  },
  missionKind: 'exam_loop',
  missionCursor: 4,
  planSource: 'template',
  autonomy: {
    chief: 'L2',
    analyst: 'L2',
    assessor: 'L2',
    curriculum: 'L2',
    communicator: 'L1',
    steward: 'L3',
  },
  guideSeen: false,
  facts: [],
  execution: { mode: 'mock', startedAt: SEED_STARTED_AT, completedTasks: ['t1'] },
  artifactIds: [SEED_ARTIFACT_ID],
  intake: { source: 'inbox' },
}

/* ------------------------------------------------------------------ */
/* a. 冷启动默认：登录 → 统一壳战情台                                    */
/* ------------------------------------------------------------------ */

test('a. 冷启动默认：教师登录后直接落统一壳战情台，URL 规范化 ?v2=1 且不带 view', async ({ page }) => {
  await seedStorage(page)
  await page.goto('/?tour=0')
  await expect(page.getByTestId('login-account')).toBeVisible()

  await page.getByTestId('login-account').fill('teacher@edustudio.cn')
  await page.getByTestId('login-password').fill('demo1234')
  await page.getByTestId('role-card-teacher').click()
  await page.getByTestId('login-submit').click()

  await expect(page.getByTestId('studio-shell')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('director-inbox')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('command-center')).toBeVisible()

  /* URL 规范化：v2=1、无 view（= 战情台默认）、无 v1；不再落旧简报 */
  await expect.poll(() => searchOf(page).get('v2')).toBe('1')
  expect(searchOf(page).get('view')).toBeNull()
  expect(searchOf(page).get('v1')).toBeNull()
  await expect(page.getByTestId('adopt-btn')).toHaveCount(0)
})

/* ------------------------------------------------------------------ */
/* b. ?v1=1 → 重定向统一壳战情台                                        */
/* ------------------------------------------------------------------ */

test('b. ?v1=1 重定向：URL 移除 v1 并补 v2=1，落统一壳战情台', async ({ page }) => {
  await seedStorage(page, { auth: AUTH_TEACHER })
  await page.goto('/?v1=1&tour=0')

  await expect(page.getByTestId('studio-shell')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('director-inbox')).toBeVisible()

  await expect.poll(() => searchOf(page).get('v1')).toBeNull()
  expect(searchOf(page).get('v2')).toBe('1')
  expect(searchOf(page).get('view')).toBeNull()
  /* 旧整屏的 dock 不应出现 */
  await expect(page.getByTestId('director-dock-inbox')).toHaveCount(0)
})

/* ------------------------------------------------------------------ */
/* c. ?v1=1&legacy=1 → 旧整屏只读保留                                   */
/* ------------------------------------------------------------------ */

test('c. ?v1=1&legacy=1 旧整屏只读保留：director dock 可见、统一壳不出现', async ({ page }) => {
  await seedStorage(page, { auth: AUTH_TEACHER })
  await page.goto('/?v1=1&legacy=1&tour=0')

  await expect(page.getByTestId('director-dock-inbox')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('director-inbox')).toBeVisible()
  await expect(page.getByTestId('studio-shell')).toHaveCount(0)
})

/* ------------------------------------------------------------------ */
/* d. ?legacy=1 → 旧壳（登录后简报）                                     */
/* ------------------------------------------------------------------ */

test('d. ?legacy=1 回滚旧壳：无统一壳，教师落旧简报', async ({ page }) => {
  await seedStorage(page, { auth: AUTH_TEACHER })
  await page.goto('/?legacy=1&tour=0')

  await expect(page.getByTestId('studio-shell')).toHaveCount(0)
  /* 旧壳落点 = 简报（首次引导先关掉） */
  await dismissGuide(page)
  await expect(page.getByTestId('adopt-btn')).toBeVisible({ timeout: 15_000 })
})

/* ------------------------------------------------------------------ */
/* e. director v1 → v2 迁移                                            */
/* ------------------------------------------------------------------ */

test('e. director 持久化 v1→v2 迁移：waiting 归一 paused，runtime.cursor/migrations/artifactIds 保留', async ({ page }) => {
  await seedStorage(page, { auth: AUTH_TEACHER, [DIRECTOR_KEY]: V1_DIRECTOR_PAYLOAD })
  await page.goto('/?tour=0')

  await expect(page.getByTestId('studio-shell')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('studio-nav-mission').click()

  /* 旧数据 waiting 在 M4 执行控制器安装时归一为 paused（刷新恢复矩阵） */
  await expect(page.getByTestId('mission-paused')).toBeVisible({ timeout: 20_000 })

  /* 迁移已写回 v2：schemaVersion=2 / runtime.cursor / migrations / artifactIds 保留 */
  await expect
    .poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(`edustudio:${key}`) ?? 'null')?.schemaVersion, DIRECTOR_KEY))
    .toBe(2)
  /* paused 由执行控制器安装时归一，经 300ms 合并写盘落回持久化 → 等它写回再看字段 */
  await expect
    .poll(() =>
      page.evaluate(
        (key) => (JSON.parse(localStorage.getItem(`edustudio:${key}`) ?? 'null') as { mission?: { status?: string } } | null)?.mission?.status,
        DIRECTOR_KEY,
      ),
    )
    .toBe('paused')

  const migrated = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(`edustudio:${key}`) ?? 'null') as Record<string, unknown> | null,
    DIRECTOR_KEY,
  )
  expect(migrated).toBeTruthy()
  const mission = migrated?.mission as { runtime?: { cursor?: number }; status?: string }
  expect(mission.runtime?.cursor).toBe(4)
  expect(mission.status).toBe('paused')
  expect((migrated?.migrations as { from: number }[] | undefined)?.[0]?.from).toBe(1)
  expect(migrated?.artifactIds).toEqual([SEED_ARTIFACT_ID])
})

/* ------------------------------------------------------------------ */
/* f. 启动页回滚：settings.studio.landing=briefing                      */
/* ------------------------------------------------------------------ */

test('f. 启动页回滚：landing=briefing 无参数回旧壳简报；?v2=1 显式仍进新壳', async ({ page }) => {
  await seedStorage(page, {
    auth: AUTH_TEACHER,
    [SETTINGS_KEY]: { studio: { landing: 'briefing' } },
  })

  /* 无参数：按启动页设置回旧壳（简报），不出现统一壳 */
  await page.goto('/?tour=0')
  await expect(page.getByTestId('studio-shell')).toHaveCount(0)
  await dismissGuide(page)
  await expect(page.getByTestId('adopt-btn')).toBeVisible({ timeout: 15_000 })

  /* ?v2=1 显式入口：启动页设置不拦显式新壳 */
  await page.goto('/?v2=1&tour=0')
  await expect(page.getByTestId('studio-shell')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('director-inbox')).toBeVisible()
})

/* ------------------------------------------------------------------ */
/* g. 连续引导：升级提示 / 下一站 CTA / ?tour=1 重看                     */
/* ------------------------------------------------------------------ */

test('g1. 老用户升级提示：可见 → 关闭写 noticeSeen → 刷新不再出现', async ({ page }) => {
  /* M4 之前就有数据（旧 guideSeen=true）且没有 onboarding 对象 → 判定为老用户 */
  await seedStorage(page, { auth: AUTH_TEACHER, [SETTINGS_KEY]: { guideSeen: true } })
  await page.goto('/?v2=1&tour=0')

  await expect(page.getByTestId('studio-shell')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('studio-onboarding-notice')).toBeVisible()

  await page.getByTestId('studio-onboarding-notice-close').click()
  await expect(page.getByTestId('studio-onboarding-notice')).toHaveCount(0)

  /* 关闭只写 noticeSeen（不推进两段引导进度） */
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const settings = JSON.parse(localStorage.getItem(`edustudio:${key}`) ?? 'null') as
          | { studio?: { onboarding?: { noticeSeen?: boolean; directorSeen?: boolean; classicSeen?: boolean } } }
          | null
        return settings?.studio?.onboarding?.noticeSeen
      }, SETTINGS_KEY),
    )
    .toBe(true)

  /* 刷新（存储已是 M4 结构）：升级提示不再打扰 */
  await page.reload()
  await expect(page.getByTestId('studio-shell')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('studio-onboarding-notice')).toHaveCount(0)
})

test('g2. 下一站 CTA：只看过总指挥段时出现「下一站：经典工作区」，跳过写 classicSeen', async ({ page }) => {
  await seedStorage(page, {
    auth: AUTH_TEACHER,
    [SETTINGS_KEY]: {
      studio: { onboarding: { directorSeen: true, classicSeen: false, noticeSeen: true } },
    },
  })
  await page.goto('/?v2=1&tour=0')

  await expect(page.getByTestId('studio-shell')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('studio-onboarding-cta')).toBeVisible()
  await expect(page.getByTestId('studio-onboarding-cta-go')).toContainText('下一站：经典工作区')

  await page.getByTestId('studio-onboarding-cta-skip').click()
  await expect(page.getByTestId('studio-onboarding-cta')).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const settings = JSON.parse(localStorage.getItem(`edustudio:${key}`) ?? 'null') as
          | { studio?: { onboarding?: { classicSeen?: boolean }; onboarded?: boolean } }
          | null
        return settings?.studio?.onboarding?.classicSeen
      }, SETTINGS_KEY),
    )
    .toBe(true)
})

test('g3. ?tour=1 可重看引导：强制弹出总指挥引导，可跳过', async ({ page }) => {
  await seedStorage(page, {
    auth: AUTH_TEACHER,
    [SETTINGS_KEY]: {
      studio: {
        onboarding: { directorSeen: true, classicSeen: true, noticeSeen: true },
        onboarded: true,
      },
    },
  })
  await page.goto('/?v2=1&tour=1')

  await expect(page.getByTestId('studio-shell')).toBeVisible({ timeout: 15_000 })
  /* CommandCenter 的 ?tour=1 强制引导（TOUR_DELAY_MS 后启动）；首步目标在派生收件箱可能立即跳步，
     因此断言引导条本身（testid）而不是某一步文案 */
  await expect(page.getByTestId('director-guide')).toBeVisible({ timeout: 10_000 })
  await page.getByLabel('跳过引导').click()
  await expect(page.getByTestId('director-guide')).toHaveCount(0)
})
