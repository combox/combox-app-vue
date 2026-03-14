const VERSION = 'v3'
const SHELL_CACHE = `combox-shell-${VERSION}`
const ASSET_CACHE = `combox-assets-${VERSION}`
const API_CACHE = `combox-api-${VERSION}`
const IS_LOCAL_HOST = ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname)

const OUTBOX_DB = 'combox-outbox'
const OUTBOX_STORE = 'requests'

function openOutboxDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OUTBOX_DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function outboxPut(item) {
  const db = await openOutboxDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readwrite')
    tx.objectStore(OUTBOX_STORE).put(item)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function outboxList() {
  const db = await openOutboxDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readonly')
    const req = tx.objectStore(OUTBOX_STORE).getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
}

async function outboxDelete(id) {
  const db = await openOutboxDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readwrite')
    tx.objectStore(OUTBOX_STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function isApiGet(url, req) {
  if (req.method !== 'GET') return false
  return url.pathname.startsWith('/api/private/v1/')
}

function isApiMutation(url, req) {
  if (req.method === 'GET') return false
  if (!url.pathname.startsWith('/api/private/v1/')) return false
  return true
}

function isStaticAsset(url, req) {
  if (req.method !== 'GET') return false
  if (url.origin !== self.location.origin) return false
  if (url.pathname === '/' || url.pathname.endsWith('.html')) return false
  return (
    url.pathname.startsWith('/assets/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.woff') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.jpeg') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.webmanifest')
  )
}

async function cacheShell() {
  const cache = await caches.open(SHELL_CACHE)
  await cache.addAll([
    '/',
    '/index.html',
    '/manifest.webmanifest',
    '/favicon.ico'
  ])
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await cacheShell()
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, ASSET_CACHE, API_CACHE])
    const keys = await caches.keys()
    await Promise.all(keys.map((k) => (keep.has(k) ? Promise.resolve() : caches.delete(k))))
    await self.clients.claim()
  })())
})

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName)
  try {
    const res = await fetch(req)
    if (res && res.ok) {
      cache.put(req, res.clone())
    }
    return res
  } catch {
    const cached = await cache.match(req)
    if (cached) return cached
    throw new Error('offline')
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(req)
  if (cached) return cached
  const res = await fetch(req)
  if (res && res.ok) cache.put(req, res.clone())
  return res
}

async function handleNavigation(req) {
  const cache = await caches.open(SHELL_CACHE)
  try {
    const res = await fetch(req)
    if (res && res.ok && res.type === 'basic') {
      cache.put('/', res.clone())
    }
    return res
  } catch {
    const cached = await cache.match('/')
    if (cached) return cached
    return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
  }
}

async function enqueueRequest(req) {
  const url = new URL(req.url)
  const headers = {}
  for (const [k, v] of req.headers.entries()) headers[k] = v
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.clone().text()
  const item = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ts: Date.now(),
    url: url.pathname + url.search,
    method: req.method,
    headers,
    body,
  }
  await outboxPut(item)
  return item
}

async function flushOutbox() {
  const items = await outboxList()
  for (const item of items) {
    try {
      const res = await fetch(item.url, {
        method: item.method,
        headers: item.headers,
        body: item.body,
      })
      if (res && res.ok) {
        await outboxDelete(item.id)
      }
    } catch {
      return
    }
  }
}

self.addEventListener('message', (event) => {
  const data = event.data || {}
  if (data && data.type === 'SKIP_WAITING') {
    self.skipWaiting()
    return
  }
  if (data && data.type === 'FLUSH_OUTBOX') {
    event.waitUntil(flushOutbox())
  }
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)

  if (req.mode === 'navigate') {
    event.respondWith(handleNavigation(req))
    return
  }

  if (url.origin !== self.location.origin) return

  if (isStaticAsset(url, req)) {
    if (IS_LOCAL_HOST || url.pathname.includes('hot-update') || url.pathname.includes('websocket')) {
      return
    }
    event.respondWith(cacheFirst(req, ASSET_CACHE))
    return
  }

  if (isApiGet(url, req)) {
    event.respondWith(networkFirst(req, API_CACHE))
    return
  }

  if (isApiMutation(url, req)) {
    event.respondWith((async () => {
      try {
        return await fetch(req)
      } catch {
        return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
      }
    })())
  }
})
