/**
 * Loom 空间任务台契约（v0.9.4 M1）
 *
 * 设计原则（见 doc/v0.9.4-01-loom-implementation.md 决策记录）：
 * - Loom 是现有任务系统（BriefingCard + ChatSession + ArtifactDoc）的**空间视图**，不是另一套任务系统；
 * - 节点只持有绑定 id（cardId / sessionId / artifactId），业务真相仍在各自 store；
 * - 边 = 依赖：`dependency` 边参与执行调度（父全 done 才可运行），`context` 边只补充上游信息不阻塞；
 * - 运行态字段（status）与坐标一起持久化，但刷新后 `running` 恢复为 `queued`。
 */
import type { RoleId } from '../types'

/** 章节：节点类型（手动可建的仅 agent / checkpoint / note / artifact，另见 v0.9.4-01 缺口修正 #2） */
export type LoomNodeType =
  | 'task'
  | 'agent'
  | 'tool'
  | 'artifact'
  | 'checkpoint'
  | 'note'

export type LoomNodeStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'waiting'
  | 'done'
  | 'error'

export interface LoomPosition {
  x: number
  y: number
}

export interface LoomNode {
  id: string
  type: LoomNodeType
  title: string
  description?: string
  position: LoomPosition
  status: LoomNodeStatus

  /** EDUStudio 原生对象绑定 */
  cardId?: string
  sessionId?: string
  artifactId?: string
  /** 绑定业务工具（Trace 投影出的 tool 节点；v0.9.4 不开放手动创建） */
  toolName?: string

  /** 人工模块：要它做什么（agent / note 用） */
  instruction?: string

  /** v0.9.4 M5：节点执行采集到的输出（会话末条 assistant 正文 + 工具结果摘要），供下游注入 */
  runOutput?: string

  createdAt: number
  updatedAt: number
}

export type LoomEdgeType = 'dependency' | 'context'

export interface LoomEdge {
  id: string
  from: string
  to: string
  type: LoomEdgeType
  label?: string
  createdAt: number
}

export interface LoomViewport {
  x: number
  y: number
  zoom: number
}

/** 结构快照（Undo / Redo 的单位；只记录结构，不含视口） */
export interface LoomSnapshot {
  nodes: LoomNode[]
  edges: LoomEdge[]
  removedCardIds: string[]
}

/** 画布：v0.9.4 每个角色一张（不按周组织，见 v0.9.4-01 缺口修正 #1） */
export interface LoomBoard {
  id: string
  role: RoleId
  title: string
  nodes: LoomNode[]
  edges: LoomEdge[]
  /** 用户显式「从画布移除」的 cardId：幂等建节点时跳过，防止节点复活 */
  removedCardIds: string[]
  viewport: LoomViewport
  /** 结构变更历史（随画布存储，最多 LOOM_HISTORY_MAX 步；不参与持久化结构版本迁移） */
  history?: { past: LoomSnapshot[]; future: LoomSnapshot[] }
  updatedAt: number
}

/** 持久化结构（key：edustudio:loom） */
export interface PersistedLoom {
  schemaVersion: number
  boards: LoomBoard[]
}

export const LOOM_SCHEMA_VERSION = 1

/** 节点输出（runner 采集上游结果用） */
export interface LoomNodeResult {
  nodeId: string
  title: string
  summary: string
  status: LoomNodeStatus
}

/** 运行器进度快照：给 UI 展示「运行中 / 第 N / M 步」用（纯内存态，不持久化） */
export interface LoomRunProgress {
  /** 本轮是否运行中 */
  running: boolean
  /** 本轮计划执行的节点总数 */
  total: number
  /** 已完成节点数 */
  done: number
  /** 失败节点数 */
  failed: number
}

/** 视口缩放范围（原方案 40% ~ 180%） */
export const LOOM_ZOOM_MIN = 0.4
export const LOOM_ZOOM_MAX = 1.8
export const LOOM_ZOOM_DEFAULT = 1

/** 节点卡片默认尺寸（画布坐标；横向布局层间距 ≥ WIDTH） */
export const LOOM_NODE_WIDTH = 220
export const LOOM_NODE_HEIGHT = 96

/** Undo / Redo 历史上限（原方案 max 30） */
export const LOOM_HISTORY_MAX = 30
