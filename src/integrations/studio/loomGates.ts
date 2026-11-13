/**
 * v1.2 M3b · Loom checkpoint → 统一审批门桥（主 chunk，roadmap §4.4）
 *
 * 职责：把画布上的人工确认节点（type='checkpoint' 且 runner 置为 waiting）投影成统一的
 * `ApprovalGate`（source='loom'），注册到 `studio/gateRegistry` 的一次性出口，并让收件箱 /
 * 决策卡 / 角标看到同一件事（roadmap §3.4「审批门只有一个事件源」）。
 *
 * 纪律：
 * - 只有 `registerGateResolver` 成功（本桥拥有该门的 resolver）才 emit `gate.waiting`，
 *   且按 gateId 去重（重复安装 / 重复状态变化不重复发）；
 * - resolver 收到 continue/cancel → resumeCheckpoint（缺省动态 import，避免把 Loom runner
 *   拉进主 chunk 首屏；测试可注入替身）；
 * - 节点离开 waiting（done/idle）或从画布消失 → emit `gate.resolved` 并清理 resolver；
 * - 幂等安装：重复调用返回同一个清理函数；卸载时退订并释放本桥注册的 resolver；
 * - 不 import apps/director / director store（主 chunk 边界）。
 */
import type { LoomBoard, LoomNode } from '../../harness/loom/types'
import { useLoomStore } from '../../stores/loomStore'
import { studioBus } from '../../studio/bus'
import type { ApprovalGate } from '../../studio/contracts'
import { registerGateResolver, type GateAction } from '../../studio/gateRegistry'

export interface LoomGateBridgeOptions {
  /**
   * 注入用（测试 / 延迟加载）：缺省动态 import `harness/loom/runner` 调 `resumeCheckpoint`。
   * 主 chunk 不静态 import runner（LoomPanel 已 lazy，首屏预算 ≤120KB）。
   */
  resume?: (nodeId: string, action: GateAction) => void | Promise<void>
}

/** 统一 gateId 口径：`loom:<boardId>:<nodeId>`（mission 侧为 `<missionId>:<gate>`） */
export function loomGateId(boardId: string, nodeId: string): string {
  return `loom:${boardId}:${nodeId}`
}

/** checkpoint 节点 → 统一审批门（纯函数，供 LoomPanel 渲染统一卡与单测） */
export function loomApprovalGate(board: LoomBoard, node: LoomNode): ApprovalGate {
  return {
    gateId: loomGateId(board.id, node.id),
    taskId: node.id,
    source: 'loom',
    title: `${node.title}待确认`,
    requiredAction: 'continue',
    sensitive: false,
  }
}

/** 缺省 resume：动态加载 runner（主 chunk 不静态引入 Loom runner 实现） */
function defaultResume(nodeId: string, action: GateAction): void {
  void import('../../harness/loom/runner')
    .then((mod) => mod.resumeCheckpoint(nodeId, action))
    .catch((error) => console.error('[loomGates] 恢复 checkpoint 失败:', error))
}

interface TrackedGate {
  boardId: string
  nodeId: string
  dispose: () => void
}

/** 已安装的清理函数（重复 install 幂等：返回同一函数） */
let installedCleanup: (() => void) | null = null

/**
 * 安装 Loom checkpoint 审批门桥（幂等；返回清理函数）。
 * 安装时先对齐当前画布（刷新/切工作区回来后仍在等待的 checkpoint 补发 gate.waiting）。
 */
export function installLoomGateBridge(options: LoomGateBridgeOptions = {}): () => void {
  if (installedCleanup) return installedCleanup

  const resume = options.resume ?? defaultResume
  const tracked = new Map<string, TrackedGate>()
  let disposed = false

  const sync = (): void => {
    if (disposed) return
    const state = useLoomStore.getState()

    /* ① 已跟踪的门：节点离开 waiting（done/idle）或消失 → resolved + 释放 resolver */
    for (const [gateId, entry] of [...tracked]) {
      const board = state.boards.find((b) => b.id === entry.boardId)
      const node = board?.nodes.find((n) => n.id === entry.nodeId)
      const stillWaiting = node?.type === 'checkpoint' && node.status === 'waiting'
      if (stillWaiting) continue
      tracked.delete(gateId)
      entry.dispose()
      studioBus.emit({ type: 'gate.resolved', gateId, resolution: node?.status === 'idle' ? 'cancel' : 'continue' })
    }

    /* ② 当前画布上等待中的 checkpoint：注册一次性出口；注册成功才 emit（按 gateId 去重） */
    const board = state.activeBoard()
    if (!board) return
    for (const node of board.nodes) {
      if (node.type !== 'checkpoint' || node.status !== 'waiting') continue
      const gateId = loomGateId(board.id, node.id)
      if (tracked.has(gateId)) continue
      const registered = registerGateResolver(gateId, (action) => {
        void resume(node.id, action)
      })
      /* 已被其它 resolver 拥有（正常不会发生）：不抢 emit，避免同一门两处各点一次 */
      if (!registered.ok) continue
      tracked.set(gateId, { boardId: board.id, nodeId: node.id, dispose: registered.dispose })
      studioBus.emit({ type: 'gate.waiting', gate: loomApprovalGate(board, node) })
    }
  }

  /* 挂载即对齐（reload / 切回画布后仍在等待的 checkpoint 要重新进入收件箱） */
  sync()
  const unsubscribe = useLoomStore.subscribe(() => sync())

  const cleanup = (): void => {
    if (disposed) return
    disposed = true
    unsubscribe()
    tracked.forEach((entry) => entry.dispose())
    tracked.clear()
    if (installedCleanup === cleanup) installedCleanup = null
  }
  installedCleanup = cleanup
  return cleanup
}
