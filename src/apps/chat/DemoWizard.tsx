import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Loader2, Play, RotateCcw, X, Zap } from 'lucide-react'
import { useChatStore } from '../../stores/chatStore'
import { useSkillStore } from '../../stores/skillStore'
import type { AgentTraceEvent } from '../../harness/types'
import type { Skill } from '../../harness/skills/types'
import { cn } from '../../lib/cn'

interface Act {
  title: string
  narration: string
  input: string
  success: string
  /** 本幕达成判定：基于最后一条 assistant 轨迹 + 当前学习技能库 */
  check: (trace: AgentTraceEvent[], learned: Skill[]) => boolean
}

/**
 * 演示剧本（v0.6 M3③）：三幕走完自进化闭环。
 * 幕1/幕3 的输入经过触发词提取器验证：幕1 沉淀 v1（触发词：研学活动方案/行程/安全预案/预算表），
 * 幕2 含触发词直接命中；幕3 不含任何 v1 触发词（走通用探索）但提炼触发词「预算」与「预算表」重叠 → 合并进化 v2。
 */
const ACTS: Act[] = [
  {
    title: '第一幕 · 技能发现',
    narration:
      '技能库还没有覆盖这个任务。Agent 将走通用探索：拆解目标 → 调用工具收集信息 → 产出文档；完成后自动复盘，把执行经验沉淀为新技能。',
    input: '帮我整理一份研学活动方案，包含行程、安全预案和预算表',
    success: '新技能已沉淀（v1），可在侧栏「技能」查看',
    check: (trace, learned) => trace.some((e) => e.kind === 'skill_learned' && !e.evolved) && learned.length > 0,
  },
  {
    title: '第二幕 · 技能复用',
    narration:
      '同类任务再次出现。这次 Agent 直接命中刚沉淀的技能，按沉淀步骤执行，不再从零推理——这就是技能复用带来的效率提升。',
    input: '再做一份研学活动方案，下个月出发',
    success: '命中学习技能，按沉淀步骤直接完成',
    check: (trace) => trace.some((e) => e.kind === 'skill_hit' && e.origin === 'learned'),
  },
  {
    title: '第三幕 · 技能进化',
    narration:
      '任务出现了新变化（游学计划、安全须知、预算）。技能未直接覆盖，Agent 再次探索，并把新经验合并进已有技能——版本 +1，触发词扩充。',
    input: '帮我把春秋两季的游学计划整理成模板，附安全须知和预算',
    success: '技能已进化（版本 +1），触发词已扩充',
    check: (trace, learned) => trace.some((e) => e.kind === 'skill_learned' && e.evolved) && learned.some((s) => s.version >= 2),
  },
]

/**
 * 一键演示向导：分幕引导（旁白 + 预填输入），支持一键自动播放与分步播放；
 * 幕1 首次启动前自动清空学习技能，保证演示可重复。
 */
