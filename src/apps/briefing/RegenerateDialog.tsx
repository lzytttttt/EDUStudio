import { useEffect, useState } from 'react'
import { ChevronDown, Minus, Plus, Wand2, X } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useBriefingStore } from '../../stores/briefingStore'
import { GEN_ATTEMPTS, GEN_COUNT, GEN_PROMPT_MAX_LEN, GEN_TIMEOUT } from '../../harness/briefing/ApiBriefingProvider'
import type { BriefingGenOptions, BriefingStyle, CardType, RoleId } from '../../harness/types'
import { cn } from '../../lib/cn'

/** 六类卡片种类（v0.8.4）：与 README「洞察 / 决策 / 创作 / 待办 / 数据 / 提问」对齐 */
const TYPE_META: { type: CardType; label: string }[] = [
  { type: 'insight', label: '洞察' },
  { type: 'decision', label: '决策' },
  { type: 'creation', label: '创作' },
  { type: 'todo', label: '待办' },
  { type: 'data', label: '数据' },
  { type: 'question', label: '提问' },
]

/** 参考资料首行按角色动态命名（v0.8.4）：与 buildDataContext 的角色分支对齐 */
const DATA_LABEL: Record<RoleId, string> = {
  teacher: '班级学情数据',
  schoolAdmin: '校情数据与预警',
  bureau: '区域指标数据',
}

const STYLE_META: { value: BriefingStyle | 'default'; label: string }[] = [
  { value: 'default', label: '默认' },
  { value: 'concise', label: '简洁扼要' },
  { value: 'detailed', label: '详细展开' },
  { value: 'data', label: '数据导向' },
]

const PAYLOAD_META = [
  { key: 'chart' as const, label: '图表卡' },
  { key: 'options' as const, label: '选项卡' },
  { key: 'todos' as const, label: '待办卡' },
]

const chipActive = 'border-primary/40 bg-primary-soft text-primary'
const chipIdle = 'border-line bg-surface text-ink-soft hover:border-primary/40 hover:text-primary'

/** 迷你步进器：− / 值 / +，到边界自动禁用 */
function NumberStepper({
  value,
  min,
  max,
  step = 1,
  suffix = '',
  onChange,
}: {
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  onChange: (v: number) => void
}) {
  const btn =
    'flex h-6 w-6 items-center justify-center rounded-lg border border-line text-ink-soft transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40'
  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={() => onChange(Math.max(min, value - step))} disabled={value <= min} className={btn} aria-label="减少">
        <Minus size={12} />
      </button>
      <span className="w-9 text-center text-xs font-semibold tabular-nums">
        {value}
        {suffix}
      </span>
      <button type="button" onClick={() => onChange(Math.min(max, value + step))} disabled={value >= max} className={btn} aria-label="增加">
        <Plus size={12} />
      </button>
    </div>
  )
}

interface RegenerateDialogProps {
  onClose: () => void
  /** 确认：携带整理后的选项交由页面执行（setGenOptions + resetDeck + loadDeck） */
  onConfirm: (options: BriefingGenOptions) => void
}

