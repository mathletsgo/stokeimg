/* BuscaSKU — Service Worker Offline-First (PWA) */
const STATIC_CACHE = "buscasku-static-v23";
const IMG_CACHE = "buscasku-img-v1";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./qrcode.js",
  "./catalogo.js",
  "./logo.svg",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== STATIC_CACHE && k !== IMG_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Cache inteligente para fotos da CDN Centauro
  if (url.hostname === "imgcentauro-a.akamaihd.net") {
    event.respondWith(
      caches.open(IMG_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          if (cached) return cached;
          return fetch(req)
            .then((res) => {
              if (res && (res.ok || res.type === "opaque")) {
                cache.put(req, res.clone()).catch(() => {});
              }
              return res;
            })
            .catch(() => cached || Response.error());
        })
      )
    );
    return;
  }

  // Apenas requisições da própria origem
  if (url.origin !== self.location.origin) return;

  // Network-first para HTML e catálogo (sempre atualizado quando online, 100% offline no estoque)
  const isNavOrData =
    req.mode === "navigate" ||
    url.pathname.endsWith("/") ||
    url.pathname.endsWith(".html") ||
    url.pathname.endsWith("catalogo.js");

  if (isNavOrData) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy).catch(() => {}));
          }
          return res;
        })
        .catch(() =>
          caches
            .match(req, { ignoreSearch: true })
            .then((hit) => hit || caches.match("./index.html"))
        )
    );
    return;
  }

  // Stale-While-Revalidate para CSS, JS, SVG e manifest
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy).catch(() => {}));
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
