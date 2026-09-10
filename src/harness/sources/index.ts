/**
 * 数据源抽象（v0.5 M1①）
 *
 * 抽象 `SourceProvider` 接口：学情 / 校情 / 区域指标统一取数入口。
 * 双实现：
 *  - SeedSourceProvider：本地数据（CSV 导入优先，静态 seed 兜底），离线可演示；
 *  - RemoteSourceProvider：远端 API（轻后端代理 /api/sources/*），带超时与降级
 *    （请求失败回落 seed，meta.degraded = true，UI 标注「演示数据」）。
 *
 * 设置页可切换（settingsStore.dataSource）；业务代码只依赖本文件契约。
 */
import type { ClassLearning, RegionMetric, SchoolAlert, SchoolTrendPoint } from '../../data/seed'
import { CLASS_LEARNING, REGION_METRICS, SCHOOL_ALERTS, SCHOOL_TREND, findClassLearning } from '../../data/seed'
import { findImportedProfile } from '../../stores/dataStore'
import { useSettingsStore } from '../../stores/settingsStore'

export type SourceKind = 'seed' | 'remote' | 'csv'

/** 数据元信息：新鲜度标注（v0.5 M1④）与来源展示 */
export interface SourceMeta {
  /** 数据产出时间（ms）：seed=构建基线，csv=导入时间，remote=拉取时间 */
  fetchedAt: number
  /** 来源种类 */
  kind: SourceKind
  /** 来源展示名，如「本地导入」「演示数据」「区域数据平台」 */
  label: string
  /** 远端失败回落 seed 时为 true */
  degraded?: boolean
}

export interface ClassProfileResult {
  profile: ClassLearning | null
  meta: SourceMeta
}
export interface RegionResult {
  metrics: RegionMetric[]
  meta: SourceMeta
}
export interface SchoolOverviewResult {
  trend: SchoolTrendPoint[]
  alerts: SchoolAlert[]
  meta: SourceMeta
}

export interface SourceProvider {
  readonly kind: SourceKind
  /** 班级学情（keyword 为班级名/ID，缺省取最新） */
  getClassProfile(keyword?: string): Promise<ClassProfileResult>
  /** 区域指标 */
  getRegionMetrics(): Promise<RegionResult>
  /** 校情总览（周趋势 + 预警） */
  getSchoolOverview(): Promise<SchoolOverviewResult>
}

/* ---------- 元信息工具 ---------- */

/** seed 基线（v0.9.3 P0-C）：以「今天 − 1 天」派生，演示中不出现常驻「建议刷新」；
 *  remote / CSV 链路的新鲜度判定不受影响。now 可注入便于单测固化。 */
export function seedBaseline(now: number = Date.now()): number {
  return now - 24 * 3600 * 1000
}

export function seedMeta(label = '演示数据', now: number = Date.now()): SourceMeta {
  return { fetchedAt: seedBaseline(now), kind: 'seed', label }
}

/** 数据是否过期（默认 7 天，见 v0.5 M1④）；now 可注入便于单测固化 */
export const STALE_AFTER_MS = 7 * 24 * 3600 * 1000

export function isStale(meta: SourceMeta | null | undefined, maxAgeMs = STALE_AFTER_MS, now: number = Date.now()): boolean {
  if (!meta) return false
  return now - meta.fetchedAt > maxAgeMs
}

/** 相对时间描述：刚刚 / N 分钟前 / N 小时前 / N 天前 / 具体日期 */
export function formatAge(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 24 * 3600_000) return `${Math.floor(diff / 3600_000)} 小时前`
  if (diff < STALE_AFTER_MS) return `${Math.floor(diff / (24 * 3600_000))} 天前`
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

/* ---------- Seed 实现：CSV 导入优先，静态 seed 兜底 ---------- */

export class SeedSourceProvider implements SourceProvider {
  readonly kind: SourceKind = 'seed'

  async getClassProfile(keyword?: string): Promise<ClassProfileResult> {
    const imported = findImportedProfile(keyword)
    if (imported) {
      const { importedAt, fileName, studentCount, ...profile } = imported
      void fileName
      void studentCount
      return {
        profile,
        meta: { fetchedAt: importedAt, kind: 'csv', label: `本地导入 · ${fileName}` },
      }
    }
    const profile = (keyword ? findClassLearning(keyword) : undefined) ?? CLASS_LEARNING[0] ?? null
    return { profile, meta: seedMeta() }
  }

