import { useState } from 'react'
import {
  Lightbulb, Scale, PenLine, ListTodo, BarChart3, HelpCircle, ChevronDown, Check,
} from 'lucide-react'
import type { BriefingCard, CardPayload, CardType } from '../../harness/types'
import { cn } from '../../lib/cn'

const TYPE_META: Record<CardType, { label: string; icon: typeof Lightbulb; chip: string; bar: string }> = {
  insight: { label: '洞察', icon: Lightbulb, chip: 'bg-mint-soft text-mint', bar: 'bg-mint' },
  decision: { label: '决策', icon: Scale, chip: 'bg-amber-soft text-amber', bar: 'bg-amber' },
  creation: { label: '创作', icon: PenLine, chip: 'bg-primary-soft text-primary', bar: 'bg-primary' },
  todo: { label: '待办', icon: ListTodo, chip: 'bg-coral-soft text-coral', bar: 'bg-coral' },
  data: { label: '数据', icon: BarChart3, chip: 'bg-primary-soft text-primary', bar: 'bg-primary' },
  question: { label: '提问', icon: HelpCircle, chip: 'bg-coral-soft text-coral', bar: 'bg-coral' },
}

function ChartPayload({ payload }: { payload: Extract<CardPayload, { kind: 'chart' }> }) {
  const max = Math.max(...payload.bars.map((b) => b.value), 1)
  return (
    <div className="mt-4 rounded-2xl bg-surface-2 p-4">
      <p className="text-xs font-medium text-ink-soft">{payload.title}</p>
      <div className="mt-3 space-y-2.5">
        {payload.bars.map((b) => (
          <div key={b.label} className="flex items-center gap-2.5">
            <span className="w-16 shrink-0 truncate text-xs text-ink-soft">{b.label}</span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-line">
              <div
                className={cn('h-full rounded-full transition-all duration-700', b.peak ? 'bg-coral' : 'bg-primary')}
                style={{ width: `${Math.max((b.value / max) * 100, 6)}%` }}
              />
            </div>
            <span className={cn('w-12 text-right text-xs font-semibold', b.peak ? 'text-coral' : 'text-ink')}>
              {b.display ?? b.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function OptionsPayload({ payload }: { payload: Extract<CardPayload, { kind: 'options' }> }) {
  return (
    <div className="mt-4 space-y-2">
      {payload.options.map((o, i) => (
        <div key={i} className="flex items-start gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-3">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-line text-[10px] font-bold text-ink-mute">
            {String.fromCharCode(65 + i)}
          </span>
          <div>
            <p className="text-sm font-medium leading-snug">{o.text}</p>
            {o.sub && <p className="mt-0.5 text-xs text-ink-mute">{o.sub}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}

function EditablePayload({ payload }: { payload: Extract<CardPayload, { kind: 'editable' }> }) {
  return (
    <div className="mt-4 max-h-36 overflow-hidden rounded-2xl bg-surface-2 p-4">
      <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-ink-soft">{payload.text}</pre>
      <div className="pointer-events-none -mt-6 h-6 bg-gradient-to-t from-surface-2 to-transparent" />
    </div>
  )
}

function TodosPayload({ payload }: { payload: Extract<CardPayload, { kind: 'todos' }> }) {
  return (
    <div className="mt-4 space-y-2">
      {payload.todos.map((t, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-2.5">
          <span className="flex h-4.5 w-4.5 h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border-2 border-line">
            {t.done && <Check size={12} className="text-mint" />}
          </span>
          <p className={cn('flex-1 text-sm', t.done ? 'text-ink-mute line-through' : '')}>{t.text}</p>
          {t.meta && <span className="shrink-0 text-[11px] text-ink-mute">{t.meta}</span>}
        </div>
      ))}
    </div>
  )
}

function ExpandablePayload({ payload }: { payload: Extract<CardPayload, { kind: 'expandable' }> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-4 rounded-2xl border border-line">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-medium text-ink-soft hover:bg-surface-2"
      >
        {payload.title}
        <ChevronDown size={14} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div
          className="animate-fade-in border-t border-line px-4 py-3 text-xs leading-relaxed text-ink-soft"
          dangerouslySetInnerHTML={{ __html: payload.content }}
        />
      )}
    </div>
  )
}

export default function BriefingCardView({ card }: { card: BriefingCard }) {
  const meta = TYPE_META[card.type]
  const Icon = meta.icon
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[28px] border border-line bg-surface shadow-card">
      <div className={cn('h-1.5 w-full', meta.bar)} />
      <div className="flex flex-1 flex-col overflow-y-auto p-6">
        <div className="flex items-center justify-between">
          <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold', meta.chip)}>
            <Icon size={13} />
            {meta.label} · {card.tag}
          </span>
          <span className="flex items-center gap-1" title={`置信度 ${card.confidence}/3`}>
            {[1, 2, 3].map((i) => (
              <span key={i} className={cn('h-1.5 w-1.5 rounded-full', i <= card.confidence ? 'bg-mint' : 'bg-line')} />
            ))}
          </span>
        </div>

        <h2 className="mt-4 text-[19px] font-bold leading-snug tracking-tight">{card.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">{card.body}</p>

        {card.payload?.kind === 'chart' && <ChartPayload payload={card.payload} />}
        {card.payload?.kind === 'options' && <OptionsPayload payload={card.payload} />}
        {card.payload?.kind === 'editable' && <EditablePayload payload={card.payload} />}
        {card.payload?.kind === 'todos' && <TodosPayload payload={card.payload} />}
        {card.payload?.kind === 'expandable' && <ExpandablePayload payload={card.payload} />}

        <div className="mt-auto pt-4">
          <p className="text-[11px] text-ink-mute">来源：{card.source}</p>
        </div>
      </div>
    </div>
  )
}
