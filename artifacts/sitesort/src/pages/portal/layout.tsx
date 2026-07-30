import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useGetPortalContext, getGetPortalContextQueryKey, useGetPortalUnseen, getGetPortalUnseenQueryKey } from "@workspace/api-client-react";
import { Spinner } from "@/components/ui/spinner";
import { PortalInstallPrompt } from "@/components/portal-install-prompt";
import { PortalNotifyPrompt } from "@/components/portal-notify-prompt";
import { markPortalSession, disablePush, resyncPush } from "@/lib/portal-push";
import {
  Home, AlertTriangle,
  Inbox, HardHat,
  Settings, FolderUp, Wrench, ClipboardList, MessageSquare, QrCode, FileCheck, HelpCircle,
} from "lucide-react";

// The canonical list of every portal destination — order + labels + icons.
// `key` matches the URL segment (/portal/:key) AND the server section
// allowlist. This is DATA, not a rendered nav list: navigation-cleanup
// redesign removed the hamburger/sidebar entirely — every entry here is
// reached from exactly ONE place, a big tile on Home (section.tsx's
// HomeQuickAccess). "settings" and "help" are consolidated behind the
// single Settings tile/page (Help is a link FROM there, not a top-level
// tile); "site-issues"/"plant-materials"/"daily-report" are consolidated
// behind the single conditional "Site Tasks" tile (section.tsx's
// SiteTasksView) — never individually top-level. This array remains the
// one source of truth for label/icon/permission so tile-gating, the Site
// Tasks hub, and the PWA unseen-badge total can never disagree.
export const SECTION_NAV: { key: string; label: string; Icon: typeof Home; permission?: "canLogIssues" | "canUpdatePlantMaterials" | "canEditDailyReport" }[] = [
  { key: "overview", label: "Home", Icon: Home },
  { key: "messages", label: "Messages", Icon: MessageSquare },
  { key: "shared", label: "Shared with me", Icon: Inbox },
  { key: "my-documents", label: "My documents", Icon: FolderUp },
  { key: "site-board", label: "Site Board", Icon: QrCode },
  { key: "permits", label: "Permits", Icon: FileCheck },
  { key: "settings", label: "Settings", Icon: Settings },
  { key: "help", label: "Help", Icon: HelpCircle },
  { key: "site-issues", label: "Site Issues", Icon: AlertTriangle, permission: "canLogIssues" },
  { key: "plant-materials", label: "Plant & Materials", Icon: Wrench, permission: "canUpdatePlantMaterials" },
  { key: "daily-report", label: "Daily Report", Icon: ClipboardList, permission: "canEditDailyReport" },
];

