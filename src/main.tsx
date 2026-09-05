import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './theme/tokens.css'
import { useSettingsStore } from './stores/settingsStore'
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

// 前端错误上报（v0.5 M4⑤）：全局 error / unhandledrejection 采样上报轻后端
installTelemetry()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
