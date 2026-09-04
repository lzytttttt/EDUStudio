import { useState } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { ArrowUpRight, ArrowDownRight, Globe2 } from 'lucide-react'
import { REGION_METRICS } from '../../data/seed'
import { cn } from '../../lib/cn'

const PERIODS = ['T-5', 'T-4', 'T-3', 'T-2', 'T-1', '本期']

/** 区域指标看板：核心指标卡 + 历史趋势（v0.3 专项 ①） */
export default function RegionBoard() {
  const [selected, setSelected] = useState(0)
  const metric = REGION_METRICS[selected]
  const trendData = metric.history.map((v, i) => ({ period: PERIODS[i] ?? `T-${5 - i}`, value: v }))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Globe2 size={15} className="shrink-0 text-ink-mute" />
          <h2 className="text-sm font-semibold">区域指标看板</h2>
        </div>
        <span className="text-[10px] text-ink-mute">12 所监测校</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {/* 指标卡 */}
        <div className="grid grid-cols-2 gap-2">
          {REGION_METRICS.map((m, i) => {
            const up = m.trend >= 0
            const active = i === selected
            return (
              <button
                key={m.name}
                onClick={() => setSelected(i)}
                className={cn(
                  'rounded-2xl border p-3 text-left transition-all',
                  active ? 'border-primary/50 bg-primary-soft' : 'border-line bg-surface-2 hover:border-primary/30',
                )}
              >
                <p className="truncate text-[10px] text-ink-mute" title={m.name}>{m.name}</p>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className={cn('text-lg font-semibold tabular-nums', active ? 'text-primary' : 'text-ink')}>
                    {m.value}
                  </span>
                  <span className={cn('inline-flex items-center gap-0.5 text-[10px] font-medium', up ? 'text-mint' : 'text-danger')}>
                    {up ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                    {up ? '+' : ''}{m.trend}%
                  </span>
                </div>
              </button>
            )
          })}
        </div>

        {/* 选中指标趋势 */}
        <div className="mt-4 rounded-2xl border border-line bg-surface-2 p-3">
          <p className="mb-1 truncate text-[11px] font-medium text-ink-soft">{metric.name} · 近 6 期</p>
          <div className="h-40 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 10, fill: 'var(--color-ink-mute)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--color-ink-mute)' }} axisLine={false} tickLine={false} domain={['dataMin - 1', 'dataMax + 1']} />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 12, border: '1px solid var(--color-line)', background: 'var(--color-surface)' }}
                  labelStyle={{ color: 'var(--color-ink-soft)', fontWeight: 600 }}
                />
                <Line type="monotone" dataKey="value" name={metric.name} stroke="#4f46e5" strokeWidth={2} dot={{ r: 2.5, fill: '#4f46e5' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-ink-mute">{metric.note}</p>
        </div>

        <p className="mt-3 text-[10px] leading-relaxed text-ink-mute">
          提示：在左侧对话发送「起草本季度区域教学质量分析报告」，指标与趋势会自动写入报告。
        </p>
      </div>
    </div>
  )
}
