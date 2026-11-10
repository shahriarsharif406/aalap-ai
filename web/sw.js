/* Offline shell: static files are cache-first, API calls always go to the network. */
const CACHE = "aalap-v15";
const FILES = ["./", "index.html", "app.html", "landing.css", "styles.css", "data.js", "app.js", "vendor/qrcode.js", "icon.svg", "manifest.json", "pict/2705.svg", "pict/274c.svg", "pict/1f198.svg", "pict/2795.svg", "pict/270b.svg", "pict/1f3c1.svg", "pict/1f915.svg", "pict/1f6bd.svg", "pict/1f64f.svg", "pict/1f97a.svg", "pict/1f35a.svg", "pict/1f4a7.svg", "pict/1f95b.svg", "pict/1f34e.svg", "pict/1f60b.svg", "pict/1f525.svg", "pict/1f44e.svg", "pict/1f44d.svg", "pict/1f4d6.svg", "pict/1f58d.svg", "pict/1f9f8.svg", "pict/1f3b5.svg", "pict/26bd.svg", "pict/1f501.svg", "pict/1f64b.svg", "pict/1f449.svg", "pict/1f9d1-200d-1f91d-200d-1f9d1.svg", "pict/1f4a1.svg", "pict/2753.svg", "pict/1f502.svg", "pict/2615.svg", "pict/1f9fc.svg", "pict/1f6c1.svg", "pict/1faa5.svg", "pict/1f455.svg", "pict/1f92f.svg", "pict/1f922.svg", "pict/1f635.svg", "pict/1f48a.svg", "pict/1f9d1-200d-2695-fe0f.svg", "pict/1f3e0.svg", "pict/1f333.svg", "pict/23f3.svg", "pict/1f440.svg", "pict/1f91d.svg", "pict/1f60a.svg", "pict/1f622.svg", "pict/1f620.svg", "pict/1f628.svg", "pict/1f634.svg", "pict/1f6cf.svg", "pict/2764.svg", "pict/1f647.svg", "pict/1f44b.svg", "pict/1f590.svg", "pict/1f37d.svg", "pict/1f392.svg", "pict/1fa7a.svg", "pict/1f68c.svg", "pict/1f49b.svg", "pict/1f389.svg", "pict/2b50.svg", "pict/1f31f.svg", "pict/2728.svg", "pict/1f517.svg", "pict/1f4f7.svg", "pict/1f50a.svg", "pict/1f3a7.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const net = fetch(e.request)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
