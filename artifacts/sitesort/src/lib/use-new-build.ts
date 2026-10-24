// Is a newer build of the app live than the code this tab is running?
// (2026-10-21) A dashboard tab opened before a publish kept the old upload
// dialog for hours and skipped the #148 share question. Checks the static
// /version.json (written by vite.config.ts buildIdPlugin) against the build
// baked into this page: on open, when the tab comes back into view, and every
// few minutes. Shared by the portal, the dashboard, the QR site board and
// share links.
import { useEffect, useState } from "react";

const VERSION_CHECK_MS = 5 * 60_000;

// `reloadOnResume`: when the app comes back on screen and a newer build is
// live, reload straight away instead of waiting for a tap (Dean, 2026-10-24:
// an installed Home Screen app resumed from the background keeps running the
// code it opened with). A reload loads the new build: the service worker
// fetches pages network-first. Skipped while a document is open in the viewer
// or someone is typing, so nothing they're doing is lost; the bar still shows.
function safeToReload(): boolean {
  if (document.querySelector('[data-testid="document-viewer"]')) return false;
  const el = document.activeElement as HTMLElement | null;
  return !(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable));
}

export function useNewBuild(opts: { reloadOnResume?: boolean } = {}): boolean {
  const [newBuild, setNewBuild] = useState(false);
  const reloadOnResume = !!opts.reloadOnResume;
  useEffect(() => {
    let cancelled = false;
    const check = async (resumed = false) => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { build?: string };
        if (cancelled || !body.build || body.build === __SITESORT_BUILD__) return;
        if (resumed && reloadOnResume && safeToReload()) { window.location.reload(); return; }
        setNewBuild(true);
      } catch { /* no signal: try again at the next check */ }
    };
    void check();
    const onVisible = () => { if (document.visibilityState === "visible") void check(true); };
    document.addEventListener("visibilitychange", onVisible);
    const t = setInterval(() => void check(), VERSION_CHECK_MS);
    return () => { cancelled = true; document.removeEventListener("visibilitychange", onVisible); clearInterval(t); };
  }, [reloadOnResume]);
  return newBuild;
}
