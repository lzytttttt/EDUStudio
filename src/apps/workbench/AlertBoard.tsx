import { useEffect, useState } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { Siren, TrendingUp, RefreshCw, Clock, WifiOff } from 'lucide-react'
import type { SchoolAlert, SchoolTrendPoint } from '../../data/seed'
import { getSourceProvider, formatAge, isStale, type SchoolOverviewResult } from '../../harness/sources'
import { cn } from '../../lib/cn'

const LEVEL_STYLE: Record<SchoolAlert['level'], { label: string; cls: string; dot: string }> = {
  high: { label: '高', cls: 'bg-danger/10 text-danger', dot: 'bg-danger' },
  mid: { label: '中', cls: 'bg-amber-50 text-amber-600', dot: 'bg-amber-400' },
  low: { label: '低', cls: 'bg-surface-2 text-ink-mute', dot: 'bg-ink-mute/50' },
}

/** 校情驾驶舱：近 8 周趋势 + 结构化预警（v0.3 专项 ①；v0.5 M1③④ 接入数据源 + 新鲜度标注） */
export default function AlertBoard() {
  const [data, setData] = useState<SchoolOverviewResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [activeAlert, setActiveAlert] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    getSourceProvider()
      .getSchoolOverview()
      .then((r) => {
        if (!alive) return
        setData(r)
        setActiveAlert((cur) => cur ?? r.alerts[0]?.title ?? null)
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [reloadKey])

  const trend: SchoolTrendPoint[] = data?.trend ?? []
  const alerts: SchoolAlert[] = data?.alerts ?? []
  const meta = data?.meta
  const stale = isStale(meta)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <TrendingUp size={15} className="shrink-0 text-ink-mute" />
          <h2 className="text-sm font-semibold">校情驾驶舱</h2>
          <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[0.625rem] font-medium text-primary">实验一中</span>
        </div>
        <span className="text-[0.625rem] text-ink-mute">近 8 周</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {/* 数据来源与新鲜度（v0.5 M1④） */}
        {meta && (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[0.625rem] text-ink-mute">
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
          <div className="space-y-3">
            <div className="h-44 animate-pulse rounded-2xl bg-surface-2" />
            <div className="h-20 animate-pulse rounded-2xl bg-surface-2" />
          </div>
        ) : (
          <>
            {/* 趋势图 */}
            <div className="rounded-2xl border border-line bg-surface-2 p-3">
              <p className="mb-1 text-[0.6875rem] font-medium text-ink-soft">教学质量周趋势</p>
              <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" vertical={false} />
                    <XAxis dataKey="week" tick={{ fontSize: 10, fill: 'var(--color-ink-mute)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--color-ink-mute)' }} axisLine={false} tickLine={false} domain={['dataMin - 2', 'dataMax + 2']} />
                    <Tooltip
                      contentStyle={{ fontSize: 11, borderRadius: 12, border: '1px solid var(--color-line)', background: 'var(--color-surface)' }}
                      labelStyle={{ color: 'var(--color-ink-soft)', fontWeight: 600 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Line type="monotone" dataKey="avgScore" name="均分" stroke="#4f46e5" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="homework" name="作业完成率" stroke="#10b981" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="attention" name="专注度" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 预警列表 */}
            <div className="mt-4">
              <div className="mb-2 flex items-center gap-1.5">
                <Siren size={13} className="text-danger" />
                <p className="text-[0.6875rem] font-semibold text-ink-soft">教学质量预警（{alerts.length}）</p>
              </div>
              <ul className="space-y-2">
                {alerts.map((a) => {
                  const style = LEVEL_STYLE[a.level]
                  const active = activeAlert === a.title
                  return (
                    <li key={a.title}>
                      <button
                        onClick={() => setActiveAlert(active ? null : a.title)}
                        className={cn(
                          'w-full rounded-2xl border px-3 py-2.5 text-left transition-all',
                          active ? 'border-primary/50 bg-primary-soft' : 'border-line bg-surface-2 hover:border-primary/30',
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className={cn('h-2 w-2 shrink-0 rounded-full', style.dot)} />
                          <span className={cn('shrink-0 rounded-md px-1.5 py-0.5 text-[0.625rem] font-semibold', style.cls)}>
                            {style.label}
                          </span>
                          <span className="truncate text-xs font-medium text-ink">{a.title}</span>
                        </div>
                        {active && (
                          <p className="mt-2 pl-4 text-[0.6875rem] leading-relaxed text-ink-soft">{a.detail}</p>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
              <p className="mt-3 text-[0.625rem] leading-relaxed text-ink-mute">
                提示：在左侧对话发送「生成本月学校治理简报」，预警明细会自动写入报告。
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
