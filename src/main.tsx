import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './theme/tokens.css'
import { useAuthStore } from './stores/authStore'
import { useSettingsStore, flushSettingsPersist } from './stores/settingsStore'
import { flushArtifactPersist } from './stores/artifactStore'
import { isDemoEntry } from './lib/demoEntry'
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
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushPersist()
})
window.addEventListener('pagehide', flushPersist)

// 前端错误上报（v0.5 M4⑤）：全局 error / unhandledrejection 采样上报轻后端
installTelemetry()

// 演示直达（v0.9.3 P1-B②）：`?demo=1` 在渲染前完成「跳过引导 + 自动登录 + 直达简报」，
// 避免冷启动先闪一帧登录页；分享路由（#share=）优先级更高，不参与直达
if (!window.location.hash.startsWith('#share=') && isDemoEntry(window.location.search)) {
  useSettingsStore.getState().markGuideSeen()
  const auth = useAuthStore.getState()
  if (auth.role) auth.setStage('briefing')
  else auth.login('teacher')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
