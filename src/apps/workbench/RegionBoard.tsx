import { useEffect, useState } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { ArrowUpRight, ArrowDownRight, Globe2, RefreshCw, Clock, WifiOff } from 'lucide-react'
import type { RegionMetric } from '../../data/seed'
import { getSourceProvider, formatAge, isStale, type RegionResult } from '../../harness/sources'
import { cn } from '../../lib/cn'

const PERIODS = ['T-5', 'T-4', 'T-3', 'T-2', 'T-1', '本期']

/** 区域指标看板：核心指标卡 + 历史趋势（v0.3 专项 ①；v0.5 M1③④ 接入数据源 + 新鲜度标注） */
export default function RegionBoard() {
  const [data, setData] = useState<RegionResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [selected, setSelected] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    getSourceProvider()
      .getRegionMetrics()
      .then((r) => {
        if (alive) setData(r)
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [reloadKey])

  const metrics: RegionMetric[] = data?.metrics ?? []
  const meta = data?.meta
  const metric = metrics[Math.min(selected, Math.max(metrics.length - 1, 0))]
  const trendData = (metric?.history ?? []).map((v, i) => ({ period: PERIODS[i] ?? `T-${5 - i}`, value: v }))
  const stale = isStale(meta)

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
        {/* 数据来源与新鲜度（v0.5 M1④） */}
        {meta && (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[10px] text-ink-mute">
            <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-2 py-0.5">
              <Clock size={9} />
              {meta.label} · {formatAge(meta.fetchedAt)}
            </span>
            {meta.degraded && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
                <WifiOff size={9} />
                远端不可用，已回落演示数据
              </span>
            )}
            {stale && !meta.degraded && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
                数据超过 7 天
              </span>
            )}
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 transition-colors hover:border-primary/40 hover:text-primary"
            >
              <RefreshCw size={9} className={cn(loading && 'animate-spin')} />
              刷新
            </button>
          </div>
        )}

        {loading && !data ? (
          <div className="grid grid-cols-2 gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-[72px] animate-pulse rounded-2xl bg-surface-2" />
            ))}
          </div>
        ) : (
          <>
            {/* 指标卡 */}
            <div className="grid grid-cols-2 gap-2">
              {metrics.map((m, i) => {
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
            {metric && (
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
            )}

            <p className="mt-3 text-[10px] leading-relaxed text-ink-mute">
              提示：在左侧对话发送「起草本季度区域教学质量分析报告」，指标与趋势会自动写入报告。
            </p>
          </>
        )}
      </div>
    </div>
  )
}
