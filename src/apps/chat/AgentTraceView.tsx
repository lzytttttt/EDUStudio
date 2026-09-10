import { memo, useState } from 'react'
import { ClipboardList, Wrench, ChevronDown, BrainCircuit, CheckCircle2, Sparkles, GraduationCap } from 'lucide-react'
import type { AgentTraceEvent } from '../../harness/types'
import { toolRegistry } from '../../harness/agent'
import { useSettingsStore } from '../../stores/settingsStore'
import { cn } from '../../lib/cn'

function JsonPeek({ payload }: { payload: unknown }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="minor-info mt-1.5">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 text-[0.625rem] font-medium text-mint hover:underline"
      >
        查看返回数据
        <ChevronDown size={11} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <pre className="mt-1.5 max-h-44 overflow-auto rounded-lg bg-ink/90 p-2.5 font-mono text-[0.625rem] leading-relaxed text-mint-soft">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </div>
  )
}

/** Agent 执行轨迹：Plan(蓝) → Tool Call(黄) → Result(绿,可展开) → Reflect(纸感)
 *  根容器挂 .agent-trace：超大字号档下内部文字跟随放大（见 index.css）
 *  memo（v0.9.3 P0-D③）：正文流式期间 trace 数组引用不变，跳过轨迹区重渲染 */
const AgentTraceView = memo(function AgentTraceView({ trace, streaming }: { trace: AgentTraceEvent[]; streaming: boolean }) {
  /* v0.9.2 P0-A：业务化轨迹——默认隐藏 JSON 返回数据入口，设置「显示技术细节」开启后才可见 */
  const showTechDetails = useSettingsStore((s) => s.showTechDetails)
  if (trace.length === 0) return null
  return (
    <div className="agent-trace mb-2 space-y-1.5">
      {trace.map((e, i) => {
        const isLast = i === trace.length - 1
        if (e.kind === 'plan') {
          return (
            <div key={i} className="animate-fade-up rounded-2xl border border-primary/20 bg-primary-soft px-4 py-3">
              <p className="flex items-center gap-1.5 text-[0.6875rem] font-bold text-primary">
                <ClipboardList size={12} />
                执行计划
              </p>
              <ol className="mt-1.5 space-y-1">
                {e.steps.map((s, j) => (
                  <li key={j} className="flex items-start gap-2 text-xs text-ink-soft">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary text-[0.5625rem] font-bold text-white">
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
          /* 业务化文案（v0.9.2 P0-A）：display(args) 优先，缺省回退工具 label */
          const def = toolRegistry.get(e.tool)
          const copy = def?.display?.(e.args) ?? def?.label ?? e.tool
          return (
            <div key={i} className="animate-fade-up flex items-center gap-2.5 rounded-2xl border border-amber/30 bg-amber-soft px-4 py-2.5">
              <Wrench size={13} className="shrink-0 text-amber" />
              <p className="text-xs text-ink-soft">
                <span className="font-semibold text-ink">{copy}</span>
                {e.group && (
                  <span className="ml-1.5 rounded-md bg-amber/15 px-1.5 py-0.5 text-[0.5625rem] font-semibold text-amber-600">并行组</span>
                )}
                {streaming && isLast && <span className="ml-1.5 inline-block h-3 w-1.5 animate-pulse rounded-sm bg-amber align-middle" />}
              </p>
            </div>
          )
        }
        if (e.kind === 'tool_result') {
          /* 结果行只讲业务结果（summary 已业务化），不再前置工具名（v0.9.2 P0-A） */
          return (
            <div key={i} className="animate-fade-up rounded-2xl border border-mint/25 bg-mint-soft px-4 py-2.5">
              <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-soft">
                <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-mint" />
                <span>
                  {e.summary}
                  {e.group && (
                    <span className="ml-1.5 rounded-md bg-mint/15 px-1.5 py-0.5 text-[0.5625rem] font-semibold text-mint">并行组</span>
                  )}
                </span>
              </p>
              {/* JSON 返回数据入口默认隐藏，仅「显示技术细节」开启时可见 */}
              {showTechDetails && e.payload !== undefined && <JsonPeek payload={e.payload} />}
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
        /* ---------- 自进化技能徽标（v0.6 M3②） ---------- */
        if (e.kind === 'skill_hit') {
          return (
            <div key={i} className="animate-fade-up flex items-center gap-2.5 rounded-2xl border border-primary/25 bg-primary-soft px-4 py-2.5">
              <Sparkles size={13} className="shrink-0 text-primary" />
              <p className="text-xs text-ink-soft">
                命中技能 <span className="font-semibold text-primary">{e.name}</span>
                <span className="ml-1.5 rounded-md bg-primary/15 px-1.5 py-0.5 text-[0.5625rem] font-bold text-primary">v{e.version}</span>
                <span className={cn('ml-1.5 rounded-md px-1.5 py-0.5 text-[0.5625rem] font-medium', e.origin === 'learned' ? 'bg-mint-soft text-mint' : 'border border-line text-ink-mute')}>
                  {e.origin === 'learned' ? '学习沉淀' : '内置'}
                </span>
              </p>
            </div>
          )
        }
        if (e.kind === 'skill_learned') {
          return (
            <div key={i} className="animate-fade-up flex items-center gap-2.5 rounded-2xl border border-mint/30 bg-mint-soft px-4 py-2.5">
              <GraduationCap size={13} className="shrink-0 text-mint" />
              <p className="text-xs text-ink-soft">
                {e.evolved ? (
                  <>
                    技能已进化 <span className="font-semibold text-mint">{e.name}</span>
                    <span className="ml-1.5 rounded-md bg-mint/15 px-1.5 py-0.5 text-[0.5625rem] font-bold text-mint">v{e.version}</span>
                  </>
                ) : (
                  <>
                    已沉淀新技能 <span className="font-semibold text-mint">{e.name}</span>
                    <span className="ml-1.5 rounded-md bg-mint/15 px-1.5 py-0.5 text-[0.5625rem] font-bold text-mint">v{e.version}</span>
                  </>
                )}
                <span className="ml-1.5 text-[0.625rem] text-ink-mute">可在侧栏「技能」中查看</span>
              </p>
            </div>
          )
        }
        return null
      })}
    </div>
  )
})

export default AgentTraceView
