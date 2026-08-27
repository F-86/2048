import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Service Worker 测试。
 *
 * sw.js 跑在 ServiceWorkerGlobalScope 里，无法直接 import。
 * 这里读取源码、用假的全局环境执行它，捕获注册的事件处理器后逐个驱动，
 * 从而验证缓存与回退逻辑真的按预期工作（而不是只检查文件存在）。
 */

const SW_SOURCE = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8')

const SCOPE = 'https://example.com/2048/'

/** 极简 Cache 假实现，按 URL 字符串存取。fetch 由外部注入，避免真的发网络请求 */
class FakeCache {
  store = new Map<string, Response>()

  constructor(private fetchImpl: (url: string) => Promise<Response>) {}

  async add(request: { url: string } | string) {
    const url = typeof request === 'string' ? request : request.url
    const absolute = new URL(url, SCOPE).href
    const res = await this.fetchImpl(absolute)
    if (!res.ok) throw new Error('add 失败: ' + absolute)
    this.store.set(absolute, res)
  }

  async put(request: { url: string } | string, response: Response) {
    const url = typeof request === 'string' ? request : request.url
    this.store.set(new URL(url, SCOPE).href, response)
  }

  async match(request: { url: string } | string) {
    const url = typeof request === 'string' ? request : request.url
    return this.store.get(new URL(url, SCOPE).href)
  }

  async keys() {
    return [...this.store.keys()].map((url) => ({ url }))
  }
}

interface SwEnv {
  handlers: Record<string, (event: unknown) => void>
  caches: Map<string, FakeCache>
  skipWaiting: ReturnType<typeof vi.fn>
  claim: ReturnType<typeof vi.fn>
  deleted: string[]
}

/** 在假的 SW 全局环境里执行 sw.js，返回捕获到的处理器与副作用记录 */
function loadSw(fetchImpl: (url: string) => Promise<Response>): SwEnv {
  const handlers: Record<string, (event: unknown) => void> = {}
  const cacheMap = new Map<string, FakeCache>()
  const deleted: string[] = []
  const skipWaiting = vi.fn(async () => undefined)
  const claim = vi.fn(async () => undefined)

  const cachesApi = {
    async open(name: string) {
      if (!cacheMap.has(name)) cacheMap.set(name, new FakeCache(fetchImpl))
      return cacheMap.get(name)!
    },
    async keys() {
      return [...cacheMap.keys()]
    },
    async delete(name: string) {
      deleted.push(name)
      return cacheMap.delete(name)
    },
    async match(request: { url: string } | string) {
      for (const c of cacheMap.values()) {
        const hit = await c.match(request)
        if (hit) return hit
      }
      return undefined
    },
  }

  const self = {
    registration: { scope: SCOPE },
    location: { origin: 'https://example.com' },
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      handlers[type] = fn
    },
    skipWaiting,
    clients: { claim },
    caches: cachesApi,
  }

  // sw.js 里直接使用 self / caches / fetch / Request / Response / URL
  // Request 与 URL 需要包一层：sw.js 传的是 /2048/ 这类相对路径，需要补上 origin
  const BaseRequest = class {
    url: string
    method: string
    constructor(input: string | { url: string }, init: { method?: string } = {}) {
      const raw = typeof input === 'string' ? input : input.url
      this.url = new URL(raw, SCOPE).href
      this.method = init.method ?? 'GET'
    }
  }
  const BaseUrl = class extends URL {
    constructor(input: string, base?: string) {
      super(input, base ?? SCOPE)
    }
  }

  const fn = new Function(
    'self',
    'caches',
    'fetch',
    'Request',
    'Response',
    'URL',
    'Promise',
    SW_SOURCE,
  )
  fn(
    self,
    cachesApi,
    (input: { url: string } | string) =>
      fetchImpl(typeof input === 'string' ? new URL(input, SCOPE).href : input.url),
    BaseRequest,
    Response,
    BaseUrl,
    Promise,
  )

  return { handlers, caches: cacheMap, skipWaiting, claim, deleted }
}

/** 构造 install/activate 事件，收集 waitUntil 的 promise 以便等待 */
function lifecycleEvent() {
  const waits: Promise<unknown>[] = []
  return {
    event: { waitUntil: (p: Promise<unknown>) => waits.push(p) },
    settle: () => Promise.all(waits),
  }
}

