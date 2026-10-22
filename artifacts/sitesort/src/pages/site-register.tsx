import { useMemo } from "react";
import { Link, useRoute } from "wouter";
import { ArrowLeft } from "lucide-react";
import { SiteRegisterView, type RegisterSource } from "@/components/portal-site-register";

// The Site Register for company admins and project managers, on their own
// phone with their normal dashboard login (Dean, 2026-10-22: in an evacuation
// the roll is needed by whoever is there, not only a named site manager).
//
// Deliberately outside the dashboard shell: the shell checks the login with
// the server and sends you to sign in when that fails, which is exactly what
// happens with no signal. This page shows the copy saved on the phone, with
// when it was last refreshed, whatever the signal. It is in the main bundle
// (not a lazy chunk) so it opens offline even after a new release.
export const DASHBOARD_REGISTER_CACHE_PREFIX = "sitesort_dash_site_register:";

export default function DashboardSiteRegisterPage() {
  const [, params] = useRoute("/projects/:id/site-register");
  const projectId = params?.id ?? "";
  const token = (() => { try { return localStorage.getItem("sitesort_token"); } catch { return null; } })();
  const source = useMemo<RegisterSource>(() => ({
    kind: "dashboard",
    listUrl: `/api/projects/${projectId}/site-register`,
    holdUrl: id => `/api/projects/${projectId}/checkins/${id}/hold-decision`,
    signOutUrl: id => `/api/projects/${projectId}/checkins/${id}/sign-out`,
    headers: (): Record<string, string> => {
      try { const t = localStorage.getItem("sitesort_token"); return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; }
    },
    cachePrefix: DASHBOARD_REGISTER_CACHE_PREFIX,
    deniedText: "Only a company admin or project manager can open the site register here. The site manager can open it in the Team Portal.",
  }), [projectId]);

  return (
    <div className="min-h-screen w-full bg-background px-4 pb-8 pt-[calc(1rem+env(safe-area-inset-top))]">
      <div className="max-w-2xl mx-auto space-y-4 min-w-0">
        <Link href={`/projects/${projectId}?tab=checkins`} className="inline-flex items-center gap-1.5 min-h-11 text-sm font-semibold underline">
          <ArrowLeft className="w-4 h-4" /> Back to the project
        </Link>
        {!token && (
          <p className="rounded-xl border-2 border-warning bg-warning/15 p-3 text-sm" data-testid="register-signed-out">
            You're signed out. Below is the copy saved on this phone, if any. <Link href="/login" className="underline font-semibold">Sign in</Link> with signal to refresh it.
          </p>
        )}
        <SiteRegisterView projectId={projectId} source={source} />
      </div>
    </div>
  );
}
