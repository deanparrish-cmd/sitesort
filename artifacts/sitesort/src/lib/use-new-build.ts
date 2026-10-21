// Is a newer build of the app live than the code this tab is running?
// (2026-10-21) A dashboard tab opened before a publish kept the old upload
// dialog for hours and skipped the #148 share question. Checks the static
// /version.json (written by vite.config.ts buildIdPlugin) against the build
// baked into this page: on open, when the tab comes back into view, and every
// few minutes. Shared by the portal, the dashboard, the QR site board and
// share links.
import { useEffect, useState } from "react";

const VERSION_CHECK_MS = 5 * 60_000;

export function useNewBuild(): boolean {
  const [newBuild, setNewBuild] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { build?: string };
        if (!cancelled && body.build && body.build !== __SITESORT_BUILD__) setNewBuild(true);
      } catch { /* no signal: try again at the next check */ }
    };
    void check();
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVisible);
    const t = setInterval(check, VERSION_CHECK_MS);
    return () => { cancelled = true; document.removeEventListener("visibilitychange", onVisible); clearInterval(t); };
  }, []);
  return newBuild;
}
