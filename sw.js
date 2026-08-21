// WICK BRIDGE service worker — app-shell cache only.
// The shell (index.html) is cached for offline/instant loads; config.json and
// every relayer/RPC call is ALWAYS network (never cache chain state or the
// live config — a stale contract address would be dangerous).
const SHELL = 'wick-bridge-shell-v1';
const ASSETS = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // never cache dynamic data
  if (url.pathname.endsWith('config.json') || url.pathname.startsWith('/api/') ||
      e.request.method === 'POST') return;
  // shell: cache-first for same-origin navigations/assets
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        // only cache SUCCESSFUL responses — never a transient 404/5xx, which
        // would otherwise be served forever (a deploy-time miss sticks).
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match('./index.html')))
    );
  }
});
