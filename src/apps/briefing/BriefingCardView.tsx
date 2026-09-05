import { useState } from 'react'
import {
  Lightbulb, Scale, PenLine, ListTodo, BarChart3, HelpCircle, ChevronDown, Check, ArrowRight, Pencil,
} from 'lucide-react'
import type { BriefingCard, CardLink, CardPayload, CardType } from '../../harness/types'
import { cn } from '../../lib/cn'

const TYPE_META: Record<CardType, { label: string; icon: typeof Lightbulb; chip: string; bar: string }> = {
  insight: { label: '洞察', icon: Lightbulb, chip: 'bg-mint-soft text-mint', bar: 'bg-mint' },
  decision: { label: '决策', icon: Scale, chip: 'bg-amber-soft text-amber', bar: 'bg-amber' },
  creation: { label: '创作', icon: PenLine, chip: 'bg-primary-soft text-primary', bar: 'bg-primary' },
  todo: { label: '待办', icon: ListTodo, chip: 'bg-coral-soft text-coral', bar: 'bg-coral' },
  data: { label: '数据', icon: BarChart3, chip: 'bg-primary-soft text-primary', bar: 'bg-primary' },
  question: { label: '提问', icon: HelpCircle, chip: 'bg-coral-soft text-coral', bar: 'bg-coral' },
}

/** 交互回调（v0.7）：全部可选，缺省 no-op 保持只读消费方（ShareView 等）兼容 */
export interface BriefingCardCallbacks {
  onSelectOption?: (cardId: string, index: number) => void
  onToggleTodo?: (cardId: string, index: number) => void
  onEditText?: (cardId: string, text: string) => void
  onOpenLink?: (link: CardLink) => void
}

/** 卡内交互元素统一阻止 pointer 冒泡，避免与滑卡拖拽抢占指针 */
const stopPointer = (e: React.PointerEvent) => e.stopPropagation()

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

function OptionsPayload({
  cardId, payload, onSelect,
}: { cardId: string; payload: Extract<CardPayload, { kind: 'options' }>; onSelect?: (cardId: string, index: number) => void }) {
  return (
    <div className="mt-4 space-y-2">
      {payload.options.map((o, i) => {
        const active = payload.selected === i
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSelect?.(cardId, i)}
            onPointerDown={stopPointer}
            aria-pressed={active}
            className={cn(
              'flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-all hover:-translate-y-0.5',
              active ? 'border-primary bg-primary-soft shadow-soft' : 'border-line bg-surface-2 hover:border-primary/40',
            )}
          >
            <span
              className={cn(
                'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[0.625rem] font-bold',
                active ? 'border-primary bg-primary text-white' : 'border-line text-ink-mute',
              )}
            >
              {active ? <Check size={11} /> : String.fromCharCode(65 + i)}
            </span>
            <div>
              <p className={cn('text-sm font-medium leading-snug', active && 'text-primary')}>{o.text}</p>
              {o.sub && <p className="mt-0.5 text-xs text-ink-mute">{o.sub}</p>}
            </div>
          </button>
        )
      })}
    </div>
  )
}

function EditablePayload({
  cardId, text, onSave,
}: { cardId: string; text: string; onSave?: (cardId: string, text: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  if (editing) {
    return (
      <div className="mt-4 rounded-2xl border-2 border-primary/60 bg-surface p-3 shadow-soft">
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false)
            if (draft !== text) onSave?.(cardId, draft)
          }}
          onPointerDown={stopPointer}
          rows={6}
          className="w-full resize-none bg-transparent text-xs leading-relaxed text-ink outline-none"
        />
        <p className="mt-1 text-right text-[0.625rem] text-ink-mute">失焦自动保存</p>
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(text)
        setEditing(true)
      }}
      onPointerDown={stopPointer}
      className="relative mt-4 block w-full rounded-2xl bg-surface-2 p-4 text-left transition-colors hover:bg-line/50"
      aria-label="点击编辑正文"
    >
      <pre className="max-h-32 overflow-hidden whitespace-pre-wrap font-sans text-xs leading-relaxed text-ink-soft">{text}</pre>
      <div className="pointer-events-none absolute inset-x-4 bottom-9 h-6 bg-gradient-to-t from-surface-2 to-transparent" />
      <span className="mt-2 inline-flex items-center gap-1 text-[0.625rem] font-medium text-primary">
        <Pencil size={10} />
        点击编辑
      </span>
    </button>
  )
}

