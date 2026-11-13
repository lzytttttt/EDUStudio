/**
 * 总指挥工作区容器 CommandCenter（v1.2 M1-B → M2，roadmap §2.2 / §3.3 / §3.4 / §5.1 影子期）
 *
 * 只由统一外壳 ShellLayout 在 `?v2=1` 下 lazy 加载（默认导出、无 props，主 chunk 不静态 import
 * 本文件）；旧 `?v1=1` 整屏 DirectorApp 一字不改，仍走自己的入口。
 *
 * 职责（M2 起六件事）：
 * 1. **视图注册**：模块加载即向主 chunk 的 SurfaceHost 注册 inbox/mission/team 三个视图，
 *    `load` 再懒一层 → 首屏只需要本容器 + 当前一个视图；
 * 2. **路由 ↔ 编排态同步**：URL（routeStore）是外壳导航的事实源，`directorStore.screen` 是
 *    三屏内部动作（openMission / 返回战情台 / 引导切屏）的落点；双向同步靠「幂等比较 + 回环
 *    ref」，任一侧变化只在两侧不一致时写另一侧，不会互相触发死循环；
 * 3. **一句话委托消费**：顶栏 IntentBar 在主 chunk，委托槽 `studio/intent` 只存一行文本；
 *    本容器挂载时补处理「未挂载时提交」的槽，挂载期间由 `intent.submitted` 事件即时处理
 *    （`consumePendingIntent` 消费式去重，一条意图只拆一次）；
 * 4. **复用 Director 演示行为**：`?tour` 引导、`?mission=exam_loop` 演示兜底、GuideBar /
 *    ArtifactSheet，全部直接复用旧模块，不复制实现；
 * 5. **v1.2 M2 · mission/gate 投影**（§3.4「跨域通信只走 StudioBus」）：把 directorStore 的
 *    mission 状态变化投影为 `mission.planned/started/task.done/delivered`、`gate.waiting/resolved`
 *    事件，供主 chunk 的派生收件箱 / 只读投影消费（本文件不直接写收件箱 store）；
 * 6. **v1.2 M2 · 交付物发布桥 + 统一轻提示**：挂载时安装 `installMissionDeliverablesBridge()`
 *    （mission done → artifactStore，M2 任务 6 实现，卸载时清理）；Director 轻提示改为转发到
 *    `uiStore.pushToast` 统一层（本文件不再自绘 toast，legacy DirectorApp 不动）。
 *
 * 边界：本文件只在 Director lazy chunk 内；可 import `apps/director/**`（不是主 chunk）；
 * 零新依赖；不修改任何既有文件。
 */
import { useEffect, useRef } from 'react'
import type { DirectorScreen, DirectorState, MissionState, Tone } from '../../harness/director/types'
import type { ApprovalGate } from '../../studio/contracts'
import { GATE_OWNER } from '../../harness/director/data'
import { hasSeenDirectorGuide, useDirectorStore } from '../../stores/directorStore'
import { useRouteStore } from '../../stores/routeStore'
import { useUiStore } from '../../stores/uiStore'
import { studioBus } from '../../studio/bus'
import { consumePendingIntent } from '../../studio/intent'
import { navigateTo, studioRouter } from '../../studio/router'
import { registerSurface, SurfaceHost } from '../../shell/SurfaceHost'
import { installMissionDeliverablesBridge } from '../../integrations/director/deliverables'
import { installMissionExecution, resolveExecutionMode } from '../../integrations/director/execution'
import ArtifactSheet from '../director/ArtifactSheet'
import GuideBar from '../director/GuideBar'
import CommandFallback from './CommandFallback'
import '../director/director.css'

/* ------------------------------------------------------------------ */
/* 1. 视图注册（模块加载时一次；同 id 幂等覆盖，chunk 重载不报错）        */
/* ------------------------------------------------------------------ */

registerSurface({ id: 'inbox', title: '战情台', load: () => import('./InboxView'), requires: 'director' })
registerSurface({ id: 'mission', title: '作战室', load: () => import('./MissionView'), requires: 'director' })
registerSurface({ id: 'team', title: '战队', load: () => import('./TeamView'), requires: 'director' })

/* ------------------------------------------------------------------ */
/* 2. mission / gate → StudioEvent 投影（roadmap §3.4，M2）              */
/* ------------------------------------------------------------------ */

