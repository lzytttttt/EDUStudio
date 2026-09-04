import { useState } from 'react'
import { ClipboardList, Wrench, ChevronDown, BrainCircuit, CheckCircle2 } from 'lucide-react'
import type { AgentTraceEvent } from '../../harness/types'
import { toolRegistry } from '../../harness/agent'
import { cn } from '../../lib/cn'

function JsonPeek({ payload }: { payload: unknown }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="minor-info mt-1.5">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 text-[10px] font-medium text-mint hover:underline"
      >
        查看返回数据
        <ChevronDown size={11} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <pre className="mt-1.5 max-h-44 overflow-auto rounded-lg bg-ink/90 p-2.5 font-mono text-[10px] leading-relaxed text-mint-soft">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </div>
  )
}

/** Agent 执行轨迹：Plan(蓝) → Tool Call(黄) → Result(绿,可展开) → Reflect(纸感)
 *  根容器挂 .agent-trace：超大字号档下内部文字跟随放大（见 index.css） */
export default function AgentTraceView({ trace, streaming }: { trace: AgentTraceEvent[]; streaming: boolean }) {
  if (trace.length === 0) return null
  return (
    <div className="agent-trace mb-2 space-y-1.5">
      {trace.map((e, i) => {
        const isLast = i === trace.length - 1
        if (e.kind === 'plan') {
          return (
            <div key={i} className="animate-fade-up rounded-2xl border border-primary/20 bg-primary-soft px-4 py-3">
              <p className="flex items-center gap-1.5 text-[11px] font-bold text-primary">
                <ClipboardList size={12} />
                执行计划
              </p>
              <ol className="mt-1.5 space-y-1">
                {e.steps.map((s, j) => (
                  <li key={j} className="flex items-start gap-2 text-xs text-ink-soft">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-white">
                      {j + 1}
                    </span>
                    {s}
                  </li>
                ))}
              </ol>
            </div>
          )
        }
        if (e.kind === 'tool_call') {
          const label = toolRegistry.get(e.tool)?.label ?? e.tool
          return (
            <div key={i} className="animate-fade-up flex items-center gap-2.5 rounded-2xl border border-amber/30 bg-amber-soft px-4 py-2.5">
              <Wrench size={13} className="shrink-0 text-amber" />
              <p className="text-xs text-ink-soft">
                调用工具 <span className="font-semibold text-ink">{label}</span>
                {streaming && isLast && <span className="ml-1.5 inline-block h-3 w-1.5 animate-pulse rounded-sm bg-amber align-middle" />}
              </p>
            </div>
          )
        }
        if (e.kind === 'tool_result') {
          const label = toolRegistry.get(e.tool)?.label ?? e.tool
          return (
            <div key={i} className="animate-fade-up rounded-2xl border border-mint/25 bg-mint-soft px-4 py-2.5">
              <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-soft">
                <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-mint" />
                <span>
                  <span className="font-semibold text-ink">{label}</span> · {e.summary}
                </span>
              </p>
              {e.payload !== undefined && <JsonPeek payload={e.payload} />}
            </div>
          )
        }
        if (e.kind === 'reflect') {
          return (
            <div key={i} className="animate-fade-up flex items-start gap-2.5 rounded-2xl border border-line bg-surface-2 px-4 py-2.5">
              <BrainCircuit size={13} className="mt-0.5 shrink-0 text-ink-mute" />
              <p className="text-xs leading-relaxed text-ink-soft">{e.text}</p>
            </div>
          )
        }
        return null
      })}
    </div>
  )
}
