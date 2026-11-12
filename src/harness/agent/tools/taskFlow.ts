/**
 * 任务链工具实现（v0.9.5 P1-A）
 *
 * 与 tools/index.ts 里的 ToolDef 元信息分离：元信息（名称/参数 schema/display 文案）
 * 必须同步可读，供 function-calling 组装与执行轨迹展示；run 体只在真正被调用时才跑，
 * 故动态 import 出去，不占首屏主 chunk 的 120KB 预算。
 */
import type { RoleId, ToolResult } from '../../types'
import { CLASSES, SCHOOLS } from '../../../data/seed'
import { useAuthStore } from '../../../stores/authStore'
import { useTaskFlowStore, flowsForRole } from '../../../stores/taskFlowStore'

/** 任务进度查询：当前角色的任务链与回执完成度 */
export async function runListTaskFlows(): Promise<ToolResult> {
  const role = useAuthStore.getState().role ?? 'schoolAdmin'
  const visible = flowsForRole(useTaskFlowStore.getState().flows, role)
  if (visible.length === 0) return { summary: '当前没有下发出去的任务链', payload: { flows: [] } }
  const lines = visible.map((f) => {
    const done = f.receipts.filter((r) => r.status !== 'pending')
    const waiting = f.receipts.filter((r) => r.status === 'pending').map((r) => r.target)
    return `「${f.title}」回执 ${done.length}/${f.receipts.length}${waiting.length ? `，待回执：${waiting.join('、')}` : '，已全部回执'}`
  })
  return { summary: lines.join('；'), payload: { flows: visible } }
}

/** 接收方候选：局→全部学校；校→本校班主任去重 */
function dispatchTargets(role: RoleId): { name: string; role: 'schoolAdmin' | 'teacher' }[] {
  if (role === 'bureau') return SCHOOLS.map((s) => ({ name: s.name, role: 'schoolAdmin' as const }))
  return [...new Set(CLASSES.map((c) => c.headTeacher))].map((name) => ({ name, role: 'teacher' as const }))
}

/** 下发任务链：起草并下发，回执状态随任务链一起跟踪 */
export async function runDispatchTaskFlow(args: Record<string, unknown>): Promise<ToolResult> {
  const title = String(args.title ?? '').trim()
  if (!title) return { summary: '下发失败：缺少任务标题', payload: null }

  const pool = dispatchTargets(useAuthStore.getState().role ?? 'schoolAdmin')
  const raw = String(args.targets ?? '').trim()
  const want = raw ? raw.split(/[、,，]/).map((t) => t.trim()).filter(Boolean) : []
  const targets = want.length ? pool.filter((t) => want.some((w) => t.name.includes(w) || w.includes(t.name))) : pool
  if (targets.length === 0) {
    return { summary: `未找到接收方「${raw}」，可选：${pool.map((t) => t.name).join('、')}`, payload: null }
  }

  const deadline = String(args.deadline ?? '').trim()
  useTaskFlowStore.getState().issue({ title, content: String(args.content ?? '').trim(), deadline, targets })
  const tail = useTaskFlowStore.getState().syncState === 'degraded' ? '；同步服务未连接，已记录到本地' : ''
  return {
    summary: `已下发「${title}」至 ${targets.length} 个接收方（${targets.map((t) => t.name).join('、')}），截止 ${deadline || '尽快完成'}${tail}`,
    payload: { title, targets },
  }
}
