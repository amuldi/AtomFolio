// Deliberately does no caching — AtomFolio's whole value is live market data/news/prices, so an
// offline-first cache would mean serving stale quotes without any way for the user to tell. This
// exists only so Chrome's installability check (which requires a registered service worker with a
// fetch handler) is satisfied — every request still goes straight to the network, unmodified.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
