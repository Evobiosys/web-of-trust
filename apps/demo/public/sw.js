/**
 * Offline-after-first-load service worker.
 *
 * Deliberately conservative, because a stale cache during a live demo is worse
 * than no cache at all:
 *   - navigations (the HTML) are NETWORK FIRST, so a redeploy is picked up on
 *     the next load whenever the network is reachable, and the cached copy is
 *     used only when the network actually fails.
 *   - hashed build assets are CACHE FIRST, which is safe because Vite content
 *     hashes them: a changed file is a different URL.
 *
 * This exists so that a phone which loaded the page once at home still works if
 * the venue network is bad or DNS misbehaves.
 */
// Bumped when a deploy must invalidate whatever a phone already holds. The
// activate handler deletes every cache whose name is not this one, so a
// device that loaded a broken build gets a clean slate on its next visit.
const CACHE = 'wot-demo-v2'

self.addEventListener('install', (e) => {
  self.skipWaiting()
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html']).catch(() => undefined)))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('./index.html', copy))
          return res
        })
        .catch(() => caches.match('./index.html').then((r) => r ?? Response.error())),
    )
    return
  }

  e.respondWith(
    caches.match(req).then((hit) =>
      hit ??
      fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy))
        }
        return res
      }),
    ),
  )
})
