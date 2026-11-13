/**
 * v0.4 M3③：包体预算门禁。
 * - 主 chunk（index-*.js）gzip ≤ 120KB（阈值不抬，逼近时走懒加载）
 * - 全部 JS gzip ≤ 360KB（v1.2 M1 实测重校；见下方校准注释）
 * - Director 相关 chunk 合计 gzip ≤ 50KB（v1.2 门槛；M1 起按 chunk 拆分求和，超限拆 runner）
 * 超限 exit 1，CI 中作为 build 后门禁执行。
 */
import { gzipSync } from 'node:zlib'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const BUDGET = {
  mainChunkKB: 120, // 主 chunk gzip 上限（v1.2 M1 实测 106.9KB，余量 ~13KB 留给 M2 收件箱/交付物接线）
  // v0.6 校准：v0.5.2 基线实测 238.6KB（recharts 懒加载 chunk 即占 105KB），230KB 阈值自 v0.4 沿袭未随
  // vendor 拆分与图表库引入重校，属存量潜伏超限；按基线 + v0.6 增量（约 7KB）+ 余量校准为 250KB
  // v0.8 校准：v0.7 简报交互/落章/专注模式 + v0.8 数据上下文层与 LLM 技能提炼（合计约 +9KB 业务代码，
  // 无新依赖，recharts 懒加载 chunk 不变），按实测 258.6KB + 余量校准为 260KB
  // v0.8.4 校准：v0.8.3 follow-up 打磨（+2.9KB，交付时未随重校，存量潜伏超限）+ v0.8.4 简报自定义
  // 重新生成弹窗（+3.2KB 业务代码，无新依赖），按实测 266.1KB + 余量校准为 270KB
  // v0.9.3 校准：v0.9.2 后 P0 生成即见 + P1 演示直达/向导常驻 + P2 节流与持久化改造合计 +11KB
  //（无新依赖，react-icons 已移除），实测 277.1KB，按基线 + 余量校准 270 → 285KB
  // v0.9.4 校准：Loom 空间任务台（数据模型 / 图算法 / 画布交互 / 拓扑串行执行 / Trace 投影 + 简报空间化）
  // 合计 +16.6KB（零新依赖）；其中画布 UI 与 runner 已整体懒加载（LoomPanel chunk 11.4KB，主 chunk 116.9KB
  // 仍守 120KB），业务侧新增的 store / 图算法随主 chunk 进入总包，实测 293.7KB，按实测 + 余量校准 285 → 295KB
  // v0.9.4-03 校准：画布真实接入 LLM 修复（非执行节点过滤 / 文档节点接线 / 上游穿透与注入 / function-calling
  // 补 plan / 降级可见）合计 +1.7KB（零新依赖，主 chunk 117.9KB 仍守 120KB），实测 295.4KB，
  // 按实测 + 余量校准 295 → 297KB
  // v0.9.5 校准：报告按数据渲染 + 12 所演示数据 + 数字溯源标注 + 任务链接入工具集，合计约 +4KB 业务代码；
  // OOXML 导出（src/lib/ooxml.ts，zip STORE 手写封装）为新增 lib，约 +3KB。两者均为零新依赖，
  // recharts 懒加载 chunk 不变。基线实测 295.8KB（主 chunk 118.4KB），按实测 + 余量校准 297 → 310KB。
  // v1.0 预览校准：总指挥模式（Director 原型）整体为独立 lazy chunk（DirectorApp 17.3KB gzip，
  // 含 3 屏 + Mock 编排 + 引导层；其 CSS 独立 1.1KB 不计入 JS 口径），另新增 e2e/store 用例但无新依赖；
  // 主 chunk 仍 119.3 / 120KB。全 JS 实测 323.2KB，按实测 + 余量校准 310 → 330KB。
  // v1.1 校准：原型加固（真 LLM 拆解 planner/validate/facts/verifyCitations + 状态持久化 +
  // 第二剧本模板化 data + 视觉/引导收口），全部新增代码随总指挥模式独立 lazy chunk 进入
  //（DirectorApp 17.4 → 33.9KB gzip；主 chunk 119.5 / 120KB 不动，未抬阈值）；零新依赖。
  // 全 JS 实测 340.04KB，按实测 + 余量校准 330 → 342KB。
  // v1.2 M0 校准：BriefingPage（17.2KB gzip）/ ShareView（3.8KB gzip）改为 lazy chunk 腾主 chunk 预算，
  // 主 chunk 119.5 → 102.1KB（腾出 17.7KB，M1 外壳/契约有地方放）；拆分本身带来 chunk 边界开销，
  // 全 JS 340.0 → 343.2KB（净 +2.9KB，非业务增量），按实测 + 余量校准 342 → 348KB。
  // v1.2 M1 校准：统一外壳（ShellLayout/ShellChrome/WorkspaceSwitcher/IntentBar）+ 路由运行时 +
  // CommandCenter（三视图经 SurfaceHost 再拆一级懒加载，DirectorApp 由整块 33.9KB 拆成
  // director 共享 23.8 + Inbox/Mission/TeamSurface 4.9/5.4/3.0 + Commander 2.0 等 chunk），
  // 主 chunk 102.1 → 106.9KB（+4.8，契约/壳/路由进主包）；全 JS 343.2 → 355.8KB
  //（+12.6，M1 新增外壳与容器 + 二级拆分开销），按实测 + 余量校准 348 → 360KB。
  // v1.2 M2 校准：实体融合（统一收件箱/digest 运行时、简报采纳同源待办、交付物入 artifactStore +
  // 作战包分组、uiStore 统一 toast、Agent 记忆命名空间、右栏只读团队 tab、settings.studio），
  // 主 chunk 106.9 → 113.4KB（+6.5：两个运行时 store + toast/团队摘要 + 设置分组进主包）；
  // 全 JS 355.8 → 364.9KB（+9.1：交付物发布桥 + 收件箱/团队/作战包 UI + 记忆/toast 逻辑），
  // 按实测 + 余量校准 360 → 370KB。主 chunk 仅剩 6.6KB 余量：M3 真执行内核必须留在 Director chunk，
  // 主 chunk 只允许「契约 + 薄运行时」，否则 M3 收口时需先懒加载腾挪再抬阈值（阈值仍不直接抬 120）。
  // v1.2 M3 校准：真执行内核（MissionRunner + AgentSpec + 审批门统一 + 执行控制器 + 交付物证据校验
  // + 统一决策卡），主 chunk 113.4 → 114.8KB（+1.4：gateRegistry 等共享运行时）；
  // Director 主体因 runner 拆独立 chunk 由 52.1 → 48.1KB（守 50 门槛）；runner/agents 独立懒加载
  // chunk 合计 5.7KB（新增 runnerChunkKB 门槛 12KB）；全 JS 364.9 → 377.8KB（+12.9：内核/校验/卡片 +
  // 拆分开销），按实测 + 余量校准 370 → 386KB。
  // 警告：主 chunk 仅余 5.2KB——M4 迁移/引导切换必须以「懒加载 + 复用」实现，不得再把重代码塞回主包。
  totalJsKB: 386, // 全部 JS gzip 上限
  directorChunkKB: 50, // Director 相关 chunk 合计 gzip 上限（v1.2 真执行/bridge 预算；超限拆 runner）
  /** Director chunk 归组（M1 起：DirectorApp 整块被拆分为容器/三视图/共享模块，gate 按合计口径） */
  directorChunkPattern: /^(DirectorApp|director|CommandCenter|InboxView|MissionView|TeamView|InboxSurface|MissionSurface|TeamSurface|GuideBar|ArtifactSheet)-.*\.js$/,
  /** v1.2 M3：真执行内核独立懒加载 chunk（runner 拆出后单独设门槛，防止内核膨胀悄悄挤占 Director 主体） */
  runnerChunkKB: 12,
  runnerChunkPattern: /^(runner|agents)-.*\.js$/,
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
  let director = 0
  let directorChunks = 0
  let runner = 0
  let runnerChunks = 0
  const rows = []
  for (const f of files) {
    const gz = gzipSync(readFileSync(join(dist, f))).length
    total += gz
    if (/^index-.*\.js$/.test(f)) main = Math.max(main, gz)
    if (BUDGET.directorChunkPattern.test(f)) {
      director += gz
      directorChunks += 1
    }
    if (BUDGET.runnerChunkPattern.test(f)) {
      runner += gz
      runnerChunks += 1
    }
    rows.push({ f, gz })
  }

  rows.sort((a, b) => b.gz - a.gz)
  for (const { f, gz } of rows) console.log(`  ${f.padEnd(40)} ${kb(gz)} KB (gzip)`)

  const mainOk = main <= BUDGET.mainChunkKB * 1024
  const totalOk = total <= BUDGET.totalJsKB * 1024
  const directorOk = directorChunks > 0 && director <= BUDGET.directorChunkKB * 1024
  const runnerOk = runnerChunks > 0 && runner <= BUDGET.runnerChunkKB * 1024
  console.log('')
  console.log(`主 chunk gzip: ${kb(main)} KB / 预算 ${BUDGET.mainChunkKB} KB  ${mainOk ? 'PASS' : 'FAIL'}`)
  console.log(`全部 JS  gzip: ${kb(total)} KB / 预算 ${BUDGET.totalJsKB} KB  ${totalOk ? 'PASS' : 'FAIL'}`)
  console.log(
    `Director 相关 chunk gzip: ${kb(director)} KB（${directorChunks} 个）/ 预算 ${BUDGET.directorChunkKB} KB  ${
      directorOk ? 'PASS' : 'FAIL'
    }`,
  )
  console.log(
    `真执行内核 chunk gzip: ${kb(runner)} KB（${runnerChunks} 个，懒加载）/ 预算 ${BUDGET.runnerChunkKB} KB  ${
      runnerOk ? 'PASS' : 'FAIL'
    }`,
  )

  if (!mainOk || !totalOk || !directorOk || !runnerOk) process.exit(1)
} catch (err) {
  console.error(`[budget] 执行失败：${err.message}`)
  process.exit(1)
}
