const CACHE_NAME = 'svc-openvolley-static-v2';
const PRECACHE_URLS = [
  '/manifest.webmanifest',
  '/theme-init.js',
  '/brand/pwa-192.png',
  '/brand/pwa-512.png',
  '/brand/svc-crest-color.svg',
  '/brand/svc-standalone-color.svg',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => undefined)
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept API, real-time SSE streams, uploads, or Vite dev modules
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/uploads/') ||
    url.pathname.startsWith('/@') ||
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/node_modules/')
  ) {
    return;
  }

  // Cache-first for immutable hashed Vite bundles and static brand artwork
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/brand/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          cache.put(request, response.clone()).catch(() => undefined);
        }
        return response;
      })
    );
    return;
  }

  // Network-first for HTML navigation so live shell updates immediately, with offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put('/', response.clone()))
              .catch(() => undefined);
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          const fallback = await cache.match('/');
          return fallback || Response.error();
        })
    );
  }
});
