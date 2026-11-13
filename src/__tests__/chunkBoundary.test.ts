/**
 * v1.2 M0：源码层 chunk 边界测试（`npm test` 阶段跑，不依赖 dist）。
 *
 * 产物层断言（build 之后）见 `scripts/check-boundaries.mjs`；两层分工见 roadmap §3.10：
 * - 源码层：扫描 import 语句，挡住「错误依赖方向」进仓库；
 * - 产物层：扫描构建结果，确认主 chunk 真的不含 Director 代码。
 *
 * 硬规则（roadmap §3.1）：
 * 1. 主 chunk（App/main/shell）不得静态 import Director 模块（只允许 import type / lazy 动态 import）；
 * 2. src/studio/** 不得静态 import 旧 store / Director 模块（契约层只放类型与极薄运行时）；
 * 3. harness/team/**（M3 起）不得静态 import chatStore / loomStore（真执行不经 chat 单飞）；
 * 4. M0 腾挪后，简报/分享/总指挥必须走 React.lazy。
 */
import { describe, expect, it } from 'vitest'

const sources = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const sourceEntries = Object.entries(sources).filter(
  ([path]) => !path.includes('/__tests__/') && !path.endsWith('.d.ts'),
)

interface ImportRef {
  /** 解析后的绝对路径（/src/...）或包名 */
  resolved: string
  /** 原始写法（用于报错定位） */
  spec: string
  /** 该语句是否被 TS 完全擦除（import type / 全部 specifier 都是 type） */
  typeOnly: boolean
  /** 语句所在行号 */
  line: number
}

function isBraceTypeOnly(clause: string): boolean {
  const trimmed = clause.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false
  const inner = trimmed.slice(1, -1).trim()
  if (!inner) return false
  return inner
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .every((s) => /^type\s+\S/.test(s))
}

/** 提取静态 import / re-export；动态 import(...) 与 side-effect import 分开处理 */
function staticImports(code: string): ImportRef[] {
  const refs: ImportRef[] = []
  const re = /\b(import|export)\s+(?!type\b)([\s\S]*?)\s+from\s*['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    const clause = m[2]
    refs.push({
      spec: m[3],
      resolved: '',
      typeOnly: isBraceTypeOnly(clause),
      line: code.slice(0, m.index).split('\n').length,
    })
  }
  /* side-effect import：import './x.css'（无 from，ESM 里不会擦除） */
  const sideRe = /\bimport\s*['"]([^'"]+)['"]/g
  while ((m = sideRe.exec(code))) {
    refs.push({
      spec: m[1],
      resolved: '',
      typeOnly: false,
      line: code.slice(0, m.index).split('\n').length,
    })
  }
  return refs
}

/** 把相对 specifier 解析为 /src/... 绝对路径；包名原样返回 */
function resolveSpecifier(fromPath: string, spec: string): string {
  if (!spec.startsWith('.')) return spec
  const baseParts = fromPath.slice(0, fromPath.lastIndexOf('/')).split('/').filter(Boolean)
  for (const seg of spec.split('/')) {
    if (seg === '.' || seg === '') continue
    if (seg === '..') baseParts.pop()
    else baseParts.push(seg)
  }
  return `/${baseParts.join('/')}`
}

function importsOf(path: string): ImportRef[] {
  return staticImports(sources[path]).map((r) => ({ ...r, resolved: resolveSpecifier(path, r.spec) }))
}

const isMainShellFile = (path: string): boolean =>
  path === '/src/App.tsx' || path === '/src/main.tsx' || path.startsWith('/src/shell/')

const DIRECTOR_MODULE_PREFIXES = ['/src/apps/director', '/src/harness/director', '/src/harness/team', '/src/stores/missionStore']

describe('chunk 边界（源码层）', () => {
  it('主 chunk（App/main/shell）不静态 import Director 模块', () => {
    const violations: string[] = []
    for (const [path] of sourceEntries) {
      if (!isMainShellFile(path)) continue
      for (const ref of importsOf(path)) {
        if (ref.typeOnly) continue
        if (DIRECTOR_MODULE_PREFIXES.some((p) => ref.resolved.startsWith(p))) {
          violations.push(`${path}:${ref.line} → ${ref.spec}`)
        }
      }
    }
    expect(violations, `以下静态 import 会把 Director 代码拉进主 chunk：\n${violations.join('\n')}`).toEqual([])
  })

  it('src/studio/** 不静态 import 旧 store / Director 模块（契约层只放类型与极薄运行时）', () => {
    /* v1.2 M1 登记例外：router.ts 是主 chunk 路由运行时，只允许读写新的 route 渲染缓存
       （stores/routeStore 是 §7.1 明确归主 chunk 的新 store，不是旧业务事实源）。 */
    const STUDIO_STORE_EXCEPTIONS: Record<string, string[]> = {
      '/src/studio/router.ts': ['/src/stores/routeStore'],
    }
    const violations: string[] = []
    for (const [path] of sourceEntries) {
      if (!path.startsWith('/src/studio/')) continue
      for (const ref of importsOf(path)) {
        if (ref.typeOnly) continue
        if (STUDIO_STORE_EXCEPTIONS[path]?.includes(ref.resolved)) continue
        if (
          ref.resolved.startsWith('/src/stores/') ||
          ref.resolved.startsWith('/src/apps/') ||
          DIRECTOR_MODULE_PREFIXES.some((p) => ref.resolved.startsWith(p))
        ) {
          violations.push(`${path}:${ref.line} → ${ref.spec}`)
        }
      }
    }
    expect(violations, `src/studio 不得依赖旧 store/Director 实现：\n${violations.join('\n')}`).toEqual([])
  })

  it('harness/team/**（M3 起）不静态 import chatStore / loomStore', () => {
    const violations: string[] = []
    for (const [path] of sourceEntries) {
      if (!path.startsWith('/src/harness/team/')) continue
      for (const ref of importsOf(path)) {
        if (ref.typeOnly) continue
        if (ref.resolved === '/src/stores/chatStore' || ref.resolved === '/src/stores/loomStore') {
          violations.push(`${path}:${ref.line} → ${ref.spec}`)
        }
      }
    }
    expect(violations, `真执行内核不得复用 chat 单飞/画布 store：\n${violations.join('\n')}`).toEqual([])
  })

  it('M0 腾挪：简报 / 分享 / 总指挥均走 React.lazy 动态入口', () => {
    const app = sources['/src/App.tsx']
    expect(app, 'App.tsx 应存在').toBeTruthy()
    expect(app).toContain("lazy(() => import('./apps/briefing/BriefingPage'))")
    expect(app).toContain("lazy(() => import('./apps/director/DirectorApp'))")
    expect(app).toContain("lazy(() => import('./apps/share/ShareView'))")
    /* 任何组件的静态 import 都会让 lazy 失效 */
    expect(app).not.toMatch(/import\s+BriefingPage\s+from\s+['"]\.\/apps/)
    expect(app).not.toMatch(/import\s+ShareView\s+from\s+['"]\.\/apps/)
    expect(app).not.toMatch(/import\s+DirectorApp\s+from\s+['"]\.\/apps/)
  })
})
