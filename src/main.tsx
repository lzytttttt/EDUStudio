import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './theme/tokens.css'
import { useSettingsStore } from './stores/settingsStore'

// 界面字号档位同步到 <html data-font>（v0.3 UI 专项：设置 → 界面字号）
function applyFontSize(): void {
  document.documentElement.dataset.font = useSettingsStore.getState().fontSize
}
applyFontSize()
useSettingsStore.subscribe(applyFontSize)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