/** 重新生成简报悬浮弹窗（v0.8.4）：提示词 / 简报种类 / 参考资料 / 高级自定义 → 确认后按当前模式重载卡组 */
export default function RegenerateDialog({ onClose, onConfirm }: RegenerateDialogProps) {
  const role = useAuthStore((s) => s.role)
  const mode = useSettingsStore((s) => s.mode)
  const saved = useBriefingStore((s) => s.genOptions)

  /* 打开时从已存偏好回填（未设置过的字段 = 既有默认行为） */
  const [prompt, setPrompt] = useState(saved.prompt ?? '')
  const [types, setTypes] = useState<CardType[]>(saved.types ?? [])
  const [refs, setRefs] = useState(saved.references ?? { dataContext: true, decisions: true, favorites: true })
  const [count, setCount] = useState<number | null>(saved.count ?? null)
  const [style, setStyle] = useState<BriefingStyle | 'default'>(saved.style ?? 'default')
  const [payloads, setPayloads] = useState(saved.payloads ?? { chart: true, options: true, todos: true })
  const [timeoutSec, setTimeoutSec] = useState(Math.round((saved.timeoutMs ?? GEN_TIMEOUT.default) / 1000))
  const [attempts, setAttempts] = useState(saved.maxAttempts ?? GEN_ATTEMPTS.default)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  /* ESC 关闭 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const toggleType = (t: CardType) => setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))

  const refRows: { key: keyof NonNullable<BriefingGenOptions['references']>; label: string; hint: string }[] = [
    { key: 'dataContext', label: DATA_LABEL[role ?? 'teacher'], hint: '真实数据注入，卡片数字可溯源' },
    { key: 'decisions', label: '历史决策', hint: '跳过较多的主题降低优先级' },
    { key: 'favorites', label: '收藏卡片', hint: '按兴趣生成关联跟进卡' },
  ]

  const handleConfirm = () => {
    onConfirm({
      prompt: prompt.trim() || undefined,
      types: types.length > 0 ? types : undefined,
      references: refs,
      count: count ?? undefined,
      style: style === 'default' ? undefined : style,
      payloads,
      timeoutMs: timeoutSec * 1000,
      maxAttempts: attempts,
    })
  }

  return (
    <div
      className="absolute inset-0 z-30 flex items-end justify-center bg-ink/30 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
      data-testid="regen-dialog"
    >
      <div
        className="animate-fade-up flex max-h-[calc(100%-1rem)] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 pb-4 pt-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-white">
              <Wand2 size={16} />
            </div>
            <div>
              <h3 className="text-sm font-semibold">重新生成简报</h3>
              <p className="mt-0.5 text-xs text-ink-mute">按你的偏好重新生成今日简报</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink"
            aria-label="关闭"
          >
            <X size={14} />
          </button>
        </div>

        {/* 内容区（弹窗内滚动） */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* Mock 模式提示条：仅种类过滤生效 */}
          {mode === 'mock' && (
            <p className="rounded-2xl bg-amber-soft px-3.5 py-2.5 text-xs leading-relaxed text-amber-700">
              当前为演示模式：仅「简报种类」过滤生效；提示词与高级选项在 API 模式下生效。
            </p>
          )}

          {/* 提示词 */}
          <section>
            <label htmlFor="regen-prompt" className="flex items-center justify-between text-xs font-medium">
              <span>
                提示词<span className="ml-1 font-normal text-ink-mute">（仅 API 模式生效）</span>
              </span>
              <span className="text-[0.625rem] font-normal text-ink-mute tabular-nums">
                {prompt.length}/{GEN_PROMPT_MAX_LEN}
              </span>
            </label>
            <textarea
              id="regen-prompt"
              value={prompt}
              maxLength={GEN_PROMPT_MAX_LEN}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="例：多关注物理学科薄弱点，语气务实，少用套话"
              rows={3}
              className="mt-2 w-full resize-none rounded-2xl border border-line bg-bg px-3.5 py-2.5 text-xs leading-relaxed outline-none transition-colors placeholder:text-ink-mute focus:border-primary/60"
            />
          </section>

          {/* 简报种类 */}
          <section>
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium">
                简报种类<span className="ml-1 font-normal text-ink-mute">（不勾选 = 不限）</span>
              </p>
              <div className="flex items-center gap-2 text-[0.625rem] text-ink-mute">
                <button type="button" onClick={() => setTypes(TYPE_META.map((t) => t.type))} className="transition-colors hover:text-primary">
                  全选
                </button>
                <button type="button" onClick={() => setTypes([])} className="transition-colors hover:text-primary">
                  清空
                </button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {TYPE_META.map(({ type, label }) => {
                const active = types.includes(type)
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => toggleType(type)}
                    aria-pressed={active}
                    className={cn('rounded-full border px-3 py-1 text-xs font-medium transition-colors', active ? chipActive : chipIdle)}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </section>

          {/* 参考资料 */}
          <section>
            <p className="text-xs font-medium">
              参考资料<span className="ml-1 font-normal text-ink-mute">（API 模式注入生成上下文）</span>
            </p>
            <div className="mt-2 space-y-1">
              {refRows.map(({ key, label, hint }) => (
                <label key={key} className="flex cursor-pointer items-center gap-2.5 rounded-xl px-1 py-1.5 transition-colors hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={refs[key] ?? true}
                    onChange={(e) => setRefs((r) => ({ ...r, [key]: e.target.checked }))}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium">{label}</span>
                    <span className="block text-[0.625rem] text-ink-mute">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          {/* 高级自定义（折叠） */}
          <section className="rounded-2xl border border-line">
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              aria-expanded={advancedOpen}
              className="flex w-full items-center justify-between px-3.5 py-2.5 text-xs font-medium"
            >
              高级自定义
              <ChevronDown size={14} className={cn('text-ink-mute transition-transform', advancedOpen && 'rotate-180')} />
            </button>
            {advancedOpen && (
              <div className="space-y-4 border-t border-line px-3.5 py-3.5">
                {/* 卡片数量 */}
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium">卡片数量</p>
                    <p className="text-[0.625rem] text-ink-mute">{count == null ? '默认 5-7 张' : `固定 ${count} 张`}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {count != null && (
                      <button
                        type="button"
                        onClick={() => setCount(null)}
                        className="text-[0.625rem] text-ink-mute transition-colors hover:text-primary"
                      >
                        重置
                      </button>
                    )}
                    <NumberStepper
                      value={count ?? 5}
                      min={GEN_COUNT.min}
                      max={GEN_COUNT.max}
                      onChange={(v) => setCount(v)}
                    />
                  </div>
                </div>

                {/* 内容风格 */}
                <div>
                  <p className="text-xs font-medium">内容风格</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {STYLE_META.map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setStyle(value)}
                        aria-pressed={style === value}
                        className={cn('rounded-full border px-3 py-1 text-xs font-medium transition-colors', style === value ? chipActive : chipIdle)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 交互卡片（payload） */}
                <div>
                  <p className="text-xs font-medium">交互卡片</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                    {PAYLOAD_META.map(({ key, label }) => (
                      <label key={key} className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-soft">
                        <input
                          type="checkbox"
                          checked={payloads[key]}
                          onChange={(e) => setPayloads((p) => ({ ...p, [key]: e.target.checked }))}
                          className="h-3.5 w-3.5 accent-primary"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>

                {/* 生成参数 */}
                <div>
                  <p className="text-xs font-medium">
                    生成参数<span className="ml-1 font-normal text-ink-mute">（仅 API 模式生效）</span>
                  </p>
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-ink-soft">单次超时</p>
                      <NumberStepper
                        value={timeoutSec}
                        min={GEN_TIMEOUT.min / 1000}
                        max={GEN_TIMEOUT.max / 1000}
                        suffix="s"
                        onChange={setTimeoutSec}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-ink-soft">失败重试次数</p>
                      <NumberStepper value={attempts} min={GEN_ATTEMPTS.min} max={GEN_ATTEMPTS.max} onChange={setAttempts} />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* 底部操作 */}
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-line bg-surface px-4 py-2 text-xs font-medium text-ink-soft transition-colors hover:border-primary/40 hover:text-primary"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            data-testid="regen-confirm"
            className="flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-xs font-medium text-white shadow-soft transition-all hover:bg-primary-deep active:scale-[0.98]"
          >
            <Wand2 size={13} />
            重新生成
          </button>
        </div>
      </div>
    </div>
  )
}