/** missionId 统一口径：`m-` + startedAt（未开始为 `m-0`） */
const MISSION_ID_PREFIX = 'm-'

/**
 * 投影去重账本（模块级：工作区来回切换、CommandCenter 卸载/重挂都不重复 emit；
 * 整页刷新自然复位；任务书要求「用 ref 去重」，这里是其模块级等价物，作用域随页面）。
 */
interface MissionProjection {
  /** 已投影的 mission（startedAt 变化 = 新一轮 mission，账本复位） */
  missionId: string | null
  planned: boolean
  started: boolean
  delivered: boolean
  /** 等待中的审批门：离开 waiting 时按它发 gate.resolved（状态里 gate 已被清空） */
  waitingGateId: string | null
  /** 已投影的完成环节（mission.task.done 去重；agentId 从 plan 反查） */
  doneTasks: Set<string>
}

function emptyProjection(missionId: string | null): MissionProjection {
  return { missionId, planned: false, started: false, delivered: false, waitingGateId: null, doneTasks: new Set() }
}

let projection: MissionProjection = emptyProjection(null)

function missionIdOf(mission: MissionState): string {
  return `${MISSION_ID_PREFIX}${mission.startedAt ?? 0}`
}

/** mission gate → 统一 ApprovalGate（§3.4「唯一审批门事件」；收件箱按 gateId 去重） */
function approvalGateOf(mission: MissionState, missionId: string): ApprovalGate | null {
  const gate = mission.gate
  if (!gate) return null
  const task = mission.plan.find((item) => item.gate === gate)
  /* 门的标题用剧本里该门的文案（feed 最后一条 gate 事件），兜底用被卡环节标题 */
  const feedText = [...mission.feed].reverse().find((item) => item.kind === 'gate')?.text
  return {
    gateId: `${missionId}:${gate}`,
    missionId,
    ...(task ? { taskId: task.id } : {}),
    source: 'mission',
    title: feedText ?? task?.title ?? '等待你拍板',
    ownerAgentId: task?.agentId ?? GATE_OWNER[gate],
    requiredAction: 'approve',
    /* 对外发送类门（家长信）不可逆：标 hard/sensitive；mission demo 也永不自动放行 */
    sensitive: gate === 'letters',
  }
}

/** plan 里的执行成员（去重）：mission.planned 的 agentIds 供只读团队摘要使用 */
function planAgentIds(mission: MissionState): MissionState['plan'][number]['agentId'][] {
  return Array.from(new Set(mission.plan.map((task) => task.agentId)))
}

/**
 * 投影一次 directorStore 状态（同步 emit，消费者自行去重）。
 * @param prev 上一次状态；`null` = CommandCenter 挂载时的「对齐」：只补发**仍在等待**的审批门
 *   （刷新 / 工作区来回切换后收件箱不丢门），不回放计划/开始/交付等历史事件（避免刷新后重复计数）。
 */
