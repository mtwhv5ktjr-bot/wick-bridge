// WICK BRIDGE reserve site: no service worker. This file only RETIRES a worker
// left over from the earlier UI (clears caches, unregisters, reloads tabs).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k)));
  await self.registration.unregister();
  const cs = await self.clients.matchAll({ type: 'window' }); cs.forEach(c => c.navigate(c.url));
})()));
