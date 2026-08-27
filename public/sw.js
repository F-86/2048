/**
 * Service Worker：让游戏在断网时也能打开。
 *
 * 策略很简单，因为这是个纯静态、无后端的小游戏：
 * - 安装时预缓存全部资源（App Shell）
 * - 导航请求走「网络优先，失败回退缓存」，保证有网时能拿到新版本
 * - 其余同源资源走「缓存优先」，命中即返回，未命中再去网络并顺手缓存
 *
 * 版本号变化时会清掉旧缓存。构建产物带 hash 文件名，
 * 所以每次发布新版本需要同步改 CACHE_VERSION。
 */

const CACHE_VERSION = 'v1'
const CACHE_NAME = `react-2048-${CACHE_VERSION}`

/** 预缓存清单。BASE 由构建时注入，兼容部署在子路径（如 GitHub Pages）的情况 */
const BASE = new URL(self.registration.scope).pathname

const PRECACHE = [
  BASE,
  `${BASE}index.html`,
  `${BASE}manifest.webmanifest`,
  `${BASE}favicon-32.png`,
  `${BASE}icon-192.png`,
  `${BASE}icon-512.png`,
  `${BASE}apple-touch-icon.png`,
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      // 逐个添加：单个资源失败不应导致整个安装失败
      await Promise.allSettled(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' }))))
      // 立即接管，不等旧 SW 释放
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 清理旧版本缓存
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((k) => k.startsWith('react-2048-') && k !== CACHE_NAME).map((k) => caches.delete(k)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // 只处理 GET 的同源请求，其余交给浏览器默认行为
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // 导航请求：网络优先，断网时回退到缓存的 index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request)
          const cache = await caches.open(CACHE_NAME)
          cache.put(`${BASE}index.html`, fresh.clone())
          return fresh
        } catch {
          const cached = await caches.match(`${BASE}index.html`)
          return cached ?? Response.error()
        }
      })(),
    )
    return
  }

  // 其余资源：缓存优先，未命中则取网络并缓存
  event.respondWith(
    (async () => {
      const cached = await caches.match(request)
      if (cached) return cached
      try {
        const fresh = await fetch(request)
        // 只缓存成功的基本响应，避免把错误页存进去
        if (fresh.ok && fresh.type === 'basic') {
          const cache = await caches.open(CACHE_NAME)
          cache.put(request, fresh.clone())
        }
        return fresh
      } catch {
        return Response.error()
      }
    })(),
  )
})
