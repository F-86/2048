/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  /*
   * 部署到 GitHub Pages 时页面在 /2048/ 子路径下，需要给资源加前缀；
   * 本地开发与预览仍用根路径。用 `vite build --mode pages` 触发。
   */
  base: mode === 'pages' ? '/2048/' : '/',
  plugins: [react()],
  server: {
    port: 5173,
    // 监听全部网卡，便于手机在同一 WiFi 下访问
    host: true,
  },
  test: {
    // 组件测试需要 DOM；纯逻辑测试在 jsdom 下同样能跑
    environment: 'jsdom',
  },
}))
