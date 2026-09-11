/**
 * Loom Trace 投影（v0.9.4 M6）
 *
 * 把 ChatEntry 上的扁平 `AgentTraceEvent[]` 投影成一张**只读子图**，供双击任务节点时展开：
 *   plan            → 步骤项（每个 step 一项）
 *   tool_call       → tool 项（running），与 tool_result 按 id 配对
 *   tool_result     → 配对项置 done（无配对时退化为 result 项）
 *   artifact_meta   → artifact 项（running，正在生成）
 *   artifact_chunk  → 已有 artifact 项置 done（不重复成项）
 *   artifact_done   → artifact 项置 done（补齐 / 更新标题）
 *   reflect         → 说明项
 *
 * 纯函数：不落盘、不读写 store、无副作用；仅按 trace 顺序生成稳定 id，便于 React key 与单测。
 * 标签仅做展示，不参与执行语义（执行真相仍在 runner / chatStore）。
 */
import type { ChatEntry } from '../../stores/chatStore'
import { toolRegistry } from '../../harness/agent/ToolRegistry'

export type LoomTraceKind = 'plan' | 'tool' | 'result' | 'artifact' | 'reflect'
export type LoomTraceStatus = 'running' | 'done' | 'error'

export interface LoomTraceItem {
  id: string
  kind: LoomTraceKind
  label: string
  status: LoomTraceStatus
}

/** 子图一次最多展示的项数（超出由 UI 折叠为「+N 步」） */
export const LOOM_TRACE_MAX_ITEMS = 6

export function projectTrace(entry: ChatEntry): LoomTraceItem[] {
  const items: LoomTraceItem[] = []
  /** tool_call.id → 投影项下标（tool_result 按 id 配对用） */
  const toolIdx = new Map<string, number>()
  /** artifactId → 投影项下标（meta / chunk / done 归并到同一文档节点） */
  const artifactIdx = new Map<string, number>()
  let planSeq = 0

  entry.trace.forEach((e, i) => {
    switch (e.kind) {
      case 'plan': {
        e.steps.forEach((step, j) => {
          items.push({ id: `plan:${planSeq}:${j}`, kind: 'plan', label: step, status: 'done' })
        })
        planSeq += 1
        break
      }
      case 'tool_call': {
        toolIdx.set(e.id, items.length)
        items.push({ id: `tool:${e.id}`, kind: 'tool', label: toolLabel(e.tool, e.args), status: 'running' })
        break
      }
      case 'tool_result': {
        const idx = toolIdx.get(e.id)
        if (idx === undefined) {
          /* 无配对的孤立结果：退化为 result 项，避免信息丢失 */
          items.push({ id: `result:${e.id}`, kind: 'result', label: e.summary || e.tool, status: 'done' })
        } else {
          items[idx] = { ...items[idx], label: e.summary || items[idx].label, status: 'done' }
        }
        break
      }
      case 'artifact_meta': {
        if (!artifactIdx.has(e.artifactId)) {
          artifactIdx.set(e.artifactId, items.length)
          items.push({ id: `artifact:${e.artifactId}`, kind: 'artifact', label: e.title, status: 'running' })
        }
        break
      }
      case 'artifact_chunk': {
        /* 只更新状态、不重复成项；已产出内容即视为「已生成」 */
        const idx = artifactIdx.get(e.artifactId)
        if (idx !== undefined) items[idx] = { ...items[idx], status: 'done' }
        break
      }
      case 'artifact_done': {
        const idx = artifactIdx.get(e.artifactId)
        if (idx === undefined) {
          artifactIdx.set(e.artifactId, items.length)
          items.push({ id: `artifact:${e.artifactId}`, kind: 'artifact', label: e.title, status: 'done' })
        } else {
          items[idx] = { ...items[idx], label: e.title || items[idx].label, status: 'done' }
        }
        break
      }
      case 'reflect': {
        items.push({ id: `reflect:${i}`, kind: 'reflect', label: e.text, status: 'done' })
        break
      }
      default:
        /* text / done / skill_hit / skill_learned 不进入子图（技能徽标在对话区展示） */
        break
    }
  })

  /* 失败收口：仍在 running 的项标 error；无 running 项时末项标 error（保留失败可见性） */
  if (entry.error) {
    const hasRunning = items.some((it) => it.status === 'running')
    if (hasRunning) {
      for (let k = 0; k < items.length; k += 1) {
        if (items[k].status === 'running') items[k] = { ...items[k], status: 'error' }
      }
    } else if (items.length > 0) {
      const last = items.length - 1
      items[last] = { ...items[last], status: 'error' }
    }
  }

  return items
}

/** 工具展示名：业务文案（display）优先，其次 label，最后回退工具名；未知工具安全回退 */
function toolLabel(tool: string, args: Record<string, unknown>): string {
  try {
    const def = toolRegistry.get(tool)
    return def?.display?.(args) ?? def?.label ?? tool
  } catch {
    return tool
  }
}
