import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createInitialDirectorState,
  hasSeenDirectorGuide,
  hydrateDirectorState,
  useDirectorStore,
} from '../stores/directorStore'
import { GUIDE_STEPS, MISSION_TEMPLATES } from '../harness/director/data'
import { migrateDirectorPersisted, toPersistedDirector } from '../stores/directorPersistence'
import type { PersistedDirectorV2 } from '../harness/director/types'
import { useSettingsStore } from '../stores/settingsStore'

/** Director 原型状态机单测：决策卡 / 作战斗争链 / 审批门 / 授权 / 引导 */
describe('directorStore（v1.0 总指挥模式原型）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    try {
      window.localStorage.clear()
    } catch {
      /* ignore */
    }
    useDirectorStore.getState().resetDemo()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('初始状态：3 张决策 / 1 个待确认计划 / 3 个在办数字', () => {
    const s = useDirectorStore.getState()
    expect(s.decisions).toHaveLength(3)
    expect(s.stats).toEqual({ pending: 3, running: 1, hosted: 4, savedHours: 2.1 })
    expect(s.mission.status).toBe('planning')
    expect(s.screen).toBe('inbox')
  })

  it('采纳决策卡：状态完成、待决策减一、托管加一', () => {
    useDirectorStore.getState().acceptDecision('d-drill')
    const s = useDirectorStore.getState()
    expect(s.decisions.find((d) => d.id === 'd-drill')?.status).toBe('done')
    expect(s.stats.pending).toBe(2)
    expect(s.stats.hosted).toBe(5)
  })

  it('口径冲突裁决：完成并写入提示，不重复处理', () => {
    const store = useDirectorStore.getState()
    store.resolveConflict('d-conflict', 'subject')
    expect(useDirectorStore.getState().decisions.find((d) => d.id === 'd-conflict')?.status).toBe('done')
    expect(useDirectorStore.getState().stats.pending).toBe(2)
    useDirectorStore.getState().resolveConflict('d-conflict', 'subject')
    expect(useDirectorStore.getState().stats.pending).toBe(2)
  })

  it('稍后：不打扰且掉出待决策计数', () => {
    useDirectorStore.getState().snoozeDecision('d-letters')
    const s = useDirectorStore.getState()
    expect(s.decisions.find((d) => d.id === 'd-letters')?.status).toBe('snoozed')
    expect(s.stats.pending).toBe(2)
  })

  it('开战 → 审批门 → 放行 → 完成：全链路状态正确', () => {
    useDirectorStore.getState().confirmPlan()
    expect(useDirectorStore.getState().mission.status).toBe('running')

    // 推进到第一个审批门（约 3.7s 的演示时间线）
    vi.advanceTimersByTime(4200)
    const atSpeech = useDirectorStore.getState().mission
    expect(atSpeech.status).toBe('waiting')
    expect(atSpeech.gate).toBe('speech')

    // 放行后继续到第二个审批门
    useDirectorStore.getState().approveGate()
    vi.advanceTimersByTime(3000)
    const atLetters = useDirectorStore.getState().mission
    expect(atLetters.status).toBe('waiting')
    expect(atLetters.gate).toBe('letters')

    // 放行后收尾作战包
    useDirectorStore.getState().approveGate()
    vi.advanceTimersByTime(3000)
    const done = useDirectorStore.getState()
    expect(done.mission.status).toBe('done')
    expect(done.mission.progress).toBe(100)
    expect(done.stats.running).toBe(0)
    expect(done.stats.hosted).toBe(10) // 4 → +6 件交付
  })

  it('审批门退回：不卡死，进入重写并继续', () => {
    useDirectorStore.getState().confirmPlan()
    vi.advanceTimersByTime(4200)
    expect(useDirectorStore.getState().mission.gate).toBe('speech')
    useDirectorStore.getState().rejectGate()
    const rejected = useDirectorStore.getState().mission
    expect(rejected.status).toBe('running')
    expect(rejected.gate).toBeNull()
    vi.advanceTimersByTime(3000)
    const feedTexts = useDirectorStore.getState().mission.feed.map((f) => f.text)
    expect(feedTexts).toContain('按你的意见重写中')
    expect(feedTexts).toContain('重写完成')
  })

  it('授权调整：家校官升到 L2 仍提示发送需人批', () => {
    useDirectorStore.getState().setAutonomy('communicator', 'L2')
    expect(useDirectorStore.getState().autonomy.communicator).toBe('L2')
    const texts = useDirectorStore.getState().toasts.map((t) => t.text)
    expect(texts.some((t) => t.includes('发送仍需你拍板'))).toBe(true)
  })

  it('引导：推进到最后一步后关闭并写入已看标记', () => {
    useDirectorStore.getState().startGuide()
    expect(useDirectorStore.getState().guideActive).toBe(true)
    expect(hasSeenDirectorGuide()).toBe(false)
    useDirectorStore.getState().nextGuide(1)
    expect(useDirectorStore.getState().guideActive).toBe(false)
    expect(hasSeenDirectorGuide()).toBe(true)
  })

  it('重置演示：回到初始状态且清掉定时器', () => {
    useDirectorStore.getState().confirmPlan()
    vi.advanceTimersByTime(1500)
    useDirectorStore.getState().resetDemo()
    expect(useDirectorStore.getState().mission.status).toBe('planning')
    expect(useDirectorStore.getState().decisions.every((d) => d.status === 'new')).toBe(true)
    vi.advanceTimersByTime(5000)
    expect(useDirectorStore.getState().mission.feed).toHaveLength(0)
  })

  it('createInitialDirectorState 是纯工厂（不共享引用）', () => {
    const a = createInitialDirectorState()
    const b = createInitialDirectorState()
    a.decisions[0].status = 'done'
    expect(b.decisions[0].status).toBe('new')
  })
})