export default function DemoWizard({ onClose }: { onClose: () => void }) {
  const streaming = useChatStore((s) => s.streaming)
  const [act, setAct] = useState(0)
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle')
  const [auto, setAuto] = useState(false)
  const autoRef = useRef(false)
  const startedRef = useRef(false)

  /** 执行指定幕：幕1 首次启动清空学习技能（可重复演示） */
  const runAct = useCallback((index: number) => {
    const st = useChatStore.getState()
    if (st.streaming) return
    if (index === 0 && !startedRef.current) {
      useSkillStore.getState().clearLearned()
      startedRef.current = true
    }
    setPhase('running')
    void st.sendMessage(ACTS[index].input)
  }, [])

  /** streaming 结束 → 判定本幕是否达成 → 自动播放时推进下一幕 */
  useEffect(() => {
    if (streaming || phase !== 'running') return
    const { sessions, activeId } = useChatStore.getState()
    const entries = sessions.find((s) => s.id === activeId)?.entries ?? []
    const entry = entries[entries.length - 1]
    const trace = entry?.trace ?? []
    const learned = useSkillStore.getState().learned
    if (ACTS[act].check(trace, learned)) {
      setPhase('done')
      if (autoRef.current && act < ACTS.length - 1) {
        const next = act + 1
        const t = window.setTimeout(() => {
          setAct(next)
          runAct(next)
        }, 1600)
        return () => window.clearTimeout(t)
      }
    } else {
      setPhase('idle')
    }
  }, [streaming, phase, act, runAct])

  /** 主按钮：idle → 执行当前幕；done → 进入下一幕并执行 */
  const primary = () => {
    if (phase === 'done') {
      if (act < ACTS.length - 1) {
        const next = act + 1
        setAct(next)
        runAct(next)
      }
      return
    }
    runAct(act)
  }

  const reset = () => {
    setAct(0)
    setPhase('idle')
    setAuto(false)
    autoRef.current = false
    startedRef.current = false
    useSkillStore.getState().clearLearned()
  }

  const toggleAuto = () => {
    const next = !auto
    setAuto(next)
    autoRef.current = next
    if (next && phase === 'idle') runAct(act)
  }

  const current = ACTS[act]

  return (
    <div
      data-testid="demo-wizard"
      className="fixed bottom-36 left-1/2 z-40 w-[min(92vw,36rem)] -translate-x-1/2 animate-fade-up rounded-2xl border border-line bg-surface p-4 shadow-pop"
    >
      {/* 进度点 */}
      <div className="flex items-center gap-1.5">
        {ACTS.map((_, i) => (
          <span
            key={i}
            className={cn(
              'h-1.5 w-7 rounded-full transition-colors',
              i < act || (i === act && phase === 'done') ? 'bg-mint' : i === act ? 'bg-primary' : 'bg-line',
              i === act && phase === 'running' && 'animate-pulse',
            )}
          />
        ))}
        <span className="ml-auto text-[0.625rem] font-medium text-ink-mute">
          自进化演示 {act + 1}/{ACTS.length}
        </span>
        <button onClick={onClose} className="text-ink-mute transition-colors hover:text-ink" aria-label="关闭演示向导">
          <X size={14} />
        </button>
      </div>

      {/* 旁白 */}
      <p data-testid="demo-act-title" className="mt-2.5 text-sm font-bold">
        {current.title}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-ink-soft">{current.narration}</p>

      {/* 预填输入预览 */}
      <div className="mt-2.5 rounded-xl bg-surface-2 px-3 py-2 text-xs leading-relaxed text-ink-soft">
        <span className="text-ink-mute">将发送：</span>
        {current.input}
      </div>

      {/* 控制 */}
      <div className="mt-3 flex items-center gap-2">
        {phase === 'running' ? (
          <span className="flex items-center gap-1.5 text-xs text-ink-mute">
            <Loader2 size={13} className="animate-spin" /> Agent 执行中…
          </span>
        ) : (
          <>
            {phase === 'done' && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-mint">
                <CheckCircle2 size={13} /> {current.success}
              </span>
            )}
            <button
              data-testid="demo-run"
              onClick={primary}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-medium text-white shadow-soft transition-all hover:bg-primary-deep active:scale-95"
            >
              <Play size={12} />
              {phase === 'done'
                ? act < ACTS.length - 1
                  ? '下一步'
                  : '完成演示'
                : act === 0
                  ? '开始演示'
                  : '下一步'}
            </button>
          </>
        )}
        <button
          data-testid="demo-auto"
          onClick={toggleAuto}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-colors',
            auto ? 'bg-amber-soft text-amber-600' : 'border border-line text-ink-soft hover:bg-surface-2',
          )}
        >
          <Zap size={12} /> {auto ? '停止自动' : '自动播放'}
        </button>
        <button
          data-testid="demo-reset"
          onClick={reset}
          className="ml-auto inline-flex items-center gap-1 text-xs text-ink-mute transition-colors hover:text-ink"
        >
          <RotateCcw size={12} /> 重置演示
        </button>
      </div>
    </div>
  )
}