export function portalLogout(setLocation: (to: string) => void) {
  // Clean up this device's push subscription (a logged-out device must stop
  // receiving), end the session SERVER-SIDE (revoked, not just cleared locally),
  // then drop the local token and return to login. All best-effort.
  const token = typeof window !== "undefined" ? localStorage.getItem("sitesort_portal_token") : null;
  void disablePush();
  if (token) {
    void fetch("/api/portal/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  }
  localStorage.removeItem("sitesort_portal_token");
  setLocation("/portal/login");
}

// Member-facing shell for ONE project — a single unified header (logo +
// project name), no hamburger/sidebar. Navigation is entirely the big tiles
// on Home (see section.tsx's HomeQuickAccess); this shell only supplies the
// "back to everything" logo link and the shared unseen/badge plumbing.
export function PortalLayout({ active, children }: { active: string; children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const token = typeof window !== "undefined" ? localStorage.getItem("sitesort_portal_token") : null;
  const { data, isLoading, isError } = useGetPortalContext({ query: { enabled: !!token, retry: false, queryKey: getGetPortalContextQueryKey() } });
  // Unseen counts per section — feeds the PWA app-icon badge below and each
  // tile's own unseen dot (fetched independently by HomeQuickAccess/the Site
  // Tasks hub, which need it before this shell has mounted its children).
  // Polled + refetched on focus by the portal query client. Silent on error
  // → no badges rather than a broken screen.
  const { data: unseen } = useGetPortalUnseen({ query: { enabled: !!token, retry: false, refetchInterval: 60_000, queryKey: getGetPortalUnseenQueryKey() } });

  // Count this app open once (drives when the "enable notifications" card may appear).
  useEffect(() => { markPortalSession(); resyncPush(); }, []);

  // Clear-on-open: the server records the section view AFTER the section's own
  // GET responds (so that request still sees the old badge state). Shortly after
  // landing on a section, refetch the unseen counts — its badge and the
  // aggregate clear together, from the same server response, with no manual
  // refresh. The 60s poll remains the backstop.
  useEffect(() => {
    if (!token) return;
    const timers = [1500, 4000].map(ms =>
      setTimeout(() => void queryClient.invalidateQueries({ queryKey: getGetPortalUnseenQueryKey() }), ms));
    return () => timers.forEach(clearTimeout);
  }, [active, token, queryClient]);

  // App-icon badge (installed PWA): mirror the SAME aggregate the nav uses via
  // the Badging API where supported (Chrome/Edge desktop+Android, iOS 16.4+
  // standalone). Best-effort — unsupported platforms just skip it.
  useEffect(() => {
    if (!data?.member) return; // don't clear/paint until permissions are known
    const visible = SECTION_NAV.filter(s => !s.permission || !!data.member[s.permission]);
    const c = (unseen?.counts ?? {}) as Record<string, number>;
    const total = visible.reduce((sum, s) => sum + (c[s.key] ?? 0), 0);
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    try {
      if (total > 0) void nav.setAppBadge?.(total)?.catch(() => {});
      else void nav.clearAppBadge?.()?.catch(() => {});
    } catch { /* Badging API unsupported */ }
  }, [unseen, data]);

  // Focus-refetch fallback for standalone PWAs: React Query's own window-focus
  // handling can be unreliable when installed to the home screen, so when the
  // app returns to the foreground we invalidate every portal query — guaranteeing
  // fresh data after the app has been backgrounded (even for hours).
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") void queryClient.invalidateQueries(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [queryClient]);

  useEffect(() => {
    if (!token) {
      // Preserve the deep link they were trying to reach (e.g. a shared document)
      // so login can return them to it — critical for shared portal links.
      const here = window.location.pathname + window.location.search;
      const next = here.startsWith("/portal/") && !here.startsWith("/portal/login") ? `?next=${encodeURIComponent(here)}` : "";
      setLocation(`/portal/login${next}`);
    }
  }, [token, setLocation]);

  useEffect(() => {
    // Token invalid / access revoked → bounce to login.
    if (isError) portalLogout(setLocation);
  }, [isError, setLocation]);

  if (!token || isLoading || isError) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <Spinner className="size-8 text-primary" />
      </div>
    );
  }

  const logoSrc = `${import.meta.env.BASE_URL}images/logo.webp?v=5`;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Single unified header, mobile AND desktop — no hamburger, no sidebar.
          Every destination is reached from a big tile on Home instead (see
          section.tsx's HomeQuickAccess); tapping the logo always returns
          there, so it doubles as the one consistent "back to everything"
          affordance. Safe-area top so it clears the status bar/notch in
          standalone PWA mode. */}
      <header className="flex items-center gap-3 px-4 py-3 border-b bg-card pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <Link href="/portal/overview" className="shrink-0" aria-label="Portal home">
          <img src={logoSrc} alt="SiteSort" className="w-auto shrink-0 object-contain" style={{ height: "48px" }} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-primary">
            <HardHat className="w-4 h-4 shrink-0" />
            <span className="font-display font-bold truncate">{data?.project.name}</span>
          </div>
          <p className="text-xs text-muted-foreground">Team Portal</p>
        </div>
      </header>

      {/* Main content — same container + overflow safety net as the main app shell */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <main className="flex-1 p-4 md:p-8 min-w-0 overflow-x-clip">
          <div className="max-w-4xl mx-auto slide-up min-w-0 [&>*]:min-w-0">{children}</div>
        </main>
      </div>

      <PortalNotifyPrompt />
      <PortalInstallPrompt />
    </div>
  );
}
