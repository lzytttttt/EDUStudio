/**
 * LoomRunner —— Loom → Agent 真执行（v0.9.4 M5，本版核心）
 *
 * 决策与约束（见 doc/v0.9.4-01-loom-implementation.md 决策 1/2、roadmap 第十/十二节）：
 * - 执行节点走 chatStore.sendMessage（不直调 runTask）：复用全局单飞、Trace、artifact、持久化；
 * - 单飞互斥：sendMessage 返回 null（用户正在手动执行）→ 节点回 queued，本轮退出避免忙等；
 * - 串行拓扑执行：不做真并发，按拓扑序逐个执行「父全 done」的就绪节点；
 * - 上游注入：dependency / context 边上游节点的 runOutput 组装为 LoomUpstreamRef 注入 context；
 * - checkpoint（人工确认）节点：置 waiting 并暂停本轮，等待 resumeCheckpoint；
 * - 批次结束（含中断）：flushLoomPersist() 落盘，并恢复执行前的 activeId（不抢用户视图）。
 */
import type { AgentTraceEvent, LoomUpstreamRef, RoleId } from '../types'
import type { LoomNode } from './types'
import {
  collectUpstreamResults,
  readyNodes,
  topologicalSort,
  validateGraph,
  type Graph,
} from '../../lib/loomGraph'
import { flushLoomPersist, useLoomStore } from '../../stores/loomStore'
import { useChatStore, type ChatEntry } from '../../stores/chatStore'
import { useAuthStore } from '../../stores/authStore'

/** 节点输出正文截断长度（字符，约 1200） */
export const LOOM_OUTPUT_CHARS = 1200
/** tool_result 摘要收录上限（条） */
export const LOOM_MAX_TOOL_SUMMARIES = 6

/** 本轮是否正在执行（模块级单飞标志，避免并发 runLoom） */
let running = false
/** 用户请求停止本轮：不 abort 会话，当前节点执行完即退出 */
let stopRequested = false

/** 本轮是否运行中（UI 可据此禁用「开始处理」） */
export function isLoomRunning(): boolean {
  return running
}

/** 停止本轮执行：置停止标志，等待当前 await 自然返回后退出；不影响用户手动会话 */
export function stopLoom(): void {
  stopRequested = true
}

/** 节点目标：AI 模块取 instruction（缺省回退 title），其余取 title */
function goalFor(node: LoomNode): string {
  if (node.type === 'agent') return node.instruction?.trim() || node.title
  return node.title
}

/** 组装上游结果引用（只取已产出 done/error 的上游，附带节点采集到的 runOutput） */
function buildUpstream(graph: Graph, node: LoomNode): LoomUpstreamRef[] {
  return collectUpstreamResults(graph, node.id).map((r) => {
    const upstreamNode = graph.nodes.find((n) => n.id === r.nodeId)
    return { nodeId: r.nodeId, title: r.title, output: upstreamNode?.runOutput ?? '' }
  })
}

/** 结果采集：末条 assistant 正文（截断 ~1200 字符）+ trace 中 tool_result.summary（最多 6 条） */
export function captureOutput(entry: ChatEntry): string {
  const content = (entry.content ?? '').slice(0, LOOM_OUTPUT_CHARS)
  const summaries = entry.trace
    .filter((e): e is Extract<AgentTraceEvent, { kind: 'tool_result' }> => e.kind === 'tool_result')
    .map((e) => e.summary)
    .filter((s) => !!s)
    .slice(0, LOOM_MAX_TOOL_SUMMARIES)
  if (summaries.length === 0) return content
  return `${content}${content ? '\n\n' : ''}工具结果：\n${summaries.map((s) => `- ${s}`).join('\n')}`
}

/** 按条目 id 定位所属会话（sendMessage 可能在新会话落点） */
function findEntry(entryId: string): { sessionId: string; entry: ChatEntry } | null {
  for (const s of useChatStore.getState().sessions) {
    const entry = s.entries.find((e) => e.id === entryId)
    if (entry) return { sessionId: s.id, entry }
  }
  return null
}

/**
 * 确保节点有独立任务会话（一节点一会话）：
 * 已有 sessionId 直接复用；否则按 cardId 复用卡片会话，或新建专属会话（后台建会话不抢视图）。
 */
function ensureNodeSession(node: LoomNode, role: RoleId | null, prevActive: string | null): string | null {
  if (node.sessionId) return node.sessionId
  if (!role) return null
  const chat = useChatStore.getState()
  const id = node.cardId
    ? chat.ensureCardSession(role, node.cardId, node.title, { focus: false })
    : chat.newSession(role, node.title)
  useLoomStore.getState().updateNode(node.id, { sessionId: id })
  /* 后台建会话不抢用户当前视图 */
  if (useChatStore.getState().activeId !== prevActive) useChatStore.setState({ activeId: prevActive })
  return id
}