/* ------------------------------------------------------------------ */
/* v1.1 M3：第二剧本（模板化执行 / 意图路由 / d-drill 联动）             */
/* ------------------------------------------------------------------ */

describe('directorStore · 第二剧本 exam_loop（v1.1 M3）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    try {
      window.localStorage.clear()
    } catch {
      /* ignore */
    }
    useDirectorStore.getState().resetDemo()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('初始计划带 2 个审批门（UI 用 plan.filter(t=>t.gate) 派生「2 次拍板」）', () => {
    const plan = useDirectorStore.getState().mission.plan
    expect(plan.filter((task) => task.gate)).toHaveLength(2)
    expect(plan.filter((task) => task.gate).map((task) => task.gate)).toEqual(['speech', 'letters'])
  })

  it('startMission 种模板计划但不跳屏', () => {
    useDirectorStore.getState().startMission('exam_loop')
    const s = useDirectorStore.getState()
    expect(s.screen).toBe('inbox')
    expect(s.mission.status).toBe('planning')
    expect(s.mission.kind).toBe('exam_loop')
    expect(s.mission.title).toBe('单元考闭环')
    expect(s.mission.plan).toHaveLength(4)
    expect(s.mission.plan.filter((task) => task.gate).map((task) => task.gate)).toEqual(['worksheet', 'lesson'])
    expect(s.mission.planSource).toBe('template')
    expect(s.missionCursor).toBe(0)
    expect(s.facts.length).toBeGreaterThan(0)
  })

  it('exam_loop 全链路：开战 → worksheet 门 → lesson 门 → done（4 件交付）', () => {
    useDirectorStore.getState().startMission('exam_loop')
    useDirectorStore.getState().confirmPlan()
    expect(useDirectorStore.getState().screen).toBe('mission')
    expect(useDirectorStore.getState().mission.status).toBe('running')

    /* 到第一道门（worksheet，约 3.3s 演示时间线） */
    vi.advanceTimersByTime(3500)
    const atWorksheet = useDirectorStore.getState().mission
    expect(atWorksheet.status).toBe('waiting')
    expect(atWorksheet.gate).toBe('worksheet')
    expect(atWorksheet.feed.map((f) => f.text).join('\n')).toContain('82.4 是物理均分')

    /* 放行 → 第二道门（lesson） */
    useDirectorStore.getState().approveGate()
    vi.advanceTimersByTime(2500)
    const atLesson = useDirectorStore.getState().mission
    expect(atLesson.status).toBe('waiting')
    expect(atLesson.gate).toBe('lesson')
    expect(atLesson.feed.map((f) => f.text).join('\n')).toContain('习题课教案完成')

    /* 放行 → 作战包交付 */
    useDirectorStore.getState().approveGate()
    vi.advanceTimersByTime(3000)
    const done = useDirectorStore.getState()
    expect(done.mission.status).toBe('done')
    expect(done.mission.progress).toBe(100)
    expect(done.mission.kind).toBe('exam_loop')
    expect(done.stats.running).toBe(0)
    /* v1.0 统计口径：初始 hosted 4 + 单元考 4 件 = 8；savedHours 2.1 + 1.2 = 3.3 */
    expect(done.stats.hosted).toBe(8)
    expect(done.stats.savedHours).toBe(3.3)
    expect(done.toasts.map((t) => t.text)).toContain('已交付 · 可导出')
    /* 第二剧本不走家长会口径 */
    expect(JSON.stringify(done.mission)).not.toContain('家长会')
    expect(MISSION_TEMPLATES.exam_loop.artifacts).toHaveLength(4)
  })

  it('两道门命中都不弹 toast（V2），只推进状态', () => {
    useDirectorStore.getState().startMission('exam_loop')
    useDirectorStore.getState().confirmPlan()
    vi.advanceTimersByTime(3500)
    expect(useDirectorStore.getState().mission.gate).toBe('worksheet')
    const texts = useDirectorStore.getState().toasts.map((t) => t.text)
    expect(texts.join('\n')).not.toContain('分层练习待你过目')
  })

  it('rejectGate 按 GATE_OWNER 归因：worksheet 退回命题官重写', () => {
    useDirectorStore.getState().startMission('exam_loop')
    useDirectorStore.getState().confirmPlan()
    vi.advanceTimersByTime(3500)
    expect(useDirectorStore.getState().mission.gate).toBe('worksheet')
    useDirectorStore.getState().rejectGate()
    const rejected = useDirectorStore.getState().mission
    expect(rejected.status).toBe('running')
    expect(rejected.gate).toBeNull()
    const lastFeed = rejected.feed[rejected.feed.length - 1]
    expect(lastFeed.agentId).toBe('assessor')
    expect(lastFeed.text).toBe('按你的意见重写中')
    vi.advanceTimersByTime(3000)
    const texts = useDirectorStore.getState().mission.feed.map((f) => f.text)
    expect(texts).toContain('重写完成')
    expect(texts.some((text) => text.includes('习题课教案完成'))).toBe(true)
  })

  it('d-drill 采纳联动：idle/planning 时覆写 exam_loop 计划、不跳屏', () => {
    expect(useDirectorStore.getState().mission.kind).toBe('parent_meeting')
    useDirectorStore.getState().acceptDecision('d-drill')
    const s = useDirectorStore.getState()
    expect(s.screen).toBe('inbox')
    expect(s.mission.status).toBe('planning')
    expect(s.mission.kind).toBe('exam_loop')
    expect(s.mission.plan).toHaveLength(4)
    expect(s.toasts.map((t) => t.text)).toContain('已采纳 · 单元考闭环计划待确认')
  })

  it('d-drill 采纳联动：mission 已 running 时不覆盖，只提示已加入待办', () => {
    useDirectorStore.getState().confirmPlan() // parent_meeting 开始执行
    useDirectorStore.getState().acceptDecision('d-drill')
    const s = useDirectorStore.getState()
    expect(s.mission.kind).toBe('parent_meeting')
    expect(s.mission.status).toBe('running')
    expect(s.toasts.map((t) => t.text)).toContain('已采纳 · 已加入待办')
  })
})

