/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 轻后端代理地址（静态托管构建变量，如 https://edustudio-proxy.<account>.workers.dev/v1）；缺省 = 直连模式 */
  readonly VITE_PROXY_URL?: string
  /** 远端数据源地址覆盖；缺省时由 VITE_PROXY_URL 推导为 <proxy>/api/sources */
  readonly VITE_SOURCE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
