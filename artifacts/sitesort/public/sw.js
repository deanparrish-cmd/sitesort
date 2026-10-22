// Service worker for Team Portal installability + reliable updates.
//
// The cache name is VERSIONED: bumping it on a new deploy evicts every older
// cache on activate, so an installed PWA can never be stranded on a stale shell.
// Strategy: HTML navigations are NETWORK-FIRST (always fetch the latest deployed
// shell + its current asset hashes when online); immutable /assets/* build files
// are cache-first (fast, and safe because their filename hash changes on rebuild);
// everything else same-origin is network-first with a cache fallback.
const CACHE = "sitesort-portal-v6";
// Reported with every receipt and at registration. Bump when receipt behaviour changes.
const SW_VERSION = "receipts-2";
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
  // The page asks which version is running, so the server knows whether this
  // phone can send receipts (an old service worker never answers).
  if (event.data === "SW_VERSION?" && event.ports && event.ports[0]) event.ports[0].postMessage(SW_VERSION);
});

// ---- Web Push (Team Portal notifications) ----
// A push payload is JSON: { title, body, url, tag }. `url` is a portal deep-link
// (e.g. /portal/drawings?doc=123); tapping the notification opens/focuses it. If
// the member isn't logged in, PortalLayout bounces to /portal/login?next=<url>
// and returns them after sign-in — so this just needs to open the deep link.
// Receipts (2026-10-22): Apple or Google accepting a push proves nothing about
// the screen, so the phone itself reports back. `receipt` is the server's id
// for this alert on this phone; "received" once the notification is posted
// (shown = whether posting worked), "tapped" when it's tapped. No login needed.
function sendReceipt(id, event, extra) {
  if (!id) return Promise.resolve();
  var perm = null;
  try { perm = (typeof Notification !== "undefined" && Notification.permission) || null; } catch (e) { perm = null; }
  var body = { id: String(id), event: event, sw: SW_VERSION };
  if (perm) body.permission = perm;
  // Leave out empty fields: a report must never be refused over a null.
  var more = extra || {};
  for (var k in more) if (more[k] !== null && more[k] !== undefined) body[k] = more[k];
  return fetch("/api/push/receipt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true })
    .catch(function () { /* no signal: the alert just counts as unanswered */ });
}

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = data.title || "SiteSort";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || undefined,
    data: { url: data.url || "/portal/overview", receipt: data.receipt || null },
  };
  event.waitUntil((async () => {
    // 1. "arrived": this handler ran. Sent first and not awaited, so a hang or
    //    a kill while showing still leaves proof the push got here.
    const arrived = sendReceipt(data.receipt, "arrived");
    // iOS suppresses the notification banner while the PWA is in the
    // foreground, so ALSO hand the payload to any open window — the app shows
    // its own in-app banner. The system notification is still posted for the
    // lock screen / notification centre.
    let foreground = false;
    try {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if (w.visibilityState === "visible" || w.focused) foreground = true;
        w.postMessage({ kind: "push", title: title, body: options.body, url: options.data.url });
      }
    } catch (e) { /* best-effort */ }
    // 2. Show it, keeping what it threw if it fails.
    let shown = true;
    let error = null;
    try { await self.registration.showNotification(title, options); }
    catch (e) { shown = false; error = String((e && e.name) || "Error") + ": " + String((e && e.message) || e); }
    // 3. Is it really in the phone's notification list now?
    let posted = null;
    try {
      const list = await self.registration.getNotifications(options.tag ? { tag: options.tag } : undefined);
      posted = list.length > 0;
    } catch (e) { posted = null; }
    await arrived;
    await sendReceipt(data.receipt, "received", { shown: shown, error: error, posted: posted, foreground: foreground });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/portal/overview";
  const receipt = event.notification.data && event.notification.data.receipt;
  event.waitUntil((async () => {
    await sendReceipt(receipt, "tapped");
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
  // deployed shell online; the cached shell is only an offline fallback. Each
  // successful load refreshes that fallback, so offline it opens the same build
  // whose (hashed, cached) files were last used, not the one from install day.
  // That is what lets the Team Portal site register open with no signal (#124).
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("/index.html", copy)); }
          return res;
        })
        .catch(() => caches.match("/index.html"))
    );
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
