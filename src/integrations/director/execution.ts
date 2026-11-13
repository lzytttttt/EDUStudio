/**
 * v1.2 M3 · mission 执行控制器（Director lazy chunk，roadmap §4.2 / §4.6）
 *
 * 职责：把 `MissionRunner` 与旧 `directorStore` 连起来——不复制任务实体、不接管 UI：
 * - 统一壳（?v2=1）确认计划后由本控制器驱动真执行/Mock runner（旧 `?v1=1` 整屏不安装 → 保持剧本时间线）；
 * - runner 事件映射为 directorStore 的 mission/feed/doneTasks/gate 状态（UI 零改动即可显示）；
 * - 审批门通过 `studio/gateRegistry` 注册 resolver，store 的 approveGate/rejectGate 转发决策 → 一次只回执一次；
 * - 交付物：真执行产物经证据校验后发布（`publishRuntimeArtifacts`）；Mock 模式沿用 M2 模板交付物桥；
 * - 刷新恢复：页面重载/重新进入时把「已丢失 runner 的 running/waiting」降级为 paused，用户点「继续」后
 *   由 `completedTasks` seed 续跑未完成节点（不重复已完成环节）。
 *
 * 降级矩阵（§4.6）：
 * - 未配置 API / `?exec=mock` → Mock 执行（角标可见）；
 * - `?exec=real` 但未配置 API → 回退 Mock 并给一行原因（不假装真执行）；
 * - 任务失败重试 1 次后标 partial（MissionStatus 仍 6 值，结果放 execution.outcome）；
 * - 用户取消 → abort，已产出保留。
 */
import { getAgentProvider } from '../../harness/agent'
import { getProviders } from '../../harness/providerRegistry'
import type { AgentProvider } from '../../harness/types'
import type { MissionGateWaiter, MissionRunnerResult } from '../../harness/team/types'
import type {
  AgentSpec,
  ApprovalGate,
  DirectorAgentId,
  ExecutionPlan,
  FactSnapshot,
  MissionRunEvent,
} from '../../studio/contracts'
import { registerGateResolver, resolveGate } from '../../studio/gateRegistry'
import { resolveFlag } from '../../studio/flags'
import { useAuthStore } from '../../stores/authStore'
import {
  getDirectorExecutionMeta,
  setDirectorArtifactIds,
  setDirectorExecutionController,
  setDirectorExecutionMeta,
  useDirectorStore,
  type DirectorExecutionController,
} from '../../stores/directorStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { AGENT_MAP } from '../../harness/director/data'
import type { FeedItem, GateId, MissionKind, MissionPlanTask } from '../../harness/director/types'
import { publishRuntimeArtifacts } from './deliverables'

/** 真执行单任务超时（§4.2）；Mock 演示用更短，避免演示等待 */
const REAL_TASK_TIMEOUT_MS = 90_000
const MOCK_TASK_TIMEOUT_MS = 20_000
/** 并发上限（§4.2：2，前台优先；mission 走 background 优先级） */
const MISSION_CONCURRENCY = 2

/* ------------------------------------------------------------------ */
/* 事件 → store 映射                                                    */
/* ------------------------------------------------------------------ */

let runFeedSeq = 0

function runFeed(agentId: DirectorAgentId, text: string, kind: FeedItem['kind'] = 'step'): FeedItem {
  runFeedSeq += 1
  /* id 带时间戳基座：避免页面 HMR / 模块重载后 seq 复位与既有 feed 撞 key（React 列表唯一性） */
  return { id: `run-${Date.now().toString(36)}-${runFeedSeq}`, agentId, text, at: Date.now(), kind }
}

function agentName(agentId: DirectorAgentId): string {
  return AGENT_MAP[agentId]?.name ?? agentId
}

function progressOf(done: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(99, Math.max(0, Math.round((done / total) * 100)))
}

/* ------------------------------------------------------------------ */
/* 执行模式判定（URL > settings.studio > 角色默认；降级可见）            */
/* ------------------------------------------------------------------ */

export interface ExecutionModeResolution {
  mode: 'real' | 'mock'
  /** Mock 原因（真执行回退时给一行可见原因；纯 Mock 模式为 undefined） */
  reason?: string
}

