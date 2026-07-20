// Service worker for Team Portal installability + reliable updates.
//
// The cache name is VERSIONED: bumping it on a new deploy evicts every older
// cache on activate, so an installed PWA can never be stranded on a stale shell.
// Strategy: HTML navigations are NETWORK-FIRST (always fetch the latest deployed
// shell + its current asset hashes when online); immutable /assets/* build files
// are cache-first (fast, and safe because their filename hash changes on rebuild);
// everything else same-origin is network-first with a cache fallback.
const CACHE = "sitesort-portal-v3";
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

// ---- Web Push (Team Portal notifications) ----
// A push payload is JSON: { title, body, url, tag }. `url` is a portal deep-link
// (e.g. /portal/drawings?doc=123); tapping the notification opens/focuses it. If
// the member isn't logged in, PortalLayout bounces to /portal/login?next=<url>
// and returns them after sign-in — so this just needs to open the deep link.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = data.title || "SiteSort";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || undefined,
    data: { url: data.url || "/portal/overview" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/portal/overview";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // Prefer focusing an already-open portal window and navigating it there.
    for (const c of all) {
      if (c.url.indexOf("/portal") !== -1 && "focus" in c) {
        try { await c.navigate(target); } catch (e) { /* cross-origin nav guard */ }
        return c.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
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
