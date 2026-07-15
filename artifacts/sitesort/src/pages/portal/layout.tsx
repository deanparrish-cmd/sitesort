import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useGetPortalContext, getGetPortalContextQueryKey } from "@workspace/api-client-react";
import { Spinner } from "@/components/ui/spinner";
import { PortalInstallPrompt } from "@/components/portal-install-prompt";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, TrendingUp, Users, AlertTriangle, LayoutGrid,
  ShieldCheck, PencilRuler, FileText, FileCheck, HardHat, StickyNote, LogOut, Inbox,
  Menu, X,
} from "lucide-react";

// The fixed portal nav — order + labels + icons. `key` matches the URL segment
// (/portal/:key) AND the server section allowlist.
export const SECTION_NAV: { key: string; label: string; Icon: typeof LayoutDashboard }[] = [
  { key: "overview", label: "Overview", Icon: LayoutDashboard },
  { key: "shared", label: "Shared with me", Icon: Inbox },
  { key: "progress", label: "Progress", Icon: TrendingUp },
  { key: "team", label: "Team", Icon: Users },
  { key: "site-issues", label: "Site Issues", Icon: AlertTriangle },
  { key: "site-board", label: "Site Board", Icon: LayoutGrid },
  { key: "hs", label: "H&S", Icon: ShieldCheck },
  { key: "drawings", label: "Drawings", Icon: PencilRuler },
  { key: "method-statements", label: "Method Statements", Icon: FileText },
  { key: "permits", label: "Permits", Icon: FileCheck },
  { key: "safety", label: "Safety", Icon: HardHat },
  { key: "general", label: "General", Icon: StickyNote },
];

export function portalLogout(setLocation: (to: string) => void) {
  // End the session SERVER-SIDE first (revoked, not just cleared on the device),
  // then drop the local token and return to login. Best-effort + fire-and-forget:
  // the interceptor attaches the portal token to /api/portal/*, and a token that's
  // already dead simply 401s here — either way we still clear locally and redirect.
  const token = typeof window !== "undefined" ? localStorage.getItem("sitesort_portal_token") : null;
  if (token) {
    void fetch("/api/portal/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  }
  localStorage.removeItem("sitesort_portal_token");
  setLocation("/portal/login");
}

// Member-facing shell for ONE project. Mirrors the main app shell (logo + left
// sidebar with rounded active-primary nav on desktop, a hamburger drawer on
// mobile) using the same shared palette — but scoped to a single project, with
// no project switcher, dashboard link or company nav.
export function PortalLayout({ active, children }: { active: string; children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const token = typeof window !== "undefined" ? localStorage.getItem("sitesort_portal_token") : null;
  const { data, isLoading, isError } = useGetPortalContext({ query: { enabled: !!token, retry: false, queryKey: getGetPortalContextQueryKey() } });

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
  const initial = (data?.member.name ?? "?").charAt(0).toUpperCase();

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Mobile header — safe-area top so it clears the status bar / notch in standalone */}
      <div className="md:hidden flex items-center justify-between px-4 pb-4 border-b bg-card pt-[calc(1rem+env(safe-area-inset-top))]">
        {/* Tapping the logo always returns to the portal home (project overview) —
            never the marketing site or dashboard login. Works in standalone PWA. */}
        <Link href="/portal/overview" onClick={() => setIsMobileOpen(false)} className="shrink-0" aria-label="Portal home">
          <img src={logoSrc} alt="SiteSort" className="w-auto shrink-0 object-contain" style={{ height: "56px" }} />
        </Link>
        <button onClick={() => setIsMobileOpen(o => !o)} className="p-2 text-primary" aria-label="Menu">
          {isMobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Sidebar — safe-area insets so the drawer content clears system UI in standalone */}
      <div className={cn(
        "fixed inset-y-0 left-0 z-40 w-72 bg-card border-r flex flex-col transition-transform duration-300 ease-in-out md:translate-x-0 md:static md:w-64 lg:w-72",
        "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] md:pt-0 md:pb-0",
        isMobileOpen ? "translate-x-0" : "-translate-x-full",
      )}>
        <div className="p-6 hidden md:flex items-center">
          <Link href="/portal/overview" className="inline-flex" aria-label="Portal home">
            <img src={logoSrc} alt="SiteSort" className="h-[6.25rem] w-auto" />
          </Link>
        </div>

        {/* Project identity (single project — no switcher) */}
        <div className="px-6 pt-5 md:pt-0 pb-1">
          <div className="flex items-center gap-2 text-primary">
            <HardHat className="w-4 h-4 shrink-0" />
            <span className="font-display font-bold truncate">{data?.project.name}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">Team Portal</p>
        </div>

        <nav className="flex-1 px-4 py-6 overflow-y-auto">
          <div className="space-y-1">
            {SECTION_NAV.map(({ key, label, Icon }) => {
              const isActive = key === active;
              return (
                <Link
                  key={key}
                  href={`/portal/${key}`}
                  onClick={() => setIsMobileOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-md shadow-primary/10"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className={cn("w-5 h-5", isActive ? "text-primary-foreground" : "text-muted-foreground")} />
                  <span className="flex-1">{label}</span>
                </Link>
              );
            })}
          </div>
        </nav>

        {/* Member footer + logout */}
        <div className="p-4 border-t">
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold shrink-0">{initial}</div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground truncate">{data?.member.name}</p>
              <p className="text-xs text-muted-foreground capitalize truncate">{data?.member.role}</p>
            </div>
          </div>
          <button
            onClick={() => portalLogout(setLocation)}
            className="flex w-full items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
          >
            <LogOut className="w-5 h-5" /> Log out
          </button>
        </div>
      </div>

      {/* Main content — same container + overflow safety net as the main app shell */}
      <div className="flex-1 flex flex-col min-w-0 max-h-screen overflow-y-auto">
        <main className="flex-1 p-4 md:p-8 min-w-0 overflow-x-clip">
          <div className="max-w-4xl mx-auto slide-up min-w-0 [&>*]:min-w-0">{children}</div>
        </main>
      </div>

      {/* Mobile backdrop */}
      {isMobileOpen && (
        <div className="fixed inset-0 bg-primary/20 backdrop-blur-sm z-30 md:hidden" onClick={() => setIsMobileOpen(false)} />
      )}

      <PortalInstallPrompt />
    </div>
  );
}
