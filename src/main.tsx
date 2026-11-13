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
import { startStudioRouting, goRoute } from './studio/router'
import { startStudioInboxSources } from './stores/studioInboxStore'
import { startStudioDigestRuntime } from './stores/studioDigestStore'
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

// v1.2 M2：统一收件箱 / 只读投影运行时（事件驱动，主 chunk 薄运行时）。
// 默认会话也启动（只派生计数，不产生视觉变化），供侧栏角标 / 顶栏收件箱 / 右栏团队摘要共用同一口径。
startStudioDigestRuntime()
startStudioInboxSources()

// 入口直达（v1.2 M0 P0-1/P0-2/P0-3 + M1 ?v2=1 + M4 默认期）：入口判定在 lib/entryPlan.ts（纯函数），这里只应用副作用。
// 分享路由（#share=）优先且不参与；`?v1=1` 不写旧引导已读位、不覆盖已有校/局身份；
// M4 起：teacher 无参数默认统一壳（战情台）；`?v1=1` 重定向新战情台；`?v1=1&legacy=1` 旧整屏只读；
// `?legacy=1` / `?stage=` 保留旧壳回归能力；`?demo=1` 行为不变。
const entry = planEntry(
  window.location.search,
  window.location.hash,
  useAuthStore.getState().role,
  useSettingsStore.getState().studio,
)
const auth = useAuthStore.getState()
if (entry.loginRole) auth.login(entry.loginRole)
if (entry.kind === 'studio' || entry.kind === 'directorRedirect') {
  /* M4：`?v1=1` 旧整屏映射到新战情台：先规范化 URL（去 v1、补 v2=1），再启动路由后落到战情台 */
  if (entry.kind === 'directorRedirect') {
    const url = new URL(window.location.href)
    url.searchParams.delete('v1')
    url.searchParams.set('v2', '1')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }
  startStudioRouting()
  const params = new URLSearchParams(window.location.search)
  const hasExplicitRoute = ['view', 'id', 'task', 'agent', 'tab'].some((key) => params.has(key))
  if (!hasExplicitRoute) {
    /* 默认期冷启动：teacher → 战情台（设置 landing=inbox/auto 时；briefing/workbench 已在入口计划走旧壳） */
    const landing = entry.studioLanding ?? 'inbox'
    if (landing === 'inbox') goRoute({ workspace: 'director', directorView: 'inbox' }, { replace: true })
    else if (landing === 'briefing') goRoute({ workspace: 'classic', target: { kind: 'briefing' } }, { replace: true })
    else goRoute({ workspace: 'classic', classicView: 'chat' }, { replace: true })
  }
} else if (entry.kind === 'legacyStage' && entry.stage) {
  auth.setStage(entry.stage)
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