export function resolveExecutionMode(): ExecutionModeResolution {
  let search = ''
  try {
    search = window.location.search
  } catch {
    search = ''
  }
  const role = useAuthStore.getState().role
  const settings = useSettingsStore.getState()
  const studio = settings.studio
  const flag = resolveFlag('realExecution', role, {
    search,
    settings: studio,
    defaultMode: 'shadow',
  })
  if (!flag.value) return { mode: 'mock' }
  const params = new URLSearchParams(search)
  const exec = params.get('exec')
  const configured = settings.mode === 'api' && (!!settings.apiKey || !!settings.proxyUrl)
  if (!configured) {
    return { mode: 'mock', reason: exec === 'real' ? '未配置 API/代理，已回退 Mock 执行' : undefined }
  }
  return { mode: 'real' }
}

function providerFor(mode: 'real' | 'mock'): AgentProvider {
  return mode === 'real' ? getProviders().agent : getAgentProvider('mock')
}

/* ------------------------------------------------------------------ */
/* 门等待器：runner → gateRegistry → store 决策                         */
/* ------------------------------------------------------------------ */

export function createMissionGateWaiter(): MissionGateWaiter {
  return {
    wait(gate: ApprovalGate, signal: AbortSignal): Promise<'continue' | 'cancel'> {
      return new Promise<'continue' | 'cancel'>((resolve, reject) => {
        if (signal.aborted) {
          reject(new DOMException('Aborted', 'AbortError'))
          return
        }
        let settled = false
        let dispose = (): void => {}
        const cleanup = (): void => {
          signal.removeEventListener('abort', onAbort)
        }
        const onAbort = (): void => {
          if (settled) return
          settled = true
          cleanup()
          dispose()
          reject(new DOMException('Aborted', 'AbortError'))
        }
        const registered = registerGateResolver(gate.gateId, (action) => {
          if (settled) return
          settled = true
          cleanup()
          resolve(action)
        })
        /* 同一 gateId 已有 resolver（异常重入）：不等待，直接 continue 避免死锁 */
        if (!registered.ok) {
          resolve('continue')
          return
        }
        dispose = registered.dispose
        signal.addEventListener('abort', onAbort)
      })
    },
  }
}

/* ------------------------------------------------------------------ */
/* 运行态管理                                                          */
/* ------------------------------------------------------------------ */

interface ActiveRun {
  abort: AbortController
  missionId: string
}

let activeRun: ActiveRun | null = null
let installed = false

function planOf(
  missionId: string,
  title: string,
  kind: MissionKind,
  tasks: MissionPlanTask[],
  snapshot: FactSnapshot,
  mode: 'real' | 'mock',
  agentSpecs: Record<DirectorAgentId, AgentSpec>,
): ExecutionPlan {
  return {
    missionId,
    kind,
    execution: mode,
    tasks,
    facts: snapshot,
    agentSpecs,
    title,
  }
}

function appendFeed(item: FeedItem): void {
  const state = useDirectorStore.getState()
  useDirectorStore.setState({ mission: { ...state.mission, feed: [...state.mission.feed, item].slice(-60) } })
}

function setGateWaiting(gate: ApprovalGate, title?: string): void {
  const state = useDirectorStore.getState()
  useDirectorStore.setState({
    mission: {
      ...state.mission,
      status: 'waiting',
      gate: gate.gateId as GateId,
      feed: [...state.mission.feed, runFeed(gate.ownerAgentId ?? 'chief', title ?? gate.title, 'gate')].slice(-60),
    },
  })
}

/** runner 事件 → store（feed / progress / doneTasks / gate） */
function applyRunEvent(event: MissionRunEvent): void {
  const state = useDirectorStore.getState()
  const mission = state.mission
  switch (event.kind) {
    case 'task.start': {
      const agentId = event.agentId ?? 'chief'
      useDirectorStore.setState({
        mission: {
          ...mission,
          status: 'running',
          feed: [...mission.feed, runFeed(agentId, `${agentName(agentId)} 开始：${event.text ?? ''}`, 'step')].slice(-60),
        },
      })
      break
    }
    case 'feed': {
      if (!event.text) break
      appendFeed(runFeed(event.agentId ?? 'chief', event.text, 'step'))
      break
    }
    case 'gate': {
      if (event.gate) setGateWaiting(event.gate, event.text)
      break
    }
    case 'task.done': {
      const done = [...mission.doneTasks]
      if (event.taskId && !done.includes(event.taskId)) done.push(event.taskId)
      useDirectorStore.setState({
        mission: {
          ...mission,
          status: 'running',
          gate: null,
          doneTasks: done,
          progress: progressOf(done.length, mission.plan.length),
          feed: [...mission.feed, runFeed(event.agentId ?? 'chief', event.text ?? '环节完成', 'step')].slice(-60),
        },
      })
      /* v1.2 M3 刷新续跑：已完成环节实时写入 execution meta（resume seed 用，不重跑） */
      const meta = getDirectorExecutionMeta()
      if (meta && activeRun) setDirectorExecutionMeta({ ...meta, completedTasks: done })
      break
    }
    case 'error': {
      appendFeed(runFeed(event.agentId ?? 'chief', event.text ?? event.error ?? '环节失败', 'step'))
      break
    }
    case 'artifact': {
      if (event.artifact) {
        appendFeed(runFeed(event.agentId ?? 'chief', `已产出：${event.artifact.title}`, 'step'))
      }
      break
    }
    case 'partial': {
      if (event.text) appendFeed(runFeed('chief', event.text, 'system'))
      break
    }
    default:
      break
  }
}

