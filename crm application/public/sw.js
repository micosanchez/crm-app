/* Fieldtrack CRM service worker: offline shell cache + background sync trigger */
const CACHE = 'fieldtrack-v1';
const SHELL = ['/', '/field', '/offline'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for navigation/API, cache fallback for shell. Never cache POST.
self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok && (url.pathname === '/' || url.pathname.startsWith('/field'))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(request).then((hit) => hit || caches.match('/offline'))
      )
  );
});

// Notify clients to flush the offline queue when connectivity may have returned
self.addEventListener('sync', (e) => {
  if (e.tag === 'flush-queue') {
    e.waitUntil(
      self.clients.matchAll().then((clients) =>
        clients.forEach((c) => c.postMessage({ type: 'FLUSH_QUEUE' }))
      )
    );
  }
});