/** 更新运行进度计数 */
function bumpProgress(success: boolean): void {
  const rp = useLoomStore.getState().runProgress
  useLoomStore.getState().setRunProgress({
    done: rp.done + (success ? 1 : 0),
    failed: rp.failed + (success ? 0 : 1),
  })
}

/** 回写单个节点的执行结果：done + runOutput / error */
function recordNodeResult(nodeId: string, entry: ChatEntry | undefined): void {
  const failed = !entry || entry.error != null
  if (failed) {
    useLoomStore.getState().setNodeStatus(nodeId, 'error')
    bumpProgress(false)
    return
  }
  useLoomStore.getState().setNodeRunOutput(nodeId, captureOutput(entry))
  useLoomStore.getState().setNodeStatus(nodeId, 'done')
  bumpProgress(true)
}

/**
 * 开始处理当前画布：校验 → 标记本轮 queued → 按拓扑序串行执行可运行节点 →
 * 全部完成 / 卡住（父未完成、checkpoint 暂停、单飞占用、用户停止）时结束。
 */
export async function runLoom(): Promise<void> {
  if (running) return
  const board0 = useLoomStore.getState().activeBoard()
  if (!board0) return
  if (!validateGraph({ nodes: board0.nodes, edges: board0.edges }).ok) return

  /* 本轮计划：尚未完成、也不处于人工确认等待的节点 */
  const planIds = board0.nodes
    .filter((n) => n.status !== 'done' && n.status !== 'waiting')
    .map((n) => n.id)
  if (planIds.length === 0) return

  running = true
  stopRequested = false
  const prevActive = useChatStore.getState().activeId
  const role = useAuthStore.getState().role

  /* 批量置 queued 并初始化本轮进度 */
  useLoomStore.getState().beginRun(planIds)
  /* 本轮已处理节点（done / error / waiting）：readyNodes 不排除 error， 需要自行去重避免重复执行 */
  const processed = new Set<string>()

  try {
    for (;;) {
      if (stopRequested) break
      const board = useLoomStore.getState().activeBoard()
      if (!board) break

      const graph: Graph = { nodes: board.nodes, edges: board.edges }
      const ready = new Set(readyNodes(graph).map((n) => n.id))
      /* 拓扑序中第一个「就绪且本轮未处理」节点：父全 done 才就绪，天然串行 */
      const node = topologicalSort(graph)
        .map((id) => board.nodes.find((n) => n.id === id))
        .find((n): n is LoomNode => !!n && ready.has(n.id) && !processed.has(n.id))
      if (!node) break
      processed.add(node.id)

      /* checkpoint（人工确认）：置 waiting 并暂停本轮，不执行、不继续下游 */
      if (node.type === 'checkpoint') {
        useLoomStore.getState().setNodeStatus(node.id, 'waiting')
        break
      }
      if (stopRequested) break

      useLoomStore.getState().setNodeStatus(node.id, 'running')
      const sessionId = ensureNodeSession(node, role, prevActive)
      const upstream = buildUpstream(graph, node)
      const goal = goalFor(node)

      const entryId = await useChatStore.getState().sendMessage(goal, {
        ...(sessionId ? { sessionId } : {}),
        cardId: node.cardId,
        title: node.title,
        context: { loomNodeId: node.id, upstream },
      })

      if (entryId === null) {
        /* 单飞被占用（用户正在手动执行）：节点回 queued，本轮停止避免忙等 */
        useLoomStore.getState().setNodeStatus(node.id, 'queued')
        break
      }

      const found = findEntry(entryId)
      if (found && found.sessionId !== node.sessionId) {
        useLoomStore.getState().updateNode(node.id, { sessionId: found.sessionId })
      }
      recordNodeResult(node.id, found?.entry)
    }
  } finally {
    running = false
    stopRequested = false
    /* 收尾：落盘 + 恢复执行前视图 */
    flushLoomPersist()
    if (useChatStore.getState().activeId !== prevActive) useChatStore.setState({ activeId: prevActive })
    useLoomStore.getState().endRun()
  }
}

/**
 * 人工确认节点续跑 / 取消：
 * - continue：节点置 done → 继续执行下游（再次 runLoom）；
 * - cancel：节点置 idle（本轮不继续）。
 */
export async function resumeCheckpoint(nodeId: string, mode: 'continue' | 'cancel'): Promise<void> {
  if (mode === 'cancel') {
    useLoomStore.getState().setNodeStatus(nodeId, 'idle')
    flushLoomPersist()
    return
  }
  useLoomStore.getState().setNodeStatus(nodeId, 'done')
  await runLoom()
}
