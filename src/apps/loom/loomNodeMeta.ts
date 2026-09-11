/**
 * Loom 节点类型元数据与状态视觉（v0.9.4 M2）
 *
 * 颜色语义直接继承 v0.9.3 AgentTrace：
 *   primary = 规划/任务、amber = 执行中、mint = 完成、coral = 待人工、surface-2 = 便签。
 */
import type { LoomNodeStatus, LoomNodeType } from '../../harness/loom/types'

export interface LoomTypeMeta {
  label: string
  icon: string
  hint: string
}

export const LOOM_TYPE_META: Record<LoomNodeType, LoomTypeMeta> = {
  task: { label: '任务', icon: '📌', hint: '简报采纳的任务' },
  agent: { label: 'AI 处理', icon: '✨', hint: '自定义一段 AI 工作' },
  tool: { label: '工具', icon: '🔧', hint: '业务工具执行' },
  artifact: { label: '文档', icon: '📄', hint: '关联产出' },
  checkpoint: { label: '人工确认', icon: '✋', hint: '需要人确认后继续' },
  note: { label: '便签', icon: '📝', hint: '自由记录' },
}

/** 可手动创建的类型（tool 仅由 Trace 投影产生，见实施参考缺口修正 #2） */
export const LOOM_CREATABLE_TYPES: LoomNodeType[] = ['agent', 'checkpoint', 'note', 'artifact']

export interface LoomStatusMeta {
  dot: string
  /** 边框 + 背景组合（节点卡） */
  card: string
  label: string
}

export const LOOM_STATUS_META: Record<LoomNodeStatus, LoomStatusMeta> = {
  idle: { dot: 'bg-line', card: 'border-line bg-surface', label: '待处理' },
  queued: { dot: 'bg-ink-mute', card: 'border-line bg-surface', label: '排队中' },
  running: { dot: 'bg-amber', card: 'border-amber/40 bg-amber-soft/60', label: 'AI 正在处理' },
  waiting: { dot: 'bg-coral', card: 'border-coral/30 bg-coral-soft/60', label: '需要你的确认' },
  done: { dot: 'bg-mint', card: 'border-mint/30 bg-mint-soft/40', label: '已完成' },
  error: { dot: 'bg-danger', card: 'border-danger/30 bg-danger/5', label: '执行失败' },
}
