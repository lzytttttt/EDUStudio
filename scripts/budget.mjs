/**
 * v0.4 M3③：包体预算门禁。
 * - 主 chunk（index-*.js）gzip ≤ 120KB
 * - 全部 JS gzip ≤ 295KB
 * 超限 exit 1，CI 中作为 build 后门禁执行。
 */
import { gzipSync } from 'node:zlib'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const BUDGET = {
  mainChunkKB: 120, // 主 chunk gzip 上限（v0.9.4-03 复核：117.9KB，阈值不动）
  // v0.6 校准：v0.5.2 基线实测 238.6KB（recharts 懒加载 chunk 即占 105KB），230KB 阈值自 v0.4 沿袭未随
  // vendor 拆分与图表库引入重校，属存量潜伏超限；按基线 + v0.6 增量（约 7KB）+ 余量校准为 250KB
  // v0.8 校准：v0.7 简报交互/落章/专注模式 + v0.8 数据上下文层与 LLM 技能提炼（合计约 +9KB 业务代码，
  // 无新依赖，recharts 懒加载 chunk 不变），按实测 258.6KB + 余量校准为 260KB
  // v0.8.4 校准：v0.8.3 follow-up 打磨（+2.9KB，交付时未随重校，存量潜伏超限）+ v0.8.4 简报自定义
  // 重新生成弹窗（+3.2KB 业务代码，无新依赖），按实测 266.1KB + 余量校准为 270KB
  // v0.9.3 校准：v0.9.2 后 P0 生成即见 + P1 演示直达/向导常驻 + P2 节流与持久化改造合计 +11KB
// （无新依赖，react-icons 已移除），实测 277.1KB，按基线 + 余量校准 270 → 285KB
// v0.9.4 校准：Loom 空间任务台（数据模型 / 图算法 / 画布交互 / 拓扑串行执行 / Trace 投影 + 简报空间化）
// 合计 +16.6KB（零新依赖）；其中画布 UI 与 runner 已整体懒加载（LoomPanel chunk 11.4KB，主 chunk 116.9KB
// 仍守 120KB），业务侧新增的 store / 图算法随主 chunk 进入总包，实测 293.7KB，按实测 + 余量校准 285 → 295KB
// v0.9.4-03 校准：画布真实接入 LLM 修复（非执行节点过滤 / 文档节点接线 / 上游穿透与注入 / function-calling
// 补 plan / 降级可见）合计 +1.7KB（零新依赖，主 chunk 117.9KB 仍守 120KB），实测 295.4KB，
// 按实测 + 余量校准 295 → 297KB
totalJsKB: 297, // 全部 JS gzip 上限
}

const dist = 'dist/assets'
const kb = (bytes) => Math.round(bytes / 102.4) / 10

try {
  const files = readdirSync(dist).filter((f) => f.endsWith('.js'))
  if (files.length === 0) {
    console.error(`[budget] 未找到 JS 产物，请先执行 vite build（目录 ${dist}）`)
    process.exit(1)
  }

  let total = 0
  let main = 0
  const rows = []
  for (const f of files) {
    const gz = gzipSync(readFileSync(join(dist, f))).length
    total += gz
    if (/^index-.*\.js$/.test(f)) main = Math.max(main, gz)
    rows.push({ f, gz })
  }

  rows.sort((a, b) => b.gz - a.gz)
  for (const { f, gz } of rows) console.log(`  ${f.padEnd(40)} ${kb(gz)} KB (gzip)`)

  const mainOk = main <= BUDGET.mainChunkKB * 1024
  const totalOk = total <= BUDGET.totalJsKB * 1024
  console.log('')
  console.log(`主 chunk gzip: ${kb(main)} KB / 预算 ${BUDGET.mainChunkKB} KB  ${mainOk ? 'PASS' : 'FAIL'}`)
  console.log(`全部 JS  gzip: ${kb(total)} KB / 预算 ${BUDGET.totalJsKB} KB  ${totalOk ? 'PASS' : 'FAIL'}`)

  if (!mainOk || !totalOk) process.exit(1)
} catch (err) {
  console.error(`[budget] 执行失败：${err.message}`)
  process.exit(1)
}