/** 构造 fetch 事件，捕获 respondWith 的响应 */
function fetchEvent(url: string, init: { mode?: string; method?: string } = {}) {
  let responded: Promise<Response> | null = null
  // Request.mode 是只读的，用普通对象模拟请求，只暴露 sw.js 用到的字段
  const request = {
    url,
    method: init.method ?? 'GET',
    mode: init.mode ?? 'no-cors',
  }
  return {
    event: {
      request,
      respondWith: (p: Promise<Response>) => {
        responded = p
      },
    },
    get response() {
      return responded
    },
  }
}

/**
 * 默认的联网实现：所有请求成功。
 * 真实的同源 fetch 响应 type 为 'basic'，sw.js 靠它判断是否值得缓存，
 * 而 Response 的 type 是只读的，因此这里显式覆盖。
 */
function onlineFetch(body = 'ok') {
  return async (url: string) => {
    const res = new Response(body, { status: 200, headers: { 'x-url': url } })
    Object.defineProperty(res, 'type', { value: 'basic' })
    return res
  }
}

/** 构造一个同源成功响应（type='basic'，sw.js 据此决定是否缓存） */
function basicResponse(body: string) {
  const res = new Response(body, { status: 200 })
  Object.defineProperty(res, 'type', { value: 'basic' })
  return res
}

