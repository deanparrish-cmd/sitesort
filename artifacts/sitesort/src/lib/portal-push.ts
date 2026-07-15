// Client-side Web Push helpers for the Team Portal. All permission requests are
// user-initiated (never on load) — these are only called from an explicit tap.

const SESSION_COUNT_KEY = "sitesort_portal_session_count";
const SESSION_MARK_KEY = "sitesort_portal_session_marked"; // sessionStorage — one bump per app open
const NOTIFY_SKIP_KEY = "sitesort_portal_notify_skipped";  // timestamp of last "maybe later"
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Count distinct app opens (once per browser session). Call once when the portal
// shell mounts. The notify prompt only appears from the SECOND session onward, so
// a member is never asked to enable notifications during their first session.
export function markPortalSession(): void {
  try {
    if (sessionStorage.getItem(SESSION_MARK_KEY)) return;
    sessionStorage.setItem(SESSION_MARK_KEY, "1");
    const n = Number(localStorage.getItem(SESSION_COUNT_KEY) || "0") + 1;
    localStorage.setItem(SESSION_COUNT_KEY, String(n));
  } catch { /* storage may be unavailable */ }
}
function sessionCount(): number {
  try { return Number(localStorage.getItem(SESSION_COUNT_KEY) || "0"); } catch { return 0; }
}
export function skipNotifyPrompt(): void {
  try { localStorage.setItem(NOTIFY_SKIP_KEY, String(Date.now())); } catch { /* ignore */ }
}
function recentlySkipped(): boolean {
  try { const t = Number(localStorage.getItem(NOTIFY_SKIP_KEY) || "0"); return t > 0 && Date.now() - t < WEEK_MS; }
  catch { return false; }
}

// Should the in-context "enable notifications" card appear now? True only when:
// this isn't the first session, notifications aren't already on or hard-denied,
// the member hasn't recently tapped "maybe later", and the platform can support
// push (either directly, or via installing to home screen on iOS). Never prompts
// the browser itself — that only happens on the Enable tap inside the card.
export function notifyPromptEligible(): boolean {
  if (typeof window === "undefined") return false;
  if (sessionCount() < 2) return false;
  if (recentlySkipped()) return false;
  // iOS Safari (not installed) can't push yet, but the card leads with install.
  if (iosNeedsInstall()) return true;
  if (!pushSupported()) return false;
  const p = Notification.permission;
  return p !== "granted" && p !== "denied";
}

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream;
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

// iOS only allows Web Push from a PWA installed to the home screen (16.4+). This
// is true when we're NOT running standalone on an iPhone/iPad.
export function iosNeedsInstall(): boolean {
  return isIOS() && !isStandalone();
}

export function permissionState(): NotificationPermission | "unsupported" {
  if (!pushSupported()) return "unsupported";
  return Notification.permission;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bufToB64Url(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function portalToken(): string | null {
  return typeof window !== "undefined" ? localStorage.getItem("sitesort_portal_token") : null;
}
function authHeaders(): Record<string, string> {
  const t = portalToken();
  return { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) };
}

async function fetchVapidKey(): Promise<string | null> {
  try {
    const res = await fetch("/api/portal/push/public-key", { headers: authHeaders() });
    if (!res.ok) return null;
    const data = await res.json();
    return data.publicKey ?? null;
  } catch {
    return null;
  }
}

// Is THIS device currently subscribed (permission granted + an active push
// subscription registered)? Drives the settings toggle state.
export async function isDeviceSubscribed(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    return !!(await reg.pushManager.getSubscription());
  } catch {
    return false;
  }
}

export type EnableResult = "enabled" | "denied" | "unsupported" | "needs_install" | "error";

// Request permission (fires the browser prompt — MUST be from a user gesture),
// subscribe this device, and register the subscription server-side.
export async function enablePush(): Promise<EnableResult> {
  if (!pushSupported()) return "unsupported";
  if (iosNeedsInstall()) return "needs_install";
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return "denied";
    const key = await fetchVapidKey();
    if (!key) return "error"; // push not configured on the server
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) as BufferSource });
    }
    const json = sub.toJSON();
    const res = await fetch("/api/portal/push/subscribe", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys?.p256dh ?? bufToB64Url(sub.getKey("p256dh")), auth: json.keys?.auth ?? bufToB64Url(sub.getKey("auth")) },
        userAgent: navigator.userAgent,
      }),
    });
    return res.ok ? "enabled" : "error";
  } catch {
    return "error";
  }
}

// Unsubscribe this device (settings toggle-off / logout). Best-effort both sides.
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/portal/push/unsubscribe", {
        method: "POST", headers: authHeaders(), body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
  } catch { /* best-effort */ }
}