/** 收尾：mission done + 统计 + 交付物（真执行走证据校验，Mock 走模板桥） + 持久化 */
async function finishRun(result: MissionRunnerResult, mode: 'real' | 'mock', missionId: string, startedAt: number): Promise<void> {
  const state = useDirectorStore.getState()
  const mission = state.mission
  if (result.status === 'cancelled') {
    setDirectorExecutionMeta({ ...(getDirectorExecutionMeta() ?? { mode }), mode, missionId, startedAt, outcome: 'cancelled' })
    appendFeed(runFeed('chief', '任务已取消，已产出的内容保留为草稿', 'system'))
    return
  }

  const outcome = result.status === 'done' ? 'done' : 'partial'
  const done = Array.from(new Set([...mission.doneTasks, ...result.completedTasks]))
  const partialText =
    outcome === 'partial'
      ? `部分完成：${result.failedTasks.length} 个环节未完成（${result.failedTasks.map((f) => f.taskId).join('、')}）`
      : '已交付 · 可导出'
  useDirectorStore.setState({
    mission: {
      ...mission,
      status: 'done',
      progress: 100,
      gate: null,
      doneTasks: done,
      finishedAt: Date.now(),
      feed: [...mission.feed, runFeed('chief', partialText, 'system')].slice(-60),
    },
    stats: {
      ...state.stats,
      running: 0,
      hosted: state.stats.hosted + (result.artifacts.length > 0 ? result.artifacts.length : mission.plan.length),
    },
  })
  setDirectorExecutionMeta({
    mode,
    missionId,
    outcome,
    startedAt,
    finishedAt: Date.now(),
    completedTasks: done,
    failedTasks: result.failedTasks,
    attempts: result.attempts,
  })
  useDirectorStore.getState().toast(outcome === 'done' ? '已交付 · 可导出' : '部分完成 · 失败环节已标出', outcome === 'done' ? 'mint' : 'amber')

  /* 交付物：真执行 → 证据校验后发布；Mock → 沿用 M2 模板交付物桥（mission done 自动发布） */
  if (mode === 'real' && result.artifacts.length > 0) {
    try {
      const facts = useDirectorStore.getState().facts
      const published = publishRuntimeArtifacts({
        missionId,
        role: 'teacher',
        facts,
        artifacts: result.artifacts,
      })
      setDirectorArtifactIds(published.docIds)
    } catch (error) {
      console.error('[execution] 交付物发布失败:', error)
      appendFeed(runFeed('chief', '交付物发布失败，请稍后在文档面板重试', 'system'))
    }
  }
}

