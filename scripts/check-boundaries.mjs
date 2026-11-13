/**
 * v1.2 M0：产物层 chunk 边界检查（build 之后、budget 同一步执行）。
 *
 * 为什么不在 npm test 里读 dist：build 脚本是 `vitest run && tsc -b && vite build`，
 * 单测阶段 dist 可能尚未生成或来自上一次构建，会把「构建依赖成环」带进 CI。
 * 因此源码层边界由 src/__tests__/chunkBoundary.test.ts 保证，产物层由本脚本在 build 后必跑。
 *
 * 断言：
 * 1. 主 chunk（index-*.js）不含 Director 专属标记（testid 前缀），说明 Director 不在主包；
 * 2. 主 chunk 对 DirectorApp / BriefingPage / ShareView 只有动态 import（import("...")），
 *    没有静态 import/from（静态引入会把它们的代码并回主 chunk）；
 * 3. 三个懒加载 chunk 产物均存在；
 * 4. index.html 不预加载 DirectorApp 等懒 chunk（避免首屏被拉回主路径）。
 *
 * 用法：node scripts/check-boundaries.mjs（CI 在 vite build 之后、budget 同一步跑）
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ASSETS = 'dist/assets'
const LAZY_PREFIXES = ['DirectorApp', 'BriefingPage', 'ShareView']
/** Director 专属 testid/类名标记：出现在主 chunk 即说明 Director 被静态打进主包 */
const DIRECTOR_MARKERS = ['director-dock-', 'director-toasts', 'director-inbox', 'mission-plan', 'team-autonomy-']

const failures = []
const pass = (msg) => console.log(`  PASS  ${msg}`)
const fail = (msg) => {
  failures.push(msg)
  console.log(`  FAIL  ${msg}`)
}

try {
  if (!existsSync(ASSETS)) {
    console.error(`[boundaries] 未找到 ${ASSETS}，请先执行 vite build`)
    process.exit(1)
  }

  const files = readdirSync(ASSETS)
  const jsFiles = files.filter((f) => f.endsWith('.js'))
  const indexFiles = jsFiles.filter((f) => /^index-.*\.js$/.test(f))
  if (indexFiles.length !== 1) {
    console.error(`[boundaries] 期望恰好 1 个主 chunk（index-*.js），实际 ${indexFiles.length} 个`)
    process.exit(1)
  }
  const mainFile = indexFiles[0]
  const main = readFileSync(join(ASSETS, mainFile), 'utf8')
  console.log(`[boundaries] 主 chunk = ${mainFile}（${(main.length / 1024).toFixed(1)} KB raw）`)

  /* 1. 主 chunk 不得含 Director 专属标记 */
  const leaked = DIRECTOR_MARKERS.filter((m) => main.includes(m))
  if (leaked.length === 0) pass('主 chunk 不含 Director 专属标记（Director 未进主包）')
  else fail(`主 chunk 泄漏 Director 标记：${leaked.join(', ')}`)

  /* 2. 三个懒加载入口只允许动态 import */
  for (const prefix of LAZY_PREFIXES) {
    const staticImport = new RegExp(`from\\s*["']\\./${prefix}-`)
    const dynamicImport = new RegExp(`import\\(\\s*["']\\./${prefix}-`)
    if (staticImport.test(main)) fail(`${prefix} 被主 chunk 静态 import（应 lazy）`)
    else if (!dynamicImport.test(main)) fail(`主 chunk 未发现 ${prefix} 的动态 import（懒加载入口缺失）`)
    else pass(`${prefix} 仅通过动态 import 加载`)
  }

  /* 3. 懒加载 chunk 产物存在（缺一个就说明入口被内联/改名） */
  for (const prefix of LAZY_PREFIXES) {
    const chunk = jsFiles.find((f) => new RegExp(`^${prefix}-.*\\.js$`).test(f))
    if (chunk) pass(`懒加载产物存在：${chunk}`)
    else fail(`缺少懒加载产物 ${prefix}-*.js`)
  }

  /* 4. index.html 不得预加载懒 chunk */
  if (existsSync('dist/index.html')) {
    const html = readFileSync('dist/index.html', 'utf8')
    const preloaded = LAZY_PREFIXES.filter((p) => new RegExp(`${p}-[\\w-]+\\.js`).test(html))
    if (preloaded.length === 0) pass('index.html 未预加载懒 chunk')
    else fail(`index.html 预加载了懒 chunk：${preloaded.join(', ')}`)
  } else {
    fail('缺少 dist/index.html')
  }
} catch (err) {
  console.error(`[boundaries] 执行失败：${err.message}`)
  process.exit(1)
}

if (failures.length > 0) {
  console.error(`\n[boundaries] ${failures.length} 项断言失败`)
  process.exit(1)
}
console.log('\n[boundaries] 全部通过')
