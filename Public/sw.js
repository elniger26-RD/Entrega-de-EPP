self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.map((name) => caches.delete(name)))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', () => {});