async function startRun(opts: { resume?: boolean } = {}): Promise<void> {
  const state = useDirectorStore.getState()
  const mission = state.mission
  if (mission.plan.length === 0) return
  if (activeRun) return
  const previous = getDirectorExecutionMeta()
  const startedAt = mission.startedAt ?? Date.now()
  const missionId = opts.resume && previous?.missionId ? previous.missionId : `m-${startedAt}`
  const resolution = resolveExecutionMode()
  const mode = resolution.mode
  const snapshot: FactSnapshot = {
    missionId,
    role: 'teacher',
    takenAt: Date.now(),
    facts: state.facts,
  }
  const abort = new AbortController()
  activeRun = { abort, missionId }

  setDirectorExecutionMeta({
    mode,
    missionId,
    startedAt,
    completedTasks: opts.resume ? previous?.completedTasks ?? [] : [],
    failedTasks: [],
    attempts: 0,
  })
  useDirectorStore.setState({
    screen: 'mission',
    stats: { ...state.stats, running: 1 },
    mission: {
      ...mission,
      status: 'running',
      gate: null,
      startedAt,
      finishedAt: undefined,
      ...(opts.resume && previous?.completedTasks ? { doneTasks: previous.completedTasks } : { doneTasks: [], progress: 0 }),
    },
  })
  appendFeed(
    runFeed(
      'chief',
      mode === 'real'
        ? '已接管 · 真执行模式'
        : resolution.reason
          ? `已接管 · Mock 演示（${resolution.reason}）`
          : '已接管 · Mock 演练模式',
      'system',
    ),
  )
  useDirectorStore.getState().toast(mode === 'real' ? '真执行 · 战队开始跑模型' : 'Mock 执行 · 演示时间线', 'primary')

  /* v1.2 M3：执行内核与 AgentSpec 注册表按需懒加载（runner 独立 chunk，Director 主体不超 50KB 门槛） */
  let runnerModule: typeof import('../../harness/team/runner')
  let agentsModule: typeof import('../../harness/team/agents')
  try {
    ;[runnerModule, agentsModule] = await Promise.all([
      import('../../harness/team/runner'),
      import('../../harness/team/agents'),
    ])
  } catch (error) {
    console.error('[execution] 执行内核加载失败:', error)
    appendFeed(runFeed('chief', '执行内核加载失败，请刷新页面重试', 'system'))
    setDirectorExecutionMeta({ ...(getDirectorExecutionMeta() ?? { mode }), mode, missionId, startedAt, outcome: 'failed' })
    if (activeRun?.abort === abort) activeRun = null
    return
  }

  const plan = planOf(missionId, mission.title, mission.kind, mission.plan, snapshot, mode, agentsModule.MISSION_AGENT_SPECS)
  try {
    const result = await runnerModule.runMission(
      plan,
      {
        agent: providerFor(mode),
        gate: createMissionGateWaiter(),
        snapshot,
        concurrency: MISSION_CONCURRENCY,
        taskTimeoutMs: mode === 'real' ? REAL_TASK_TIMEOUT_MS : MOCK_TASK_TIMEOUT_MS,
        maxTaskRetries: 1,
        ...(opts.resume && previous?.completedTasks?.length ? { completedTasks: previous.completedTasks } : {}),
      },
      (event) => applyRunEvent(event),
      abort.signal,
    )
    await finishRun(result, mode, missionId, startedAt)
  } catch (error) {
    console.error('[execution] mission 执行异常:', error)
    appendFeed(runFeed('chief', '执行中断，已产出的内容保留为草稿', 'system'))
    setDirectorExecutionMeta({ ...(getDirectorExecutionMeta() ?? { mode }), mode, missionId, startedAt, outcome: 'failed' })
  } finally {
    if (activeRun?.abort === abort) activeRun = null
  }
}

/** 刷新 / 重新进入：把「runner 已丢失的 running/waiting」降级为 paused，等用户「继续」续跑 */
function normalizeInterruptedMission(): void {
  const state = useDirectorStore.getState()
  const meta = getDirectorExecutionMeta()
  if (!meta || meta.outcome) return
  if (state.mission.status !== 'running' && state.mission.status !== 'waiting') return
  useDirectorStore.setState({
    mission: { ...state.mission, status: 'paused', gate: null },
    stats: { ...state.stats, running: 0 },
  })
  appendFeed(runFeed('chief', '已暂停 · 继续后从断点接着跑（刷新恢复）', 'system'))
}

/* ------------------------------------------------------------------ */
/* 安装 / 卸载                                                         */
/* ------------------------------------------------------------------ */

/**
 * 安装执行控制器（CommandCenter 挂载时调用；幂等）。
 * 返回清理函数：卸载时中断 runner 并还原「无控制器」= 旧剧本时间线（仅测试/热重载用）。
 */
export function installMissionExecution(): () => void {
  if (installed) return () => {}
  installed = true
  normalizeInterruptedMission()

  const controller: DirectorExecutionController = {
    start: () => {
      void startRun()
    },
    resolveGate: (gateId, action) => {
      resolveGate(gateId, action)
    },
    cancel: () => {
      activeRun?.abort.abort()
      activeRun = null
    },
    resume: () => {
      void startRun({ resume: true })
    },
  }
  setDirectorExecutionController(controller)
  return () => {
    installed = false
    activeRun?.abort.abort()
    activeRun = null
    setDirectorExecutionController(null)
  }
}

/** 测试/诊断：当前是否有在跑的 runner */
export function hasActiveMissionRun(): boolean {
  return activeRun !== null
}
