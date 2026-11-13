/**
 * v1.2 M0 · 功能开关解析（纯函数；roadmap §3.9）
 *
 * 解析优先级（从高到低）：
 * 1. URL：`?v2=1/0` 表达 studioV2 及其子能力；`?exec=real/mock` 表达 realExecution；
 *    `?legacy=1` 强制全 off（回滚开关优先于其它一切）；
 * 2. settings.studio：`flags[name]`（内部灰度/排障覆盖，on/off）优先，
 *    其次 `landing` / `execution` 的派生语义；
 * 3. 角色默认：M4 前（defaultMode='shadow'）teacher 全 off；M4 起（'default'）teacher 全 on；
 * 4. 构建默认：`buildDefault`，缺省 false。
 *
 * 本模块不 import settingsStore：上下文由调用方注入，便于单测与后续接线。
 */

import type { RoleId } from '../harness/types'
import type { FlagContext, FlagName, ResolvedFlag, StudioSettings } from './contracts'

export type { FlagContext, FlagName, FlagSource, FlagValue, ResolvedFlag } from './contracts'

/** `1/true` → on，`0/false` → off，其余（含 auto 与非法值）→ 本层无意见 */
function parseSwitch(value: string | null): boolean | null {
  if (value === '1' || value === 'true') return true
  if (value === '0' || value === 'false') return false
  return null
}

/** 从 search 取查询参数：接受带/不带 `?` 的查询串，忽略 hash 段 */
function toParams(search: string): URLSearchParams {
  const withoutHash = search.split('#')[0]
  const queryIndex = withoutHash.indexOf('?')
  return new URLSearchParams(queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : withoutHash)
}

/** 第一层：URL（最高优先；?legacy=1 强制全 off） */
function resolveFromUrl(name: FlagName, search: string): ResolvedFlag | null {
  const params = toParams(search)
  if (parseSwitch(params.get('legacy')) === true) return { value: false, source: 'url' }

  // 真执行只认 ?exec=（real/mock）；auto / 非法值交下一层
  if (name === 'realExecution') {
    const exec = params.get('exec')
    const value = exec === 'real' ? true : exec === 'mock' ? false : null
    return value === null ? null : { value, source: 'url' }
  }

  // `?v2=1/0` 表达总开关与三个派生能力子开关（realExecution 由 ?exec= 单独表达）
  const v2 = parseSwitch(params.get('v2'))
  return v2 === null ? null : { value: v2, source: 'url' }
}

/** 第二层：settings.studio（显式 flags 覆盖优先，其次 landing / execution 派生） */
function resolveFromSettings(name: FlagName, studio: Partial<StudioSettings> | undefined): ResolvedFlag | null {
  if (!studio) return null

  const override = studio.flags?.[name]
  if (override === 'on') return { value: true, source: 'settings' }
  if (override === 'off') return { value: false, source: 'settings' }

  // 启动页选「战情台」= 启用新壳；选简报/工作台 = 保持旧入口
  if (name === 'studioV2') {
    if (studio.landing === 'inbox') return { value: true, source: 'settings' }
    if (studio.landing === 'briefing' || studio.landing === 'workbench') return { value: false, source: 'settings' }
  }

  // 设置页「默认执行模式」
  if (name === 'realExecution') {
    if (studio.execution === 'real') return { value: true, source: 'settings' }
    if (studio.execution === 'mock') return { value: false, source: 'settings' }
  }

  return null
}

/** 第三层：角色默认（校/局与未登录不给意见，交给构建默认；D14：总指挥只对 teacher 开放） */
function resolveFromRole(role: RoleId | null, defaultMode: 'shadow' | 'default' | undefined): ResolvedFlag | null {
  if (role !== 'teacher') return null
  return { value: defaultMode === 'default', source: 'roleDefault' }
}

/**
 * 解析单个功能开关（纯函数）。
 * @param name 开关名（§3.9 五项）
 * @param role 当前登录角色（null = 未登录）
 * @param ctx 注入式上下文（search / settings / buildDefault / defaultMode）
 */
export function resolveFlag(name: FlagName, role: RoleId | null, ctx: FlagContext): ResolvedFlag {
  const fromUrl = resolveFromUrl(name, ctx.search)
  if (fromUrl) return fromUrl

  // FlagContext.settings 直接是 settings.studio 段（不嵌套 studio，与附录 A 形状一致）
  const fromSettings = resolveFromSettings(name, ctx.settings)
  if (fromSettings) return fromSettings

  const fromRole = resolveFromRole(role, ctx.defaultMode)
  if (fromRole) return fromRole

  return { value: ctx.buildDefault?.[name] === true, source: 'build' }
}