function projectDirectorState(prev: DirectorState | null): void {
  const mission = useDirectorStore.getState().mission
  const missionId = missionIdOf(mission)
  const catchUp = prev === null

  /* 新一轮 mission（startedAt 变化）：复位账本；上一轮残留的等待门收口为 resolved，避免幽灵待办 */
  if (projection.missionId !== missionId) {
    if (projection.waitingGateId !== null) {
      studioBus.emit({ type: 'gate.resolved', gateId: projection.waitingGateId, resolution: 'cancel' })
    }
    projection = emptyProjection(missionId)
  }

  /* ① 离开 waiting → gate.resolved（approve / reject / 取消都会离开 waiting；旧 store 无法区分
     通过与否，统一记 continue，精确回执由 M3 的真门事件承担） */
  if (projection.waitingGateId !== null && mission.status !== 'waiting') {
    const gateId = projection.waitingGateId
    projection.waitingGateId = null
    studioBus.emit({ type: 'gate.resolved', gateId, resolution: 'continue' })
  }

  /* ② 进入 waiting → gate.waiting（本轮同一 gateId 只发一次；刷新后重发以恢复收件箱） */
  if (mission.status === 'waiting' && mission.gate) {
    const gate = approvalGateOf(mission, missionId)
    if (gate && projection.waitingGateId !== gate.gateId) {
      projection.waitingGateId = gate.gateId
      studioBus.emit({ type: 'gate.waiting', gate })
    }
  }

  /* ③ mission.planned：plan 从空 → 非空且仍在 planning（计划待确认） */
  if (!catchUp && !projection.planned && mission.plan.length > 0 && mission.status === 'planning') {
    studioBus.emit({
      type: 'mission.planned',
      missionId,
      kind: mission.kind,
      planSource: mission.planSource,
      tasks: mission.plan.length,
      agentIds: planAgentIds(mission),
    })
  }
  if (mission.plan.length > 0) projection.planned = true

  /* ④ mission.started：本轮第一次进入 running（v1.2 M3：execution 取真实执行模式） */
  if (!catchUp && !projection.started && mission.status === 'running') {
    projection.started = true
    studioBus.emit({
      type: 'mission.started',
      missionId,
      execution: useDirectorStore.getState().execution?.mode ?? 'mock',
    })
  }
  /* ④ 挂载对齐：已经在跑 / 在等门 / 已交付的 mission 视为「本轮已开始」，不补发 started */
  if (catchUp && mission.status !== 'idle' && mission.status !== 'planning') projection.started = true

  /* ⑤ mission.task.done：doneTasks 新增项（agentId 从 plan 反查；查不到不发，保证事件必带成员） */
  if (catchUp) {
    mission.doneTasks.forEach((taskId) => projection.doneTasks.add(taskId))
  } else {
    for (const taskId of mission.doneTasks) {
      if (projection.doneTasks.has(taskId)) continue
      projection.doneTasks.add(taskId)
      const agentId = mission.plan.find((item) => item.id === taskId)?.agentId
      if (agentId) studioBus.emit({ type: 'mission.task.done', missionId, taskId, agentId })
    }
  }

  /* ⑥ mission.delivered：本轮第一次 done（artifactIds 由交付物发布桥的 artifact.published 补全） */
  if (!catchUp && !projection.delivered && mission.status === 'done') {
    projection.delivered = true
    studioBus.emit({ type: 'mission.delivered', missionId, artifactIds: [] })
  }
  if (catchUp && mission.status === 'done') projection.delivered = true
}

/* ------------------------------------------------------------------ */
/* 3. 轻提示：directorStore.toasts 新增项 → 统一 toast 层（§2.3 F6）      */
/* ------------------------------------------------------------------ */

/**
 * v1.2 M2：Director 的轻提示不再自绘（原 command-toasts 已删除），改为转发到主 chunk 的
 * `uiStore.pushToast`（由 ShellChrome 的 StudioToasts 统一渲染）。旧 `?v1=1` DirectorApp 的
 * 自绘 toast 完全不动。
 *
 * tone 映射（Director 5 种 → 统一 3 类）：
 * - mint（数据/完成）→ success；
 * - coral（沟通/对外，警示）→ error；
 * - amber（设计/待处理，警示）→ error（统一层没有 warning，归入需注意的 error）；
 * - primary（编排）、graphite（事务）→ info。
 */
type UiToastBridge = { pushToast?: (kind: 'info' | 'success' | 'error', text: string) => void }

const TOAST_KIND_BY_TONE: Record<Tone, 'info' | 'success' | 'error'> = {
  primary: 'info',
  mint: 'success',
  coral: 'error',
  amber: 'error',
  graphite: 'info',
}

/** 已转发的提示 id（模块级：切工作区回来不复读旧提示；directorStore 的 toast id 单调递增） */
const forwardedToastIds = new Set<string>()

function forwardDirectorToasts(): void {
  const push = (useUiStore.getState() as UiToastBridge).pushToast
  for (const item of useDirectorStore.getState().toasts) {
    if (forwardedToastIds.has(item.id)) continue
    forwardedToastIds.add(item.id)
    push?.(TOAST_KIND_BY_TONE[item.tone], item.text)
  }
}

/* ------------------------------------------------------------------ */
/* 4. 模块级引导开关：同一页面加载只自动开一次（工作区来回切换不重开）    */
/* ------------------------------------------------------------------ */

let tourBooted = false

/** 引导自动开：与 DirectorApp 一致 —— 进入 1100ms 后，未看过就播一段 */
const TOUR_DELAY_MS = 1100

/**
 * `?tour` 在 chunk **首次加载时**锁定一次：切到经典工作区会把 URL 规范成 `/`（丢掉查询参数），
 * 再切回来时若重新读 URL，`?tour=0`（截图 / 回归）会退化成「默认自动开引导」。锁定后语义稳定。
 */
const INITIAL_TOUR = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('tour')

