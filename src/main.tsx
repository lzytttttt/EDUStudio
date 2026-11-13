import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './theme/tokens.css'
import { useAuthStore } from './stores/authStore'
import { useSettingsStore, flushSettingsPersist } from './stores/settingsStore'
import { useNotificationStore } from './stores/notificationStore'
import { flushArtifactPersist } from './stores/artifactStore'
import { planEntry } from './lib/entryPlan'
import { startStudioRouting } from './studio/router'
import { installTelemetry } from './lib/telemetry'

// 界面外观同步（v0.6.1 评审修订）：字号全局生效——
// ① 根字号缩放：html font-size = 16 × 档位/14，全部 rem 类文字（侧边栏/顶栏/抽屉/徽标等）随动；
// ② 阅读区 --content-fs 精确等于档位 px（对话气泡/文档/编辑器）；
// ③ ≥18px 记为超大档（隐藏次要信息）。
function applyAppearance(): void {
  const s = useSettingsStore.getState()
  const root = document.documentElement
  root.style.fontSize = `${((16 * s.fontSize) / 14).toFixed(3)}px`
  root.style.setProperty('--content-fs', `${s.fontSize}px`)
  root.dataset.font = s.fontSize >= 18 ? 'xlarge' : 'medium'
}
applyAppearance()
useSettingsStore.subscribe(applyAppearance)

// 合并写盘兜底（v0.9.3 P2-A②）：正文编辑 / 字号 / 栏宽在 300ms 窗口内合并写出，
// 页面隐藏（切标签、锁屏、最小化）或退出前强制 flush，保证不丢最后一笔变更
function flushPersist(): void {
  flushArtifactPersist()
  flushSettingsPersist()
  // v1.1 总指挥模式状态（M2）：导演模块是独立 lazy chunk，载入后把同步 flush 挂到 window；
  // 主 chunk 不静态 import 导演数据，避免把懒加载 chunk 的代码拉回主包（预算 ≤120KB）
  const flushDirector = (window as Window & { __edustudioFlushDirector?: () => void }).__edustudioFlushDirector
  flushDirector?.()
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushPersist()
})
window.addEventListener('pagehide', flushPersist)

// 前端错误上报（v0.5 M4⑤）：全局 error / unhandledrejection 采样上报轻后端
installTelemetry()

// 入口直达（v1.2 M0 P0-1/P0-2/P0-3 + M1 ?v2=1）：入口判定在 lib/entryPlan.ts（纯函数），这里只应用副作用。
// 分享路由（#share=）优先且不参与；`?v1=1` 不再写旧引导已读位、不覆盖已有校/局身份，
// command 阶段由 authStore 保证不落盘，之后无参数冷启动回到角色合法阶段。
// `?v2=1`：统一工作区（影子期），启动路由运行时（URL → routeStore + popstate 回灌）。
const entry = planEntry(window.location.search, window.location.hash, useAuthStore.getState().role)
const auth = useAuthStore.getState()
if (entry.loginRole) auth.login(entry.loginRole)
if (entry.kind === 'studio') {
  startStudioRouting()
} else if (entry.stage) {
  auth.setStage(entry.stage)
}
/* `?demo=1` 保持旧行为：已登录时回简报 */
else if (entry.kind === 'demo' && !entry.loginRole) auth.setStage('briefing')
if (entry.markGuideSeen) useSettingsStore.getState().markGuideSeen()
if (entry.notice) useNotificationStore.getState().push({ kind: 'system', ...entry.notice })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
