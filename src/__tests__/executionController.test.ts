/**
 * v1.2 M3 · 执行控制器单测（roadmap §4.2 / §4.6）
 * 覆盖：执行模式判定（URL/settings 降级）、门等待器（一次性/abort/重复注册）、
 * 刷新恢复归一（running/waiting + execution meta → paused）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalGate } from '../studio/contracts'
import { hasGateResolver, resetGateRegistry, resolveGate } from '../studio/gateRegistry'
import { createMissionGateWaiter, installMissionExecution, resolveExecutionMode } from '../integrations/director/execution'
import { useDirectorStore, setDirectorExecutionMeta } from '../stores/directorStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useAuthStore } from '../stores/authStore'

const GATE: ApprovalGate = {
  gateId: 'worksheet',
  missionId: 'm-1',
  source: 'mission',
  title: '分层练习单待你过目',
  requiredAction: 'approve',
  sensitive: false,
}

function setSearch(search: string): void {
  window.history.replaceState({}, '', `/${search}`)
}

function apiSettings(): void {
  useSettingsStore.getState().update({ mode: 'api', apiKey: 'sk-test', proxyUrl: '' })
}

function mockSettings(): void {
  useSettingsStore.getState().update({ mode: 'mock', apiKey: '', proxyUrl: '' })
}

describe('resolveExecutionMode（URL > settings.studio > 降级可见）', () => {
  beforeEach(() => {
    resetGateRegistry()
    useAuthStore.setState({ role: 'teacher' })
    mockSettings()
    setSearch('')
    // 清掉 settings.studio 的 flag/landing 影响
    useSettingsStore.getState().updateStudio({ landing: 'auto', flags: {} })
  })

  it('默认（无 exec）→ Mock', () => {
    expect(resolveExecutionMode()).toEqual({ mode: 'mock' })
  })

  it('?exec=real 且 API 已配置 → real', () => {
    apiSettings()
    setSearch('?v2=1&exec=real')
    expect(resolveExecutionMode().mode).toBe('real')
  })

  it('?exec=real 但未配置 API → 回退 Mock 且给一行原因', () => {
    setSearch('?v2=1&exec=real')
    const resolution = resolveExecutionMode()
    expect(resolution.mode).toBe('mock')
    expect(resolution.reason).toContain('Mock')
  })

  it('?exec=mock 强制 Mock（即使 API 已配置）', () => {
    apiSettings()
    setSearch('?v2=1&exec=mock')
    expect(resolveExecutionMode().mode).toBe('mock')
  })

  it('?legacy=1 强制 realExecution off → Mock', () => {
    apiSettings()
    setSearch('?v2=1&exec=real&legacy=1')
    expect(resolveExecutionMode().mode).toBe('mock')
  })
})

describe('createMissionGateWaiter（一次性出口）', () => {
  beforeEach(resetGateRegistry)
  afterEach(resetGateRegistry)

  it('resolveGate 解决一次后，重复 resolve 返回 false', async () => {
    const waiter = createMissionGateWaiter()
    const pending = waiter.wait(GATE, new AbortController().signal)
    expect(hasGateResolver('worksheet')).toBe(true)
    expect(resolveGate('worksheet', 'continue')).toBe(true)
    await expect(pending).resolves.toBe('continue')
    expect(hasGateResolver('worksheet')).toBe(false)
    expect(resolveGate('worksheet', 'cancel')).toBe(false)
  })

  it('abort 时以 AbortError 结束并清理 resolver', async () => {
    const waiter = createMissionGateWaiter()
    const controller = new AbortController()
    const pending = waiter.wait(GATE, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(hasGateResolver('worksheet')).toBe(false)
  })

  it('同一 gateId 重复 wait：第二个立即 continue（不死锁）', async () => {
    const waiter = createMissionGateWaiter()
    const first = waiter.wait(GATE, new AbortController().signal)
    const second = waiter.wait(GATE, new AbortController().signal)
    await expect(second).resolves.toBe('continue')
    resolveGate('worksheet', 'continue')
    await expect(first).resolves.toBe('continue')
  })
})

describe('installMissionExecution（刷新恢复归一）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetGateRegistry()
    useAuthStore.setState({ role: 'teacher' })
    mockSettings()
    setSearch('')
    useDirectorStore.getState().resetDemo()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('安装时把「有 execution meta 的 running/waiting」降级为 paused（等用户继续）', () => {
    const mission = useDirectorStore.getState().mission
    useDirectorStore.setState({ mission: { ...mission, status: 'waiting', gate: 'worksheet' } })
    setDirectorExecutionMeta({ mode: 'mock', missionId: 'm-123', startedAt: 123 })
    const stop = installMissionExecution()
    expect(useDirectorStore.getState().mission.status).toBe('paused')
    expect(useDirectorStore.getState().mission.gate).toBeNull()
    stop()
  })

  it('无 execution meta（旧 ?v1=1 剧本路径）不做归一', () => {
    const mission = useDirectorStore.getState().mission
    useDirectorStore.setState({ mission: { ...mission, status: 'waiting', gate: 'speech' } })
    const stop = installMissionExecution()
    expect(useDirectorStore.getState().mission.status).toBe('waiting')
    stop()
  })

  it('卸载后恢复「无控制器」语义（清理可重入）', () => {
    const stop = installMissionExecution()
    stop()
    const stop2 = installMissionExecution()
    stop2()
  })
})
