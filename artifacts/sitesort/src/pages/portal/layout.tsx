import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useGetPortalContext, getGetPortalContextQueryKey } from "@workspace/api-client-react";
import { Spinner } from "@/components/ui/spinner";
import { PortalInstallPrompt } from "@/components/portal-install-prompt";
import {
  LayoutDashboard, TrendingUp, Users, AlertTriangle, LayoutGrid,
  ShieldCheck, PencilRuler, FileText, FileCheck, HardHat, StickyNote, LogOut, Inbox,
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
  localStorage.removeItem("sitesort_portal_token");
  setLocation("/portal/login");
}

// Stripped-down, mobile-first shell for ONE project. No sidebar, no project
// switcher, no dashboard link — a portal member only ever sees their project.
export function PortalLayout({ active, children }: { active: string; children: React.ReactNode }) {
  const [, setLocation] = useLocation();
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

  return (
    <div className="min-h-screen bg-muted/20 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-card border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-primary">
              <HardHat className="w-4 h-4 shrink-0" />
              <span className="font-display font-bold truncate">{data?.project.name}</span>
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {data?.member.name} · <span className="capitalize">{data?.member.role}</span>
            </p>
          </div>
          <button
            onClick={() => portalLogout(setLocation)}
            className="shrink-0 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <LogOut className="w-4 h-4" /> <span className="hidden sm:inline">Log out</span>
          </button>
        </div>

        {/* Section nav — wraps so every section (Drawings / Method Statements /
            Permits …) is visible on mobile without horizontal scrolling. */}
        <nav className="max-w-3xl mx-auto px-2 pb-2 flex flex-wrap gap-1">
          {SECTION_NAV.map(({ key, label, Icon }) => {
            const isActive = key === active;
            return (
              <Link
                key={key}
                href={`/portal/${key}`}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors ${
                  isActive ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <Icon className="w-3.5 h-3.5" /> {label}
              </Link>
            );
          })}
        </nav>
      </header>

      {/* Content — min-w-0 + overflow-x-clip: same shared safety net as the main
          app shell, so a portal section can never scroll the (mobile-first) page. */}
      <main className="flex-1 w-full min-w-0 overflow-x-clip">
        <div className="max-w-3xl mx-auto px-4 py-5 [&>*]:min-w-0">{children}</div>
      </main>

      <PortalInstallPrompt />
    </div>
  );
}