/** 断网实现：所有请求抛错 */
const offlineFetch = async (url: string) => {
  throw new Error('网络不可用: ' + url)
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('sw.js — 安装阶段', () => {
  it('预缓存首页、manifest 与图标', async () => {
    const env = loadSw(onlineFetch())
    const { event, settle } = lifecycleEvent()
    env.handlers.install(event)
    await settle()

    const cache = [...env.caches.values()][0]
    expect(cache).toBeDefined()
    const urls = [...cache.store.keys()]

    // 应包含首页、manifest 与三个尺寸的图标
    expect(urls.some((u) => u.endsWith('/2048/'))).toBe(true)
    expect(urls.some((u) => u.endsWith('index.html'))).toBe(true)
    expect(urls.some((u) => u.includes('manifest'))).toBe(true)
    expect(urls.some((u) => u.includes('icon-192'))).toBe(true)
    expect(urls.some((u) => u.includes('icon-512'))).toBe(true)
    expect(urls.some((u) => u.includes('apple-touch-icon'))).toBe(true)
  })

  it('缓存名带版本号，便于后续清理', async () => {
    const env = loadSw(onlineFetch())
    const { event, settle } = lifecycleEvent()
    env.handlers.install(event)
    await settle()
    const name = [...env.caches.keys()][0]
    expect(name).toMatch(/^react-2048-v\d+$/)
  })

  it('立即接管，不等旧 SW 释放', async () => {
    const env = loadSw(onlineFetch())
    const { event, settle } = lifecycleEvent()
    env.handlers.install(event)
    await settle()
    expect(env.skipWaiting).toHaveBeenCalled()
  })

  it('部分资源下载失败不会导致整个安装失败', async () => {
    // 只让 icon-512 失败，其余成功
    const env = loadSw(async (url: string) => {
      if (url.includes('icon-512')) throw new Error('404')
      return basicResponse('ok')
    })
    const { event, settle } = lifecycleEvent()
    env.handlers.install(event)
    // 不应抛错
    await expect(settle()).resolves.toBeDefined()
    const cache = [...env.caches.values()][0]
    // 其他资源仍被缓存
    expect(cache.store.size).toBeGreaterThan(3)
  })
})

describe('sw.js — 激活阶段', () => {
  it('清理旧版本缓存，保留当前版本', async () => {
    const env = loadSw(onlineFetch())
    // 先塞一个旧版本缓存
    env.caches.set('react-2048-v0', new FakeCache(onlineFetch()))
    const install = lifecycleEvent()
    env.handlers.install(install.event)
    await install.settle()

    const activate = lifecycleEvent()
    env.handlers.activate(activate.event)
    await activate.settle()

    expect(env.deleted).toContain('react-2048-v0')
    // 当前版本不应被删
    const current = [...env.caches.keys()].find((k) => k.endsWith('v1'))
    expect(env.deleted).not.toContain(current)
  })

  it('不动其他应用的缓存', async () => {
    const env = loadSw(onlineFetch())
    env.caches.set('别的应用-v1', new FakeCache(onlineFetch()))
    const activate = lifecycleEvent()
    env.handlers.activate(activate.event)
    await activate.settle()
    expect(env.deleted).not.toContain('别的应用-v1')
  })

  it('激活后接管已打开的页面', async () => {
    const env = loadSw(onlineFetch())
    const activate = lifecycleEvent()
    env.handlers.activate(activate.event)
    await activate.settle()
    expect(env.claim).toHaveBeenCalled()
  })
})

describe('sw.js — 导航请求（打开游戏）', () => {
  it('有网时走网络，并更新缓存的首页', async () => {
    const env = loadSw(onlineFetch('新版首页'))
    const install = lifecycleEvent()
    env.handlers.install(install.event)
    await install.settle()

    const ev = fetchEvent(SCOPE, { mode: 'navigate' })
    env.handlers.fetch(ev.event)
    const res = await ev.response!
    expect(await res.text()).toBe('新版首页')
  })

  it('断网时回退到缓存的首页 —— 这是离线可玩的关键', async () => {
    // 先在有网状态下安装并缓存
    let online = true
    const env = loadSw(async () => {
      if (!online) throw new Error('断网')
      return basicResponse('已缓存的首页')
    })
    const install = lifecycleEvent()
    env.handlers.install(install.event)
    await install.settle()

    // 断网后再请求导航
    online = false
    const ev = fetchEvent(SCOPE, { mode: 'navigate' })
    env.handlers.fetch(ev.event)
    const res = await ev.response!
    expect(res.type).not.toBe('error')
    expect(await res.text()).toBe('已缓存的首页')
  })

  it('断网且无缓存时返回错误响应而非抛异常', async () => {
    const env = loadSw(offlineFetch)
    const ev = fetchEvent(SCOPE, { mode: 'navigate' })
    env.handlers.fetch(ev.event)
    const res = await ev.response!
    expect(res.type).toBe('error')
  })
})

describe('sw.js — 静态资源请求', () => {
  it('缓存命中时直接返回，不走网络', async () => {
    const fetchSpy = vi.fn(async () => basicResponse('来自网络'))
    const env = loadSw(fetchSpy)
    const install = lifecycleEvent()
    env.handlers.install(install.event)
    await install.settle()
    const callsAfterInstall = fetchSpy.mock.calls.length

    // 请求一个已预缓存的资源
    const ev = fetchEvent(SCOPE + 'icon-192.png')
    env.handlers.fetch(ev.event)
    await ev.response!
    // 不应产生新的网络请求
    expect(fetchSpy.mock.calls.length).toBe(callsAfterInstall)
  })

  it('未缓存的资源走网络并顺手缓存（构建产物就靠这条）', async () => {
    const env = loadSw(onlineFetch('bundle 内容'))
    const install = lifecycleEvent()
    env.handlers.install(install.event)
    await install.settle()

    const jsUrl = SCOPE + 'assets/index-abc123.js'
    const ev = fetchEvent(jsUrl)
    env.handlers.fetch(ev.event)
    const res = await ev.response!
    expect(await res.text()).toBe('bundle 内容')

    // 已被写入缓存，下次断网也能取到
    const cache = [...env.caches.values()][0]
    const cached = await cache.match(jsUrl)
    expect(cached).toBeDefined()
  })

  it('断网且未缓存时返回错误响应', async () => {
    const env = loadSw(offlineFetch)
    const ev = fetchEvent(SCOPE + 'assets/missing.js')
    env.handlers.fetch(ev.event)
    const res = await ev.response!
    expect(res.type).toBe('error')
  })

  it('不拦截非 GET 请求', async () => {
    const env = loadSw(onlineFetch())
    const ev = fetchEvent(SCOPE + 'anything', { method: 'POST' })
    env.handlers.fetch(ev.event)
    // 未调用 respondWith，交给浏览器默认行为
    expect(ev.response).toBeNull()
  })

  it('不拦截跨域请求', async () => {
    const env = loadSw(onlineFetch())
    const ev = fetchEvent('https://其他站点.com/a.js')
    env.handlers.fetch(ev.event)
    expect(ev.response).toBeNull()
  })
})

describe('sw.js — 子路径部署', () => {
  it('缓存路径基于 registration.scope，适配 GitHub Pages 子路径', async () => {
    const env = loadSw(onlineFetch())
    const install = lifecycleEvent()
    env.handlers.install(install.event)
    await install.settle()

    const cache = [...env.caches.values()][0]
    // 所有预缓存条目都应在 /2048/ 之下，而非站点根目录
    for (const url of cache.store.keys()) {
      expect(url.startsWith(SCOPE)).toBe(true)
    }
  })
})
