/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  build: {
    rollupOptions: {
      output: {
        // v0.4 M4①：vendor 拆分——框架/图标独立分包，业务迭代不再打爆长缓存
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|zustand)[\\/]/.test(id)) return 'vendor-react'
          /* v0.9.3 P2-A④：移除未使用的 react-icons（分组仅剩 lucide-react） */
          if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return 'vendor-icons'
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})
