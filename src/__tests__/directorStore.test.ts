import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitialDirectorState, hasSeenDirectorGuide, useDirectorStore } from '../stores/directorStore'

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
