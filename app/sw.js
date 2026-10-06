// Offline support: app ki apni files cache mein. Data (Drive/AI) kabhi cache nahi hota.
const CACHE = 'pdock-v5';
const FILES = ['./', 'index.html', 'style.css', 'manifest.json', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png',
  'js/app.js', 'js/vault.js', 'js/model.js', 'js/crypto.js', 'js/idb.js', 'js/drive.js', 'js/config.js', 'js/passkey.js',
  'js/extract.js', 'js/calendar.js', 'js/pipeline.js', 'js/ocr.js', 'js/ai.js', 'js/actions.js', 'js/places.js', 'js/gmail.js', 'js/facts.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Pehle network (taaki update turant mile), net na ho to cache
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return res; })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
