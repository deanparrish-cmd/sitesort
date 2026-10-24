// Portal freshness (#133): how old is what's on screen, did the last reload
// fail, and is this phone running old app code? Before this, a failed reload
// silently kept the previous list and a failed first load showed "Nothing
// shared with you here yet", so a worker could read yesterday's drawings all
// day with no sign anything was wrong.
//
// Works from React Query's own cache, so every portal list is covered without
// touching each screen: the header shows "Updated X ago" + Refresh, a bar
// under it says when something is wrong, and <Empty> (section.tsx) refuses to
// say "nothing here" when the load actually failed.
import { createContext, useCallback, useContext, useEffect, useReducer, type ReactNode } from "react";
import { useQueryClient, type Query } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNewBuild } from "@/lib/use-new-build";

/** Older than this with no successful update = "may be out of date". */
export const STALE_AFTER_MS = 15 * 60_000;

function errorStatus(q: Query): number | undefined {
  return (q.state.error as { status?: number } | null)?.status;
}

export type PortalFreshness = {
  /** Oldest successful load among the lists on screen (ms), null if none yet. */
  updatedAt: number | null;
  fetching: boolean;
  /** A reload failed while an older copy is still on screen. */
  failedWithData: boolean;
  /** A list failed and has nothing to show. */
  failedNoData: boolean;
  /** Last successful update is older than STALE_AFTER_MS. */
  stale: boolean;
  /** A newer build of the app is live than the code this phone is running. */
  newBuild: boolean;
  refresh: () => void;
  reloadApp: () => void;
  now: number;
};

export function usePortalFreshnessState(): PortalFreshness {
  const qc = useQueryClient();
  const [, rerender] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    const unsub = qc.getQueryCache().subscribe(() => rerender());
    const tick = setInterval(rerender, 30_000); // keeps "X min ago" moving
    return () => { unsub(); clearInterval(tick); };
  }, [qc]);

  // New-build check: shared with the dashboard, site board and share links.
  // The portal reloads itself on resume when a newer build is live (2026-10-24).
  const newBuild = useNewBuild({ reloadOnResume: true });

  // Lists currently on screen. A 401 is handled by the login bounce, not here;
  // helper checks (meta.freshnessIgnore) aren't lists the reader is looking at.
  const queries = qc.getQueryCache().findAll({ type: "active" })
    .filter(q => errorStatus(q) !== 401 && !(q.meta as { freshnessIgnore?: boolean } | undefined)?.freshnessIgnore);
  const loaded = queries.filter(q => q.state.dataUpdatedAt > 0);
  const updatedAt = loaded.length ? Math.min(...loaded.map(q => q.state.dataUpdatedAt)) : null;
  const fetching = queries.some(q => q.state.fetchStatus === "fetching");
  const failed = queries.filter(q => q.state.status === "error");
  const failedNoData = failed.some(q => q.state.data === undefined);
  const failedWithData = !failedNoData && failed.length > 0;
  const now = Date.now();
  const stale = updatedAt !== null && now - updatedAt > STALE_AFTER_MS;

  const refresh = useCallback(() => { void qc.refetchQueries({ type: "active" }); }, [qc]);
  const reloadApp = useCallback(() => { window.location.reload(); }, []);

  return { updatedAt, fetching, failedWithData, failedNoData, stale, newBuild, refresh, reloadApp, now };
}