/* ------------------------------------------------------------------ */
/* v1.1 M1：一句话 → 模板拆解（默认 Mock 不发起真实请求）                */
/* ------------------------------------------------------------------ */

describe('directorStore · planMission（v1.1 M1，默认 Mock）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    try {
      window.localStorage.clear()
    } catch {
      /* ignore */
    }
    window.history.replaceState({}, '', '/')
    useDirectorStore.getState().resetDemo()
  })

  afterEach(() => {
    useSettingsStore.setState({ mode: 'mock', apiKey: '' })
    window.history.replaceState({}, '', '/')
    vi.useRealTimers()
  })

  it('家长会一句话 → 5 环节模板计划落作战室（来源=模板 + reason）', async () => {
    await useDirectorStore.getState().planMission('下周三家长会，材料帮我备齐')
    const s = useDirectorStore.getState()
    expect(s.screen).toBe('mission')
    expect(s.planLoading).toBe(false)
    expect(s.mission.status).toBe('planning')
    expect(s.mission.kind).toBe('parent_meeting')
    expect(s.mission.plan).toHaveLength(5)
    expect(s.mission.plan.filter((task) => task.gate)).toHaveLength(2)
    expect(s.planSource).toBe('template')
    expect(s.mission.planSource).toBe('template')
    expect(s.mission.planReason).toBe('mock_mode')
    expect(s.missionCursor).toBe(0)
    /* facts 随计划冻结（约 10 条统计快照） */
    expect(s.facts.length).toBeGreaterThanOrEqual(9)
  })

  it('单元考一句话 → 路由 exam_loop，4 环节 / 2 门', async () => {
    await useDirectorStore.getState().planMission(
      '用高一（3）班这次单元考做个诊断，出一套分层练习，再备一节习题课。',
    )
    const s = useDirectorStore.getState()
    expect(s.mission.kind).toBe('exam_loop')
    expect(s.mission.title).toBe('单元考闭环')
    expect(s.mission.plan).toHaveLength(4)
    expect(s.mission.plan.filter((task) => task.gate).map((task) => task.gate)).toEqual(['worksheet', 'lesson'])
    expect(s.screen).toBe('mission')
    /* 模板兜底失败不弹 toast（roadmap §4.5 / P0-5） */
    expect(s.toasts).toHaveLength(0)
  })

  it('cancelPlanning 中止后不写回模板计划（requestSeq 防连点）', async () => {
    const pending = useDirectorStore.getState().planMission('这次单元考做个诊断')
    useDirectorStore.getState().cancelPlanning()
    await pending
    const s = useDirectorStore.getState()
    expect(s.planLoading).toBe(false)
    expect(s.screen).toBe('inbox')
    /* 旧计划（初始 parent_meeting planning）保持不变，不会被取消后的模板结果覆盖 */
    expect(s.mission.kind).toBe('parent_meeting')
    expect(s.mission.plan).toHaveLength(5)
  })

  it('?llm=0 强制模板（api 模式也不发请求，reason=llm_disabled）', async () => {
    window.history.replaceState({}, '', '/?llm=0')
    useSettingsStore.setState({ mode: 'api', apiKey: 'sk-test-only', proxyUrl: '' })
    await useDirectorStore.getState().planMission('下周三家长会，材料帮我备齐')
    const s = useDirectorStore.getState()
    expect(s.planSource).toBe('template')
    expect(s.mission.planReason).toBe('llm_disabled')
    expect(s.toasts).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ */
/* v1.1 M2：持久化 / 刷新恢复 / 续跑                                     */
/* ------------------------------------------------------------------ */

function persistedOfLocalStorage(): PersistedDirectorV2 | null {
  const raw = window.localStorage.getItem('edustudio:director')
  return raw ? (JSON.parse(raw) as PersistedDirectorV2) : null
}

describe('directorStore · 持久化与暂停续跑（v1.1 M2）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    try {
      window.localStorage.clear()
    } catch {
      /* ignore */
    }
    useDirectorStore.getState().resetDemo()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('300ms 合并写盘：关键节点立即 flush，切片落盘可恢复', () => {
    useDirectorStore.getState().startMission('exam_loop')
    vi.advanceTimersByTime(300)
    const persisted = persistedOfLocalStorage()
    expect(persisted?.schemaVersion).toBe(2)
    expect(persisted?.mission.kind).toBe('exam_loop')

    /* confirmPlan 是强制 flush 点：不推进定时器也应立刻落盘为 running */
    useDirectorStore.getState().confirmPlan()
    const running = persistedOfLocalStorage()
    expect((running?.mission as { status: string }).status).toBe('running')

    /* 门命中同样强制 flush（刷新后停在 waiting，不依赖定时器） */
    vi.advanceTimersByTime(3500)
    const waiting = persistedOfLocalStorage()
    expect((waiting?.mission as { status: string }).status).toBe('waiting')
    expect((waiting?.mission as { gate: string }).gate).toBe('worksheet')
    expect(waiting?.mission.runtime.cursor).toBe(4)
  })

  it('刷新恢复矩阵：running→paused 且自动落作战室（screen 派生）', () => {
    const source = createInitialDirectorState()
    const makePayload = (status: 'running' | 'planning' | 'waiting' | 'done' | 'idle') =>
      toPersistedDirector(
        {
          decisions: source.decisions,
          stats: source.stats,
          mission: { ...source.mission, status },
          missionCursor: 3,
          planSource: 'template',
          autonomy: source.autonomy,
          facts: [],
        },
        false,
      )
    const paused = hydrateDirectorState(migrateDirectorPersisted(makePayload('running'), makePayload('idle')))
    expect(paused.mission.status).toBe('paused')
    expect(paused.screen).toBe('mission')
    expect(paused.missionCursor).toBe(3)
    /* mission.plan 保留（恢复后计划/门卡可渲染） */
    expect(paused.mission.plan.length).toBeGreaterThan(0)
    expect(hydrateDirectorState(migrateDirectorPersisted(makePayload('waiting'), makePayload('idle'))).screen).toBe(
      'mission',
    )
    expect(hydrateDirectorState(migrateDirectorPersisted(makePayload('done'), makePayload('idle'))).screen).toBe(
      'mission',
    )
    expect(hydrateDirectorState(migrateDirectorPersisted(makePayload('idle'), makePayload('idle'))).screen).toBe(
      'inbox',
    )
  })

  it('resumeMission 从 missionCursor 续跑：不重放 feed、不跳步', () => {
    useDirectorStore.getState().startMission('exam_loop')
    useDirectorStore.getState().confirmPlan()
    vi.advanceTimersByTime(1800) // 已发 2 条动态，cursor=2
    const before = useDirectorStore.getState()
    expect(before.mission.status).toBe('running')
    expect(before.missionCursor).toBe(2)
    expect(before.mission.feed).toHaveLength(3)

    /* 模拟刷新恢复：running 已降级为 paused，screen 落在作战室 */
    useDirectorStore.setState({
      mission: { ...before.mission, status: 'paused' },
      screen: 'mission',
    })
    useDirectorStore.getState().resumeMission()
    expect(useDirectorStore.getState().mission.status).toBe('running')
    /* 续跑前 500ms 调度窗口内不产生新 feed */
    vi.advanceTimersByTime(100)
    expect(useDirectorStore.getState().mission.feed).toHaveLength(3)

    vi.advanceTimersByTime(2200)
    const after = useDirectorStore.getState()
    expect(after.mission.status).toBe('waiting')
    expect(after.mission.gate).toBe('worksheet')
    const texts = after.mission.feed.map((f) => f.text)
    /* 已发 feed 不重放（每条只出现一次），且没有跳步（放行前必须停在门上） */
    expect(texts.filter((t) => t === '核对单元考数据（物理 82.4 / 数学 78.6 / 化学 80.2）')).toHaveLength(1)
    expect(texts.filter((t) => t === '标出 1 处口径：82.4 是物理均分，不是班级均分')).toHaveLength(1)
    expect(texts).toContain('分层练习完成（基础 70% / 提高 30% · 12 题）')
    /* t1 与 t2 的环节在续跑前/后各完成一次，各自只记一次 */
    expect(after.mission.doneTasks).toEqual(['t1', 't2'])
  })

  it('resetDemo 先 cancel 待写再回初始：不把旧状态写回，且保留 guideSeen', () => {
    useDirectorStore.getState().startGuide(true)
    useDirectorStore.getState().nextGuide(GUIDE_STEPS.length)
    expect(hasSeenDirectorGuide()).toBe(true)

    useDirectorStore.getState().confirmPlan()
    vi.advanceTimersByTime(1500)
    useDirectorStore.getState().resetDemo()
    /* 重置后立刻落盘的应是初始态，不是 300ms 后回写的旧 running 态 */
    const persisted = persistedOfLocalStorage()
    expect((persisted?.mission as { status: string }).status).toBe('planning')
    expect(persisted?.mission.kind).toBe('parent_meeting')
    expect(useDirectorStore.getState().mission.feed).toHaveLength(0)
    expect(hasSeenDirectorGuide()).toBe(true)
    vi.advanceTimersByTime(5000)
    expect(useDirectorStore.getState().mission.feed).toHaveLength(0)
  })

  it('resetDemo 清掉旧键：刷新后不会从 guideSeen 迁移走引导', () => {
    expect(GUIDE_STEPS[0].hint).toBe('先看这一张')
    useDirectorStore.getState().startGuide(true)
    useDirectorStore.getState().closeGuide()
    expect(window.localStorage.getItem('edustudio:director-guide')).toBeNull()
  })
})

