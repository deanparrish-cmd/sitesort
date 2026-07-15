// Service worker for Team Portal installability + reliable updates.
//
// The cache name is VERSIONED: bumping it on a new deploy evicts every older
// cache on activate, so an installed PWA can never be stranded on a stale shell.
// Strategy: HTML navigations are NETWORK-FIRST (always fetch the latest deployed
// shell + its current asset hashes when online); immutable /assets/* build files
// are cache-first (fast, and safe because their filename hash changes on rebuild);
// everything else same-origin is network-first with a cache fallback.
const CACHE = "sitesort-portal-v2";
const SHELL = ["/index.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  // Take over immediately so a new deploy's SW doesn't wait for all tabs to close.
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Allow the page to trigger an immediate activation of a waiting SW.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Never intercept the API or cross-origin requests — always go to the network.
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // HTML navigations: network-first → the installed PWA always loads the latest
  // deployed shell online; the cached shell is only an offline fallback.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/index.html")));
    return;
  }

  // Immutable hashed build assets: cache-first (fast; the hash guarantees freshness).
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then((cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
          return res;
        })
      )
    );
    return;
  }

  // Everything else same-origin: network-first, cache fallback (never serve stale).
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
