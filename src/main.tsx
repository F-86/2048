import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

const container = document.getElementById('root')
if (!container) throw new Error('找不到 #root 挂载点')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

/**
 * 注册 Service Worker 以支持离线运行。
 * 只在生产构建中启用：开发时它会缓存旧资源，干扰热更新。
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // BASE_URL 让子路径部署（如 GitHub Pages）也能正确注册
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // 注册失败不影响游戏本身，静默忽略
    })
  })
}
