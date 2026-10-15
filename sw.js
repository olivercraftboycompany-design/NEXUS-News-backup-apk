/* NEXUS News service worker: offline app shell + the last news.json for offline reading. */
const VERSION = 'nxnews-v2';
const SHELL = `${VERSION}-shell`, DATA = 'nxnews-data';
const ASSETS = ['./', 'index.html', 'style.css', 'app.js', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/favicon.png', 'icons/apple-touch-icon.png'];
const NEWS_KEY = new URL('news-latest.json', self.registration.scope).href;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== SHELL && k !== DATA) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isNews = url => /\/news\.json$/.test(url.pathname) && (url.hostname === 'raw.githubusercontent.com' || url.origin === self.location.origin);

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // News data: network first, keep the newest copy for offline reading.
  if (isNews(url)) {
    e.respondWith((async () => {
      const cache = await caches.open(DATA);
      try {
        const res = await fetch(req);
        if (res.ok) {
          const body = await res.clone().text();
          const prev = await cache.match(NEWS_KEY);
          let newer = true;
          try { if (prev) newer = Date.parse(JSON.parse(body).updated) >= Date.parse((await prev.clone().json()).updated); } catch {}
          if (newer) await cache.put(NEWS_KEY, new Response(body, { headers: { 'Content-Type': 'application/json' } }));
        }
        return res;
      } catch (err) {
        const hit = await cache.match(NEWS_KEY);
        if (hit) return new Response(await hit.text(), { headers: { 'Content-Type': 'application/json', 'X-NXNews-Cache': '1' } });
        return new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
    })());
    return;
  }

  if (url.origin !== self.location.origin) return; // images and articles go straight to the network

  // Pages: network first so updates show up, cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => { const c = res.clone(); caches.open(SHELL).then(ca => ca.put('index.html', c)); return res; })
      .catch(async () => (await caches.match('index.html')) || caches.match('./')));
    return;
  }
  // App files: cache first, refresh in the background.
  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    const net = fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)).catch(() => {}); } return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || new Response('', { status: 504 });
  })());
});
