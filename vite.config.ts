/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  test: {
    // 组件测试需要 DOM；纯逻辑测试在 jsdom 下同样能跑
    environment: 'jsdom',
  },
})