/* ------------------------------------------------------------------ */
/* 5. 容器                                                            */
/* ------------------------------------------------------------------ */

export default function CommandCenter(): JSX.Element {
  const route = useRouteStore((s) => s.route)
  const setScreen = useDirectorStore((s) => s.setScreen)
  /** v1.2 M3：执行模式/结果角标（真执行 / Mock 执行 / 部分完成），数据来自 store.execution */
  const execution = useDirectorStore((s) => s.execution)

  /** 本容器刚从 store.screen 推向路由的视图：路由回流时跳过，避免回环（§3.2 幂等纪律） */
  const pushedViewRef = useRef<DirectorScreen | null>(null)

  /* ---------------- ① route → store：URL / 外壳导航 / 返回键是事实源 ---------------- */
  useEffect(() => {
    if (route.workspace !== 'director') return
    const view = route.directorView
    const current = useDirectorStore.getState().screen
    /* Navigator 契约里 RouteState 不携带 source，无法按「user 来源」判定；改用幂等比较：
       两侧已一致（含本容器刚推出去的回流）就什么都不写，回环在第一次比较即被切断。 */
    if (view === current) {
      pushedViewRef.current = null
      return
    }
    if (pushedViewRef.current === view) {
      /* 这一步路由是 ② 刚从 store.screen 推出去的：不回写 store（否则会覆盖用户后续动作） */
      pushedViewRef.current = null
      return
    }
    setScreen(view)
  }, [route.workspace, route.directorView, setScreen])

  /* ---------------- ② store → route：屏内动作推动 URL（openMission / 返回 / 引导切屏） ---------------- */
  useEffect(() => {
    const unsubscribe = useDirectorStore.subscribe((state, prev) => {
      if (state.screen === prev.screen) return
      /* 只在总指挥工作区推动导航：经典工作区下的屏幕变化不污染 URL（工作区由外壳决定） */
      const currentRoute = useRouteStore.getState().route
      if (currentRoute.workspace !== 'director') return
      if (currentRoute.directorView === state.screen) return
      pushedViewRef.current = state.screen
      navigateTo({ kind: state.screen })
    })
    return unsubscribe
  }, [])

  /* ---------------- ③ 一句话委托：挂载补取槽 + 事件即时消费（消费式去重） ---------------- */
  useEffect(() => {
    const runPendingIntent = (): void => {
      try {
        const pending = consumePendingIntent()
        if (!pending) return
        /* planMission 是异步的：拆解完成后 store 自己会把 screen 切到 mission（再经 ② 同步 URL）；
           这里先导航一次给即时反馈，拆解失败也停在作战室（旧整屏同语义）。 */
        void useDirectorStore
          .getState()
          .planMission(pending.intent)
          .catch((error: unknown) => {
            console.error('[CommandCenter] 一句话委托拆解失败:', error)
          })
        navigateTo({ kind: 'mission' })
      } catch (error) {
        /* 委托失败绝不阻塞渲染：记录后继续（用户可重试或手动开任务） */
        console.error('[CommandCenter] 一句话委托处理异常:', error)
      }
    }
    runPendingIntent()
    return studioBus.on('intent.submitted', runPendingIntent)
  }, [])

  /* ④ 交付物发布桥（M2）：mission done → artifactStore；卸载时清理。
     v1.2 M3：真执行模式下模板件由 runner 产物替代（includeTemplates=false），
     Mock 模式仍沿用模板交付物（M2 行为，验收可导出）。 */
  useEffect(() => {
    let stop: (() => void) | undefined
    try {
      const mode = resolveExecutionMode().mode
      stop = installMissionDeliverablesBridge({ includeTemplates: mode !== 'real' })
    } catch (error) {
      console.error('[CommandCenter] 交付物发布桥安装失败:', error)
    }
    return () => {
      try {
        stop?.()
      } catch (error) {
        console.error('[CommandCenter] 交付物发布桥卸载失败:', error)
      }
    }
  }, [])

  /* ④b 执行控制器（M3）：确认计划后由 MissionRunner 驱动真执行 / Mock runner；
     刷新恢复时把丢失 runner 的 running/waiting 降级为 paused，等用户「继续」续跑。 */
  useEffect(() => {
    let stop: (() => void) | undefined
    try {
      stop = installMissionExecution()
    } catch (error) {
      console.error('[CommandCenter] 执行控制器安装失败:', error)
    }
    return () => {
      try {
        stop?.()
      } catch (error) {
        console.error('[CommandCenter] 执行控制器卸载失败:', error)
      }
    }
  }, [])

  /* ---------------- ⑤ mission/gate → studioBus 投影（M2 收件箱 / 只读投影依赖） ---------------- */
  useEffect(() => {
    /* 挂载即对齐一次：刷新 / 切回工作区后，仍在等待的审批门要重新进入收件箱（历史事件不回放） */
    projectDirectorState(null)
    return useDirectorStore.subscribe((state, prev) => {
      /* 只关心 mission 变化：toast / screen / autonomy 等瞬态不触发投影 */
      if (state.mission === prev.mission) return
      projectDirectorState(prev)
    })
  }, [])

  /* ---------------- ⑥ 轻提示 → 统一 toast 层（本文件不再自绘 command-toasts） ---------------- */
  useEffect(() => {
    /* 挂载时把存量提示标记为已转发：只转发挂载后的新提示（切工作区回来不重放） */
    useDirectorStore.getState().toasts.forEach((item) => forwardedToastIds.add(item.id))
    forwardDirectorToasts()
    return useDirectorStore.subscribe((state, prev) => {
      if (state.toasts === prev.toasts) return
      forwardDirectorToasts()
    })
  }, [])

  /* ---------------- ⑦ 引导：?tour=0 关 / ?tour=1 强制 / 否则首次自动 ---------------- */
  useEffect(() => {
    if (tourBooted) return
    if (INITIAL_TOUR === '0') return
    const force = INITIAL_TOUR === '1'
    const timer = window.setTimeout(() => {
      tourBooted = true
      if (force || !hasSeenDirectorGuide()) useDirectorStore.getState().startGuide(force)
    }, TOUR_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [])

  /* ---------------- ⑧ ?mission=exam_loop 演示兜底：只种一次并摘掉参数 ---------------- */
  const missionBootRef = useRef(false)
  useEffect(() => {
    if (missionBootRef.current) return
    missionBootRef.current = true
    const url = new URL(window.location.href)
    if (url.searchParams.get('mission') !== 'exam_loop') return
    try {
      /* 与 DirectorApp 一致：只种计划、不跳屏；种完立刻 replaceState 摘参数，
         否则刷新会再次 startMission 覆盖持久化恢复出来的 paused / 进度。 */
      useDirectorStore.getState().startMission('exam_loop')
      url.searchParams.delete('mission')
      const search = url.searchParams.toString()
      window.history.replaceState(
        window.history.state,
        '',
        `${url.pathname}${search ? `?${search}` : ''}${url.hash}`,
      )
    } catch (error) {
      console.error('[CommandCenter] ?mission= 演示计划种入失败:', error)
    }
  }, [])

  return (
    <div data-testid="command-center" className="d-root relative flex h-full flex-col overflow-hidden">
      {/* 主内容：当前一级视图（SurfaceHost 内部 Suspense + 视图级懒加载） */}
      <main className="relative z-10 min-h-0 flex-1">
        <div key={route.directorView} className="d-fade h-full">
          <SurfaceHost
            surface={route.directorView}
            target={route.target}
            navigate={studioRouter.navigator}
            fallback={<CommandFallback />}
          />
        </div>
      </main>

      {/* 执行模式角标（M3 §4.6）：真执行 / Mock 执行 / 部分完成，永远可见，绝不假装真执行 */}
      {execution && (
        <div
          data-testid="command-execution-badge"
          aria-live="polite"
          className="pointer-events-none absolute right-4 top-3 z-20 flex items-center gap-1.5 rounded-full border border-line bg-surface/90 px-2.5 py-1 text-[0.6875rem] font-medium text-ink-soft shadow-soft backdrop-blur"
        >
          <span
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full ${execution.mode === 'real' ? 'bg-mint' : 'bg-amber'}`}
          />
          {execution.mode === 'real' ? '真执行' : 'Mock 执行'}
          {execution.outcome === 'partial'
            ? ' · 部分完成'
            : execution.outcome === 'failed'
              ? ' · 执行失败'
              : execution.outcome === 'cancelled'
                ? ' · 已取消'
                : ''}
        </div>
      )}

      {/* 引导条 / 交付物预览：复用旧组件，位置由组件自身 fixed 定位 */}
      <GuideBar />
      <ArtifactSheet />
    </div>
  )
}
