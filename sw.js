'use strict';

const CACHE = 'voice-diary-v2';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      c.addAll(['diary.html', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png'])
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // App shell — cache-first, refresh in background so the app opens offline
  if (url.pathname.endsWith('diary.html') || url.pathname.endsWith('/')) {
    e.respondWith(
      caches.open(CACHE).then(async c => {
        const cached = await c.match(e.request);
        const networkFetch = fetch(e.request).then(res => {
          if (res.ok) c.put(e.request, res.clone());
          return res;
        }).catch(() => null);
        return cached || networkFetch;
      })
    );
    return;
  }

  // Google Fonts — stale-while-revalidate so fonts survive offline
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    e.respondWith(
      caches.open(CACHE).then(async c => {
        const cached = await c.match(e.request);
        const networkFetch = fetch(e.request).then(res => {
          if (res.ok) c.put(e.request, res.clone());
          return res;
        }).catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  // Everything else — network with cache fallback
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
