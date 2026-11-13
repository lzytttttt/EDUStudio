/**
 * v1.2 M1 · 外壳插槽 SurfaceHost（主 chunk，roadmap §3.3）
 *
 * 「外壳 + 可注册的视图」：外壳不认识 Director 细节；每个一级视图由所属 chunk 在模块加载时
 * `registerSurface({ id, title, load })` 注册，`load` 用动态 import 实现视图级懒加载。
 * 主 chunk 只放注册表与 Suspense 渲染，不 import 任何视图实现。
 */
import { Suspense, lazy, useMemo, type ComponentType, type ReactNode } from 'react'
import type { Navigator, SurfaceId, WorkTarget } from '../studio/contracts'

/** 视图收到的统一 props（经典视图可为 null / 忽略） */
export interface SurfaceProps {
  /** 深链目标（如 mission 的 id / team 的 agentId） */
  target: WorkTarget | null
  /** 统一导航入口（禁止视图自己写 history） */
  navigate: Navigator
}

export interface SurfaceDef {
  id: SurfaceId
  title: string
  /** 视图级懒加载入口；必须返回 `{ default: ComponentType<SurfaceProps> }` */
  load: () => Promise<{ default: ComponentType<SurfaceProps> }>
  /** 需要的工作区（如 team 需要 director）；缺省不限 */
  requires?: 'director' | 'classic'
}

const registry = new Map<SurfaceId, SurfaceDef>()

/** 注册（同 id 幂等覆盖；chunk 重复加载时不会报错） */
export function registerSurface(def: SurfaceDef): void {
  registry.set(def.id, def)
}

export function unregisterSurface(id: SurfaceId): void {
  registry.delete(id)
}

export function getSurfaceDef(id: SurfaceId): SurfaceDef | undefined {
  return registry.get(id)
}

export function listSurfaces(): SurfaceDef[] {
  return [...registry.values()]
}

/** 单测 / 重置用：清空注册表 */
export function resetSurfaces(): void {
  registry.clear()
}

export interface SurfaceHostProps {
  surface: SurfaceId
  target?: WorkTarget | null
  navigate: Navigator
  /** 加载中占位（缺省 null，由外壳自带骨架） */
  fallback?: ReactNode
}

/** 按注册表渲染当前一级视图（Suspense + lazy，视图级分包） */
export function SurfaceHost({ surface, target = null, navigate, fallback = null }: SurfaceHostProps): JSX.Element | null {
  const def = registry.get(surface)
  const View = useMemo(() => (def ? lazy(def.load) : null), [def])
  if (!View) return <>{fallback}</>
  return (
    <Suspense fallback={fallback}>
      <View target={target} navigate={navigate} />
    </Suspense>
  )
}