const Ctx = createContext<PortalFreshness | null>(null);
export function PortalFreshnessProvider({ value, children }: { value: PortalFreshness; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
/** Null outside the portal layout (e.g. in tests rendering a section alone). */
export function usePortalFreshness(): PortalFreshness | null {
  return useContext(Ctx);
}

export function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
function ago(ms: number, now: number): string {
  const mins = Math.floor((now - ms) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const sameDay = new Date(ms).toDateString() === new Date(now).toDateString();
  return sameDay ? `at ${clockTime(ms)}` : `${new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${clockTime(ms)}`;
}

/** Header subtitle: "Updated 2 min ago", tinted when something's wrong. */
export function FreshnessLine({ f, offline }: { f: PortalFreshness; offline: boolean }) {
  const problem = f.failedNoData || f.failedWithData || f.stale || offline;
  const text = offline
    ? (f.updatedAt ? `No signal · updated ${ago(f.updatedAt, f.now)}` : "No signal")
    : f.fetching ? "Updating..."
    : f.failedNoData ? "Couldn't load"
    : f.updatedAt ? `Updated ${ago(f.updatedAt, f.now)}`
    : "Team Portal";
  return (
    <p className={cn("text-xs break-words", problem ? "text-amber-700 dark:text-amber-400 font-semibold" : "text-muted-foreground")} data-testid="portal-freshness">
      {text}
    </p>
  );
}

/** Refresh button for the header. Big enough for a gloved thumb. */
export function RefreshButton({ f }: { f: PortalFreshness }) {
  return (
    <button
      type="button"
      onClick={f.refresh}
      disabled={f.fetching}
      aria-label="Refresh"
      data-testid="portal-refresh"
      className="shrink-0 inline-flex items-center justify-center rounded-md border bg-background min-h-11 min-w-11 text-foreground hover:bg-accent active:bg-accent disabled:opacity-60"
    >
      <RefreshCw className={cn("w-4 h-4", f.fetching && "animate-spin")} />
    </button>
  );
}

/** Bar under the header, only when something needs the reader's attention. */
export function FreshnessBanner({ f, offline }: { f: PortalFreshness; offline: boolean }) {
  let tone: "red" | "amber" | "blue" | null = null;
  let text = "";
  let action: { label: string; run: () => void } | null = null;

  if (f.newBuild) {
    tone = "blue"; text = "SiteSort has been updated."; action = { label: "Reload", run: f.reloadApp };
  } else if (f.failedNoData) {
    tone = "red"; text = offline ? "No signal. This page hasn't loaded yet." : "Couldn't load this page.";
    action = { label: "Try again", run: f.refresh };
  } else if (f.failedWithData) {
    tone = "amber";
    text = `Couldn't update. Showing what was loaded ${f.updatedAt ? ago(f.updatedAt, f.now) : "earlier"}.`;
    action = { label: "Try again", run: f.refresh };
  } else if (f.stale) {
    tone = "amber";
    text = `This may be out of date. Last updated ${f.updatedAt ? ago(f.updatedAt, f.now) : "a while ago"}.`;
    action = { label: "Refresh", run: f.refresh };
  }
  if (!tone) return null;
  // The warning stays put while anything refreshes (it used to vanish whenever
  // another list polled); only the button shows that a retry is under way.
  const busy = f.fetching && action?.run === f.refresh;

  return (
    <div
      role="status"
      data-testid="portal-freshness-banner"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 text-sm font-semibold border-b",
        tone === "red" && "bg-red-50 text-red-800 border-red-200 dark:bg-red-950/60 dark:text-red-200 dark:border-red-900",
        tone === "amber" && "bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-900",
        tone === "blue" && "bg-sky-50 text-sky-900 border-sky-200 dark:bg-sky-950/60 dark:text-sky-200 dark:border-sky-900",
      )}
    >
      <span className="flex items-center gap-2 min-w-0 flex-1">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span className="min-w-0 break-words">{text}</span>
      </span>
      {action && (
        <button type="button" onClick={action.run} disabled={busy} className="shrink-0 rounded-md border border-current/30 bg-background/70 px-3 min-h-11 text-sm font-bold disabled:opacity-70">
          {busy ? "Updating..." : action.label}
        </button>
      )}
    </div>
  );
}

/** What <Empty> shows instead of "nothing here" when the load failed. */
export function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="text-center py-12 space-y-3" role="alert">
      <p className="text-base font-semibold">Couldn't load this.</p>
      <p className="text-sm text-muted-foreground">Check your signal and try again. This doesn't mean nothing was shared with you.</p>
      <button type="button" onClick={onRetry} className="inline-flex items-center gap-2 rounded-md border bg-background px-4 min-h-11 text-sm font-semibold">
        <RefreshCw className="w-4 h-4" /> Try again
      </button>
    </div>
  );
}

// A screen can add its own warning to the pinned bar (the Drawings revision
// warning in Shared with me), so it's seen without scrolling.
const WarningCtx = createContext<(node: ReactNode | null) => void>(() => {});
export const PortalWarningProvider = WarningCtx.Provider;
export function useSetPortalWarning() { return useContext(WarningCtx); }

export type RevisionHit = { name: string; latest: { name: string; revision: string | null; version: number; sharedWithYou: boolean } };

/** Red bar: the list is out of date AND the server has a newer revision. */
export function RevisionWarning({ hits, checkFailed, onRefresh }: { hits: RevisionHit[]; checkFailed: boolean; onRefresh: () => void }) {
  if (hits.length === 0 && !checkFailed) return null;
  const rev = (h: RevisionHit) => h.latest.revision ? `Rev ${h.latest.revision}` : `version ${h.latest.version}`;
  const notShared = hits.filter(h => !h.latest.sharedWithYou);
  return (
    <div role="alert" data-testid="portal-revision-warning"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 text-sm font-semibold border-b bg-red-600 text-white border-red-700">
      <span className="flex items-start gap-2 min-w-0 flex-1">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <span className="min-w-0 break-words">
          {hits.length > 0 ? (
            <>
              {hits.length === 1
                ? `Newer drawing on the server: "${hits[0].name}" is now ${rev(hits[0])}.`
                : `${hits.length} drawings on your list have newer revisions on the server: ${hits.map(h => `"${h.name}" (${rev(h)})`).join(", ")}.`}
              {" "}Your list is out of date. Don't work from it until it updates.
              {notShared.length > 0 && ` Ask your project manager to share ${notShared.length === 1 ? "the new revision" : "the new revisions"} with you.`}
            </>
          ) : (
            "Can't check for newer drawing revisions. Don't rely on these drawings until the list updates."
          )}
        </span>
      </span>
      <button type="button" onClick={onRefresh} className="shrink-0 rounded-md border border-white/50 bg-white/15 px-3 min-h-11 text-sm font-bold">Refresh</button>
    </div>
  );
}