  async getRegionMetrics(): Promise<RegionResult> {
    return { metrics: REGION_METRICS, meta: seedMeta() }
  }

  async getSchoolOverview(): Promise<SchoolOverviewResult> {
    return { trend: SCHOOL_TREND, alerts: SCHOOL_ALERTS, meta: seedMeta() }
  }
}

/* ---------- Remote 实现：超时 + seed 降级 ---------- */

const REMOTE_TIMEOUT_MS = 4000

export class RemoteSourceProvider implements SourceProvider {
  readonly kind: SourceKind = 'remote'
  constructor(private base: string) {}

  private async getJson<T>(path: string): Promise<T | null> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), REMOTE_TIMEOUT_MS)
    try {
      const res = await fetch(`${this.base.replace(/\/+$/, '')}${path}`, { signal: ctrl.signal })
      if (!res.ok) return null
      return (await res.json()) as T
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  async getClassProfile(keyword?: string): Promise<ClassProfileResult> {
    // 本地导入的数据始终最优先（教师个人数据不依赖远端）
    const imported = findImportedProfile(keyword)
    if (imported) {
      const { importedAt, fileName, studentCount, ...profile } = imported
      void studentCount
      return {
        profile,
        meta: { fetchedAt: importedAt, kind: 'csv', label: `本地导入 · ${fileName}` },
      }
    }
    const kw = keyword ? `?kw=${encodeURIComponent(keyword)}` : ''
    const data = await this.getJson<{ classes: ClassLearning[]; fetchedAt?: number }>(`/classes${kw}`)
    if (data?.classes?.length) {
      const kwTrim = keyword?.trim()
      const profile = (kwTrim ? data.classes.find((c) => c.className.includes(kwTrim) || c.classId === kwTrim) : undefined) ?? data.classes[0]
      return {
        profile,
        meta: { fetchedAt: data.fetchedAt ?? Date.now(), kind: 'remote', label: '区域数据平台' },
      }
    }
    const profile = (keyword ? findClassLearning(keyword) : undefined) ?? CLASS_LEARNING[0] ?? null
    return { profile, meta: { ...seedMeta(), degraded: true } }
  }

  async getRegionMetrics(): Promise<RegionResult> {
    const data = await this.getJson<{ metrics: RegionMetric[]; fetchedAt?: number }>('/region')
    if (data?.metrics?.length) {
      return { metrics: data.metrics, meta: { fetchedAt: data.fetchedAt ?? Date.now(), kind: 'remote', label: '区域数据平台' } }
    }
    return { metrics: REGION_METRICS, meta: { ...seedMeta(), degraded: true } }
  }

  async getSchoolOverview(): Promise<SchoolOverviewResult> {
    const data = await this.getJson<{ trend: SchoolTrendPoint[]; alerts: SchoolAlert[]; fetchedAt?: number }>('/school')
    if (data?.trend?.length || data?.alerts?.length) {
      return {
        trend: data.trend ?? SCHOOL_TREND,
        alerts: data.alerts ?? SCHOOL_ALERTS,
        meta: { fetchedAt: data.fetchedAt ?? Date.now(), kind: 'remote', label: '校情数据平台' },
      }
    }
    return { trend: SCHOOL_TREND, alerts: SCHOOL_ALERTS, meta: { ...seedMeta(), degraded: true } }
  }
}

/* ---------- 注册中心：按设置惰性构建并缓存 ---------- */

let cached: { key: string; provider: SourceProvider } | null = null

export function getSourceProvider(): SourceProvider {
  const s = useSettingsStore.getState()
  const key = `${s.dataSource}|${s.sourceUrl}`
  if (cached?.key === key) return cached.provider
  cached = {
    key,
    provider: s.dataSource === 'remote' && s.sourceUrl.trim() ? new RemoteSourceProvider(s.sourceUrl.trim()) : new SeedSourceProvider(),
  }
  return cached.provider
}

/** 手动失效缓存（导入数据变化后调用，让 csv 优先逻辑立即生效） */
export function invalidateSourceProvider(): void {
  cached = null
}