function TodosPayload({
  cardId, payload, onToggle,
}: { cardId: string; payload: Extract<CardPayload, { kind: 'todos' }>; onToggle?: (cardId: string, index: number) => void }) {
  const doneCount = payload.todos.filter((t) => t.done).length
  const all = payload.todos.length
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between text-[0.6875rem] text-ink-mute">
        <span>完成进度</span>
        <span className={cn('font-semibold', doneCount === all && all > 0 && 'text-mint')}>
          {doneCount}/{all}
        </span>
      </div>
      <div className="space-y-2">
        {payload.todos.map((t, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onToggle?.(cardId, i)}
            onPointerDown={stopPointer}
            role="checkbox"
            aria-checked={t.done ?? false}
            className={cn(
              'flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors',
              t.done ? 'border-mint/40 bg-mint-soft/40' : 'border-line hover:border-mint/50',
            )}
          >
            <span
              className={cn(
                'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border-2 transition-colors',
                t.done ? 'border-mint bg-mint' : 'border-line',
              )}
            >
              {t.done && <Check size={12} className="text-white" />}
            </span>
            <p className={cn('flex-1 text-sm', t.done ? 'text-ink-mute line-through' : '')}>{t.text}</p>
            {t.meta && <span className="shrink-0 text-[0.6875rem] text-ink-mute">{t.meta}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

function ExpandablePayload({ payload }: { payload: Extract<CardPayload, { kind: 'expandable' }> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-4 rounded-2xl border border-line">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        onPointerDown={stopPointer}
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

function CardLinkRow({ link, onOpen }: { link: CardLink; onOpen?: (link: CardLink) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen?.(link)}
      onPointerDown={stopPointer}
      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 transition-colors hover:text-primary-deep hover:underline"
    >
      <ArrowRight size={12} />
      {link.label}
    </button>
  )
}

export default function BriefingCardView({
  card,
  onSelectOption,
  onToggleTodo,
  onEditText,
  onOpenLink,
}: { card: BriefingCard } & BriefingCardCallbacks) {
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
          <span className="minor-info flex items-center gap-1" title={`置信度 ${card.confidence}/3`}>
            {[1, 2, 3].map((i) => (
              <span key={i} className={cn('h-1.5 w-1.5 rounded-full', i <= card.confidence ? 'bg-mint' : 'bg-line')} />
            ))}
          </span>
        </div>

        <h2 className="mt-4 text-[1.1875rem] font-bold leading-snug tracking-tight">{card.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">{card.body}</p>

        {card.payload?.kind === 'chart' && <ChartPayload payload={card.payload} />}
        {card.payload?.kind === 'options' && (
          <OptionsPayload cardId={card.id} payload={card.payload} onSelect={onSelectOption} />
        )}
        {card.payload?.kind === 'editable' && (
          <EditablePayload cardId={card.id} text={card.payload.text} onSave={onEditText} />
        )}
        {card.payload?.kind === 'todos' && (
          <TodosPayload cardId={card.id} payload={card.payload} onToggle={onToggleTodo} />
        )}
        {card.payload?.kind === 'expandable' && <ExpandablePayload payload={card.payload} />}

        <div className="minor-info mt-auto pt-4">
          {card.link && <CardLinkRow link={card.link} onOpen={onOpenLink} />}
          <p className="text-[0.6875rem] text-ink-mute">来源：{card.source}</p>
        </div>
      </div>
    </div>
  )
}
