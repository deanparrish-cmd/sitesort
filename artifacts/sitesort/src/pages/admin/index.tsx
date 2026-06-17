import { useEffect, useCallback, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell,
} from "recharts";
import {
  Users, FileText, PenLine, ClipboardCheck, ShieldCheck, QrCode, Camera,
  Building2, Bell, TrendingUp, TrendingDown, Minus, AlertTriangle,
  CheckCircle2, AlertCircle, Download, RefreshCw, HardHat, Clock,
  Activity, Layers, Zap, UserCheck, UserX, Trophy, BarChart2, Search,
  FlaskConical, Trash2, Loader2,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

const ADMIN_EMAILS = ["dean.parrish@me.com", "amy-parrish@hotmail.co.uk"];
const ORANGE = "#ea580c";

// ─── Data fetching ───────────────────────────────────────────────────────────

async function apiFetch(path: string) {
  const token = localStorage.getItem("sitesort_token");
  const res = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

function useAdminStats() {
  return useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => apiFetch("/api/admin/stats"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

function useChartData() {
  return useQuery({
    queryKey: ["admin-chart-data"],
    queryFn: () => apiFetch("/api/admin/chart-data"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

function useActivity() {
  return useQuery({
    queryKey: ["admin-activity"],
    queryFn: () => apiFetch("/api/admin/activity"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

function useDormantUsers() {
  return useQuery({
    queryKey: ["admin-dormant-users"],
    queryFn: () => apiFetch("/api/admin/dormant-users"),
    staleTime: 60_000,
  });
}

function useLapsedUsers() {
  return useQuery({
    queryKey: ["admin-lapsed-users"],
    queryFn: () => apiFetch("/api/admin/lapsed-users"),
    staleTime: 60_000,
  });
}

function useFeatureAdoption() {
  return useQuery({
    queryKey: ["admin-feature-adoption"],
    queryFn: () => apiFetch("/api/admin/feature-adoption"),
    staleTime: 60_000,
  });
}

function useCompanies() {
  return useQuery({
    queryKey: ["admin-companies"],
    queryFn: () => apiFetch("/api/admin/companies"),
    staleTime: 30_000,
  });
}

function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch("/api/auth/me"),
    retry: false,
  });
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// ─── Primitive components ─────────────────────────────────────────────────────

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-gray-800 ${className}`} />;
}

function Trend({ pct }: { pct: number | undefined }) {
  if (pct == null) return null;
  if (pct > 0) return <span className="flex items-center gap-0.5 text-emerald-400 text-xs font-medium"><TrendingUp className="w-3 h-3" />+{pct}%</span>;
  if (pct < 0) return <span className="flex items-center gap-0.5 text-red-400 text-xs font-medium"><TrendingDown className="w-3 h-3" />{pct}%</span>;
  return <span className="flex items-center gap-0.5 text-gray-500 text-xs"><Minus className="w-3 h-3" />0%</span>;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-gray-900 border border-gray-800 rounded-xl p-5 ${className}`}>
      {children}
    </div>
  );
}

function SectionTitle({ icon: Icon, title, sub }: { icon: React.ComponentType<{ className?: string }>; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-orange-500" />
      </div>
      <div>
        <h2 className="text-white font-semibold text-base leading-tight">{title}</h2>
        {sub && <p className="text-gray-500 text-xs mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function BigStat({
  label, value, sub, trend, loading, accent = false,
}: {
  label: string; value: string | number; sub?: string; trend?: number; loading?: boolean; accent?: boolean;
}) {
  return (
    <Card className={accent ? "border-orange-500/40 bg-orange-950/20" : ""}>
      <p className="text-gray-400 text-xs font-medium uppercase tracking-wide mb-2">{label}</p>
      {loading
        ? <Skeleton className="h-9 w-24 mb-1" />
        : <p className={`text-4xl font-extrabold ${accent ? "text-orange-400" : "text-white"} leading-none mb-1`}>{fmt(Number(value))}</p>
      }
      <div className="flex items-center gap-2 min-h-[18px]">
        {sub && <span className="text-gray-500 text-xs">{sub}</span>}
        {trend != null && <Trend pct={trend} />}
      </div>
    </Card>
  );
}

function FeatureStatCard({
  label, allTime, thisWeek, today, pctChange, loading,
}: {
  label: string; allTime: number; thisWeek: number; today: number; pctChange: number; loading?: boolean;
}) {
  return (
    <Card>
      <p className="text-gray-400 text-xs font-medium uppercase tracking-wide mb-3">{label}</p>
      {loading
        ? <Skeleton className="h-7 w-16 mb-3" />
        : <p className="text-3xl font-bold text-white mb-3">{fmt(allTime)}</p>
      }
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-gray-800 rounded-lg p-2">
          <p className="text-gray-500">This week</p>
          <p className="text-white font-semibold">{fmt(thisWeek)}</p>
          <Trend pct={pctChange} />
        </div>
        <div className="bg-gray-800 rounded-lg p-2">
          <p className="text-gray-500">Today</p>
          <p className="text-white font-semibold">{fmt(today)}</p>
        </div>
      </div>
    </Card>
  );
}

// ─── Activity type badge ──────────────────────────────────────────────────────

const typeColors: Record<string, string> = {
  "Document uploaded": "bg-blue-500/20 text-blue-400",
  "Sign-off completed": "bg-emerald-500/20 text-emerald-400",
  "Permit created": "bg-yellow-500/20 text-yellow-400",
  "QR code generated": "bg-purple-500/20 text-purple-400",
  "Photo uploaded": "bg-pink-500/20 text-pink-400",
  "User registered": "bg-orange-500/20 text-orange-400",
  "Insurance uploaded": "bg-cyan-500/20 text-cyan-400",
};

function ActivityBadge({ type }: { type: string }) {
  const cls = typeColors[type] ?? "bg-gray-700 text-gray-300";
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${cls}`}>{type}</span>;
}

// ─── Funnel bar ───────────────────────────────────────────────────────────────

function FunnelStep({ label, count, total, sub }: { label: string; count: number; total: number; sub?: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-4">
      <div className="w-28 text-right text-gray-400 text-xs flex-shrink-0">{label}</div>
      <div className="flex-1 bg-gray-800 rounded-full h-6 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-orange-700 to-orange-500 rounded-full flex items-center pl-3 transition-all duration-700"
          style={{ width: `${Math.max(pct, 4)}%` }}
        >
          <span className="text-white text-xs font-bold">{fmt(count)}</span>
        </div>
      </div>
      <div className="w-14 text-gray-400 text-xs flex-shrink-0">{pct}%</div>
      {sub && <div className="text-gray-600 text-xs flex-shrink-0">{sub}</div>}
    </div>
  );
}

// ─── CSV export helper ────────────────────────────────────────────────────────

function downloadCsv(path: string, filename: string) {
  const token = localStorage.getItem("sitesort_token");
  fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then(r => r.blob())
    .then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    });
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [, setLocation] = useLocation();
  const { data: me, isLoading: authLoading } = useMe();
  const { data: stats, isLoading: statsLoading, dataUpdatedAt, refetch: refetchStats } = useAdminStats();
  const { data: charts, isLoading: chartsLoading, refetch: refetchCharts } = useChartData();
  const { data: activity, isLoading: activityLoading, refetch: refetchActivity } = useActivity();
  const { data: dormantUsers, isLoading: dormantLoading, refetch: refetchDormant } = useDormantUsers();
  const { data: lapsedUsers, isLoading: lapsedLoading, refetch: refetchLapsed } = useLapsedUsers();
  const { data: featureAdoption, isLoading: adoptionLoading, refetch: refetchAdoption } = useFeatureAdoption();
  const { data: companies, isLoading: companiesLoading, refetch: refetchCompanies } = useCompanies();
  const queryClient = useQueryClient();
  const [betaTogglingId, setBetaTogglingId] = useState<string | null>(null);
  const [deletingCompanyId, setDeletingCompanyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function toggleBeta(companyId: string, current: boolean) {
    setBetaTogglingId(companyId);
    const token = localStorage.getItem("sitesort_token");
    await fetch(`/api/admin/companies/${companyId}/beta-access`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ betaAccess: !current }),
    });
    await refetchCompanies();
    queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
    setBetaTogglingId(null);
  }

  async function deleteCompany(companyId: string) {
    setDeletingCompanyId(companyId);
    const token = localStorage.getItem("sitesort_token");
    await fetch(`/api/admin/companies/${companyId}`, {
      method: "DELETE",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    setConfirmDeleteId(null);
    await refetchCompanies();
    queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
    setDeletingCompanyId(null);
  }

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activitySearch, setActivitySearch] = useState("");

  const refetchAll = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all([
      refetchStats(),
      refetchCharts(),
      refetchActivity(),
      refetchDormant(),
      refetchLapsed(),
      refetchAdoption(),
    ]);
    setIsRefreshing(false);
  }, [refetchStats, refetchCharts, refetchActivity, refetchDormant, refetchLapsed, refetchAdoption]);

  useEffect(() => {
    if (!authLoading && !me) setLocation("/login");
  }, [me, authLoading, setLocation]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-orange-500 animate-spin" />
      </div>
    );
  }

  if (!me || !ADMIN_EMAILS.includes(me.email)) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-center px-4">
        <div>
          <AlertCircle className="w-14 h-14 text-red-500 mx-auto mb-4" />
          <h1 className="text-white text-2xl font-bold mb-2">Access Denied</h1>
          <p className="text-gray-400 mb-6">This area is restricted to authorised administrators.</p>
          <button onClick={() => setLocation("/dashboard")} className="px-5 py-2.5 bg-orange-600 hover:bg-orange-500 text-white rounded-lg font-semibold transition-colors">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const s = stats;
  const loading = statsLoading;

  // Alerts
  const alertItems: Array<{ level: "green" | "yellow" | "red"; message: string }> = s?.alerts ?? [];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* ── Header ── */}
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur sticky top-0 z-40">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setLocation("/dashboard")} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <div className="w-7 h-7 bg-gradient-to-br from-orange-700 to-orange-500 rounded-lg flex items-center justify-center">
                <Building2 className="w-4 h-4 text-white" />
              </div>
              <span className="text-white font-bold text-sm block">SiteSort</span>
            </button>
            <span className="text-gray-600 text-sm block">/</span>
            <span className="text-orange-400 font-semibold text-sm">Admin</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-gray-500 text-xs block">
              {dataUpdatedAt ? `Updated ${timeAgo(new Date(dataUpdatedAt).toISOString())}` : "Loading…"}
            </span>
            <button
              onClick={refetchAll}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 rounded-lg text-xs font-medium transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
              {isRefreshing ? "Refreshing…" : "Refresh"}
            </button>
            <button onClick={() => setLocation("/dashboard")} className="text-gray-500 hover:text-white text-xs transition-colors block">
              ← App
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-8 space-y-10">

        {/* ── Alerts ── */}
        <div className="flex flex-wrap gap-2">
          {alertItems.map((a, i) => (
            <div key={i} className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border ${
              a.level === "green" ? "bg-emerald-950/50 border-emerald-800 text-emerald-300"
              : a.level === "yellow" ? "bg-yellow-950/50 border-yellow-800 text-yellow-300"
              : "bg-red-950/50 border-red-800 text-red-300"
            }`}>
              {a.level === "green" ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              {a.message}
            </div>
          ))}
        </div>

        {/* ── User Metrics ── */}
        <section>
          <SectionTitle icon={Users} title="User Metrics" sub="Platform-wide user activity" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <BigStat label="Total Users" value={s?.userMetrics?.totalUsers ?? 0} sub={`across ${fmt(s?.userMetrics?.totalCompanies ?? 0)} companies`} loading={loading} accent />
            <BigStat label="New This Week" value={s?.userMetrics?.newThisWeek ?? 0} trend={s?.userMetrics?.newThisWeekPct} sub={`${fmt(s?.userMetrics?.newLastWeek ?? 0)} last week`} loading={loading} />
            <BigStat label="Active This Week" value={s?.userMetrics?.activeThisWeek ?? 0} sub="Logged in ≥1×" loading={loading} />
            <BigStat label="Active Today" value={s?.userMetrics?.activeToday ?? 0} sub="Daily active users" loading={loading} />
          </div>
        </section>

        {/* ── Primary Actions ── */}
        <section>
          <SectionTitle icon={Activity} title="Primary Actions" sub="Core platform activity across all features" />

          {/* Total summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <BigStat label="Total Actions (All Time)" value={s?.primaryActions?.total?.allTime ?? 0} loading={loading} accent />
            <BigStat label="Actions This Week" value={s?.primaryActions?.total?.thisWeek ?? 0} trend={s?.primaryActions?.total?.pctChange} sub={`${fmt(s?.primaryActions?.total?.lastWeek ?? 0)} last week`} loading={loading} />
            <BigStat label="Actions Today" value={s?.primaryActions?.total?.today ?? 0} loading={loading} />
            <BigStat label="Avg Actions / User" value={s?.primaryActions?.total?.perUser ?? 0} loading={loading} />
          </div>

          {/* Per-feature breakdown */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {([
              ["Documents Uploaded", "documents"],
              ["Sign-offs", "signOffs"],
              ["Permits", "permits"],
              ["Insurance Docs", "insurance"],
              ["QR Codes", "qrCodes"],
              ["Photos", "photos"],
            ] as [string, string][]).map(([label, key]) => (
              <FeatureStatCard
                key={key}
                label={label}
                allTime={s?.primaryActions?.[key]?.allTime ?? 0}
                thisWeek={s?.primaryActions?.[key]?.thisWeek ?? 0}
                today={s?.primaryActions?.[key]?.today ?? 0}
                pctChange={s?.primaryActions?.[key]?.pctChange ?? 0}
                loading={loading}
              />
            ))}
          </div>
        </section>

        {/* ── Activity Feed ── */}
        <section>
          <SectionTitle icon={Layers} title="Recent Activity" sub="Last 50 actions across all features" />
          <div className="relative max-w-sm mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
            <input
              type="text"
              placeholder="Filter by type, user or detail…"
              value={activitySearch}
              onChange={e => setActivitySearch(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-200 placeholder-gray-500 outline-none focus:ring-1 transition-colors focus:border-gray-500"
            />
          </div>
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-900/60">
                    <th className="text-left text-gray-500 text-xs font-medium uppercase tracking-wide px-4 py-3">Type</th>
                    <th className="text-left text-gray-500 text-xs font-medium uppercase tracking-wide px-4 py-3">User</th>
                    <th className="text-left text-gray-500 text-xs font-medium uppercase tracking-wide px-4 py-3">Detail</th>
                    <th className="text-left text-gray-500 text-xs font-medium uppercase tracking-wide px-4 py-3 table-cell">Sub-detail</th>
                    <th className="text-left text-gray-500 text-xs font-medium uppercase tracking-wide px-4 py-3">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60">
                  {activityLoading
                    ? Array.from({ length: 8 }).map((_, i) => (
                        <tr key={i}>
                          <td className="px-4 py-3"><Skeleton className="h-4 w-28" /></td>
                          <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                          <td className="px-4 py-3"><Skeleton className="h-4 w-32" /></td>
                          <td className="px-4 py-3 table-cell"><Skeleton className="h-4 w-20" /></td>
                          <td className="px-4 py-3"><Skeleton className="h-4 w-16" /></td>
                        </tr>
                      ))
                    : (activity ?? []).filter((a: any) => {
                        const q = activitySearch.toLowerCase();
                        return !q || a.type?.toLowerCase().includes(q) || a.userName?.toLowerCase().includes(q) || a.detail?.toLowerCase().includes(q);
                      }).map((a: any) => (
                        <tr key={a.id + a.ts} className="hover:bg-gray-800/30 transition-colors">
                          <td className="px-4 py-3"><ActivityBadge type={a.type} /></td>
                          <td className="px-4 py-3 text-gray-300 font-medium">{a.userName}</td>
                          <td className="px-4 py-3 text-gray-400 max-w-[180px] truncate">{a.detail}</td>
                          <td className="px-4 py-3 text-gray-600 text-xs table-cell max-w-[140px] truncate">{a.subDetail}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{timeAgo(a.ts)}</td>
                        </tr>
                      ))
                  }
                </tbody>
              </table>
            </div>
          </Card>
        </section>

        {/* ── Secondary Actions ── */}
        <section>
          <SectionTitle icon={Bell} title="Secondary Actions" sub="Supporting platform activity" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {([
              ["Notifications Sent", "notifications"],
              ["Projects Created", "projects"],
              ["User Sign-ups", "signUps"],
            ] as [string, string][]).map(([label, key]) => (
              <Card key={key}>
                <p className="text-gray-400 text-xs font-medium uppercase tracking-wide mb-3">{label}</p>
                {loading
                  ? <Skeleton className="h-8 w-16 mb-3" />
                  : <p className="text-3xl font-bold text-white mb-3">{fmt(s?.secondaryActions?.[key]?.allTime ?? 0)}</p>
                }
                <div className="flex gap-3 text-xs">
                  <div className="flex-1 bg-gray-800 rounded-lg p-2">
                    <p className="text-gray-500">This week</p>
                    <p className="text-white font-semibold">{fmt(s?.secondaryActions?.[key]?.thisWeek ?? 0)}</p>
                    <Trend pct={s?.secondaryActions?.[key]?.pctChange} />
                  </div>
                  <div className="flex-1 bg-gray-800 rounded-lg p-2">
                    <p className="text-gray-500">Last week</p>
                    <p className="text-white font-semibold">{fmt(s?.secondaryActions?.[key]?.lastWeek ?? 0)}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* ── Revenue / Subscription ── */}
        <section>
          <SectionTitle icon={TrendingUp} title="Revenue & Subscriptions" sub="No payment processor connected — subscription tier data shown" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <BigStat label="Total Companies" value={s?.revenue?.totalCompanies ?? 0} loading={loading} />
            <BigStat label="Paid Plans" value={s?.revenue?.paidTiers ?? 0} sub="Pro / Enterprise" loading={loading} accent />
            <BigStat label="Free Tier" value={(s?.revenue?.byTier?.free ?? 0)} sub="companies" loading={loading} />
            <BigStat label="ARPU" value="—" sub="Connect Stripe to track" loading={false} />
          </div>
          <Card>
            <p className="text-gray-500 text-xs mb-3 font-medium">Subscription Tier Breakdown</p>
            <div className="flex flex-wrap gap-3">
              {Object.entries(s?.revenue?.byTier ?? {}).map(([tier, count]: [string, any]) => (
                <div key={tier} className="bg-gray-800 rounded-lg px-4 py-3 flex flex-col items-center min-w-[80px]">
                  <span className="text-2xl font-bold text-white">{count}</span>
                  <span className="text-gray-400 text-xs capitalize mt-1">{tier}</span>
                </div>
              ))}
            </div>
            <p className="text-gray-600 text-xs mt-4 italic">Connect a payment processor (e.g. Stripe) to track revenue, MRR, churn rate, and transaction history.</p>
          </Card>
        </section>

        {/* ── Retention ── */}
        <section>
          <SectionTitle icon={UserCheck} title="Retention & Engagement" sub="How well users stick around" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <Card>
              <p className="text-gray-400 text-xs font-medium uppercase tracking-wide mb-2">Day 1 Retention</p>
              {loading ? <Skeleton className="h-14 w-24" /> : (
                <>
                  <p className="text-5xl font-extrabold text-white mb-1">{s?.retention?.day1 ?? 0}<span className="text-2xl text-gray-500">%</span></p>
                  <p className="text-gray-500 text-xs">Came back after day of signup</p>
                </>
              )}
            </Card>
            <Card>
              <p className="text-gray-400 text-xs font-medium uppercase tracking-wide mb-2">Week 1 Retention</p>
              {loading ? <Skeleton className="h-14 w-24" /> : (
                <>
                  <p className="text-5xl font-extrabold text-white mb-1">{s?.retention?.week1 ?? 0}<span className="text-2xl text-gray-500">%</span></p>
                  <p className="text-gray-500 text-xs">Came back within 7 days of signup</p>
                </>
              )}
            </Card>
            <Card>
              <p className="text-gray-400 text-xs font-medium uppercase tracking-wide mb-2">Time to First Action</p>
              {loading ? <Skeleton className="h-14 w-24" /> : (
                <>
                  <p className="text-5xl font-extrabold text-white mb-1">
                    {s?.speedMetrics?.avgHoursToFirstAction != null
                      ? s.speedMetrics.avgHoursToFirstAction < 1
                        ? `${Math.round(s.speedMetrics.avgHoursToFirstAction * 60)}m`
                        : `${s.speedMetrics.avgHoursToFirstAction}h`
                      : "—"}
                  </p>
                  <p className="text-gray-500 text-xs">Avg hours from signup → first upload</p>
                </>
              )}
            </Card>
          </div>

          {/* At-risk users */}
          {(s?.retention?.atRiskUsers?.length ?? 0) > 0 && (
            <Card>
              <div className="flex items-center gap-2 mb-3">
                <UserX className="w-4 h-4 text-yellow-500" />
                <p className="text-yellow-400 text-sm font-semibold">At-Risk Users</p>
                <span className="text-gray-500 text-xs">— were active, now quiet for 7–30 days</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left text-gray-500 text-xs font-medium uppercase tracking-wide pb-2">Name</th>
                      <th className="text-left text-gray-500 text-xs font-medium uppercase tracking-wide pb-2">Email</th>
                      <th className="text-left text-gray-500 text-xs font-medium uppercase tracking-wide pb-2">Last Active</th>
                      <th className="text-left text-gray-500 text-xs font-medium uppercase tracking-wide pb-2">Joined</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/60">
                    {s?.retention?.atRiskUsers?.map((u: any) => (
                      <tr key={u.id} className="hover:bg-gray-800/30">
                        <td className="py-2.5 pr-4 text-gray-200 font-medium">{u.name}</td>
                        <td className="py-2.5 pr-4 text-gray-400 text-xs">{u.email}</td>
                        <td className="py-2.5 pr-4 text-yellow-400 text-xs">{timeAgo(u.lastActiveAt)}</td>
                        <td className="py-2.5 text-gray-500 text-xs">{fmtDate(u.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </section>

        {/* ── Conversion Funnel ── */}
        <section>
          <SectionTitle icon={Zap} title="Conversion Funnel" sub="Signup → First action → Return visit → Power user" />
          <Card>
            {loading
              ? <Skeleton className="h-40 w-full" />
              : (
                <div className="space-y-4">
                  <FunnelStep label="Signups" count={s?.funnel?.signups ?? 0} total={s?.funnel?.signups ?? 1} sub="All registered users" />
                  <FunnelStep label="First Action" count={s?.funnel?.firstAction ?? 0} total={s?.funnel?.signups ?? 1} sub="Uploaded doc or photo" />
                  <FunnelStep label="Return Visit" count={s?.funnel?.returnVisit ?? 0} total={s?.funnel?.signups ?? 1} sub="Came back next day+" />
                  <FunnelStep label="Power User" count={s?.funnel?.powerUser ?? 0} total={s?.funnel?.signups ?? 1} sub="5+ document uploads" />
                </div>
              )
            }
            <div className="mt-5 flex gap-3 flex-wrap text-xs text-gray-500">
              {s?.funnel && (
                <>
                  <span>Signup → Action: <span className="text-white font-semibold">{s.funnel.signups > 0 ? Math.round((s.funnel.firstAction / s.funnel.signups) * 100) : 0}%</span></span>
                  <span>·</span>
                  <span>Action → Return: <span className="text-white font-semibold">{s.funnel.firstAction > 0 ? Math.round((s.funnel.returnVisit / s.funnel.firstAction) * 100) : 0}%</span></span>
                  <span>·</span>
                  <span>Return → Power: <span className="text-white font-semibold">{s.funnel.returnVisit > 0 ? Math.round((s.funnel.powerUser / s.funnel.returnVisit) * 100) : 0}%</span></span>
                </>
              )}
            </div>
          </Card>
        </section>

        {/* ── Feature Usage ── */}
        <section>
          <SectionTitle icon={BarChart2} title="Feature Usage" sub="Which features are used most" />
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900/60">
                  <th className="text-left text-gray-500 text-xs font-medium uppercase tracking-wide px-5 py-3">Feature</th>
                  <th className="text-right text-gray-500 text-xs font-medium uppercase tracking-wide px-5 py-3">Total Uses</th>
                  <th className="px-5 py-3 table-cell">
                    <span className="text-gray-500 text-xs font-medium uppercase tracking-wide">Usage bar</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                {loading
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i}><td className="px-5 py-3"><Skeleton className="h-4 w-32" /></td><td className="px-5 py-3 text-right"><Skeleton className="h-4 w-10 ml-auto" /></td><td className="px-5 py-3 table-cell"><Skeleton className="h-3 w-full" /></td></tr>
                    ))
                  : (() => {
                      const maxCount = Math.max(1, ...((s?.featureUsage ?? []) as any[]).map((f: any) => f.count));
                      return (s?.featureUsage ?? [] as any[]).map((f: any) => (
                        <tr key={f.name} className="hover:bg-gray-800/30 transition-colors">
                          <td className="px-5 py-3 text-gray-200 font-medium">{f.name}</td>
                          <td className="px-5 py-3 text-right text-white font-semibold">{fmt(f.count)}</td>
                          <td className="px-5 py-3 table-cell">
                            <div className="bg-gray-800 rounded-full h-2 overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-orange-700 to-orange-500 rounded-full" style={{ width: `${Math.round((f.count / maxCount) * 100)}%` }} />
                            </div>
                          </td>
                        </tr>
                      ));
                    })()
                }
              </tbody>
            </table>
            </div>
          </Card>
        </section>

        {/* ── Feature Adoption Speed ── */}
        <section>
          <SectionTitle icon={Zap} title="Feature Adoption Speed" sub="Average days from signup to first use of each feature" />
          {adoptionLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              {(featureAdoption ?? []).map((f: { feature: string; description: string; usersWhoUsed: number; avgDays: number | null }) => (
                <Card key={f.feature}>
                  <p className="text-gray-400 text-xs font-medium uppercase tracking-wide mb-1 truncate">{f.feature}</p>
                  <p className="text-gray-600 text-xs mb-3 truncate">{f.description}</p>
                  <div className="flex items-end justify-between gap-2">
                    <div>
                      <p className="text-3xl font-extrabold text-white leading-none">
                        {f.avgDays != null
                          ? f.avgDays < 1
                            ? `${Math.round(f.avgDays * 24)}h`
                            : `${f.avgDays}d`
                          : "—"}
                      </p>
                      <p className="text-gray-500 text-xs mt-1">avg to first use</p>
                    </div>
                    <div className="text-right">
                      <p className="text-orange-400 font-bold text-lg leading-none">{f.usersWhoUsed}</p>
                      <p className="text-gray-600 text-xs mt-1">{f.avgDays != null ? "users" : "total"}</p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* ── Power Users ── */}
        <section>
          <SectionTitle icon={Trophy} title="Power Users" sub="Top 10 most active users by document & photo uploads" />
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900/60">
                  <th className="text-left text-gray-500 text-xs font-medium uppercase tracking-wide px-5 py-3">#</th>
                  <th className="text-left text-gray-500 text-xs font-medium uppercase tracking-wide px-5 py-3">Name</th>
                  <th className="text-left text-gray-500 text-xs font-medium uppercase tracking-wide px-5 py-3 table-cell">Email</th>
                  <th className="text-left text-gray-500 text-xs font-medium uppercase tracking-wide px-5 py-3">Joined</th>
                  <th className="text-right text-gray-500 text-xs font-medium uppercase tracking-wide px-5 py-3">Actions</th>
                  <th className="text-right text-gray-500 text-xs font-medium uppercase tracking-wide px-5 py-3 table-cell">Last Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                {loading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i}><td className="px-5 py-3"><Skeleton className="h-4 w-4" /></td><td className="px-5 py-3"><Skeleton className="h-4 w-28" /></td><td className="px-5 py-3 table-cell"><Skeleton className="h-4 w-36" /></td><td className="px-5 py-3"><Skeleton className="h-4 w-20" /></td><td className="px-5 py-3 text-right"><Skeleton className="h-4 w-8 ml-auto" /></td><td className="px-5 py-3 table-cell"><Skeleton className="h-4 w-16 ml-auto" /></td></tr>
                    ))
                  : (s?.topUsers ?? []).length === 0
                    ? <tr><td colSpan={6} className="px-5 py-8 text-center text-gray-500">No user activity data yet</td></tr>
                    : (s?.topUsers ?? []).map((u: any, i: number) => (
                        <tr key={u.id} className="hover:bg-gray-800/30 transition-colors">
                          <td className="px-5 py-3 text-gray-500 font-mono text-xs">{i + 1}</td>
                          <td className="px-5 py-3 text-gray-200 font-medium">{u.name}</td>
                          <td className="px-5 py-3 text-gray-500 text-xs table-cell">{u.email}</td>
                          <td className="px-5 py-3 text-gray-500 text-xs">{fmtDate(u.signupDate)}</td>
                          <td className="px-5 py-3 text-right text-orange-400 font-bold">{fmt(u.totalActions)}</td>
                          <td className="px-5 py-3 text-right text-gray-500 text-xs table-cell">{timeAgo(u.lastActive)}</td>
                        </tr>
                      ))
                }
              </tbody>
            </table>
            </div>
          </Card>
        </section>

        {/* ── Charts ── */}
        <section>
          <SectionTitle icon={BarChart2} title="Charts & Trends" sub="Last 30 days and activity patterns" />
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

            {/* Users over time */}
            <Card>
              <p className="text-gray-300 font-semibold text-sm mb-4">New Users — Last 30 Days</p>
              {chartsLoading
                ? <Skeleton className="h-48 w-full" />
                : (
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={charts?.days ?? []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 11 }} tickFormatter={v => v.slice(5)} />
                      <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} allowDecimals={false} />
                      <Tooltip contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8, color: "#f3f4f6" }} labelStyle={{ color: "#9ca3af" }} />
                      <Line type="monotone" dataKey="users" stroke={ORANGE} strokeWidth={2.5} dot={false} name="New users" />
                    </LineChart>
                  </ResponsiveContainer>
                )
              }
            </Card>

            {/* Documents over time */}
            <Card>
              <p className="text-gray-300 font-semibold text-sm mb-4">Documents Uploaded — Last 30 Days</p>
              {chartsLoading
                ? <Skeleton className="h-48 w-full" />
                : (
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={charts?.days ?? []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 11 }} tickFormatter={v => v.slice(5)} />
                      <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} allowDecimals={false} />
                      <Tooltip contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8, color: "#f3f4f6" }} labelStyle={{ color: "#9ca3af" }} />
                      <Line type="monotone" dataKey="documents" stroke="#3b82f6" strokeWidth={2.5} dot={false} name="Documents" />
                    </LineChart>
                  </ResponsiveContainer>
                )
              }
            </Card>

            {/* Activity by day of week */}
            <Card>
              <p className="text-gray-300 font-semibold text-sm mb-4">Activity by Day of Week</p>
              {chartsLoading
                ? <Skeleton className="h-48 w-full" />
                : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={charts?.byDow ?? []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis dataKey="name" tick={{ fill: "#6b7280", fontSize: 11 }} />
                      <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} allowDecimals={false} />
                      <Tooltip contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8, color: "#f3f4f6" }} />
                      <Bar dataKey="count" fill={ORANGE} radius={[4, 4, 0, 0]} name="Actions" />
                    </BarChart>
                  </ResponsiveContainer>
                )
              }
            </Card>

            {/* Activity by hour of day */}
            <Card>
              <p className="text-gray-300 font-semibold text-sm mb-4">Activity by Hour of Day</p>
              {chartsLoading
                ? <Skeleton className="h-48 w-full" />
                : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={charts?.byHour ?? []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis dataKey="label" tick={{ fill: "#6b7280", fontSize: 10 }} interval={3} />
                      <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} allowDecimals={false} />
                      <Tooltip contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8, color: "#f3f4f6" }} />
                      <Bar dataKey="count" fill="#3b82f6" radius={[3, 3, 0, 0]} name="Actions" />
                    </BarChart>
                  </ResponsiveContainer>
                )
              }
            </Card>
          </div>
        </section>

        {/* ── Best Time to Post ── */}
        <section>
          <SectionTitle icon={Clock} title="Best Time to Post" sub="Peak platform activity by hour — post on social when your users are most active" />
          <Card>
            {chartsLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : (() => {
              const hours: { hour: number; label: string; count: number }[] = charts?.byHour ?? [];
              const maxCount = Math.max(...hours.map(h => h.count), 1);
              const sorted = [...hours].sort((a, b) => b.count - a.count);
              const top3 = new Set(sorted.slice(0, 3).map(h => h.hour));
              return (
                <>
                  <div className="flex flex-wrap gap-3 mb-6">
                    {sorted.slice(0, 3).map((h, i) => (
                      <div key={h.hour} className={`flex items-center gap-2 px-4 py-2 rounded-xl border ${i === 0 ? "bg-orange-600/20 border-orange-500/40 text-orange-300" : "bg-gray-800 border-gray-700 text-gray-300"}`}>
                        <span className="text-lg font-bold">{h.label}</span>
                        <span className="text-xs opacity-70">#{i + 1} peak</span>
                      </div>
                    ))}
                    {sorted[0] && (
                      <p className="w-full text-gray-500 text-xs mt-1">
                        Post around <span className="text-orange-400 font-semibold">{sorted[0].label}</span> for maximum reach — that's when your users are most active.
                      </p>
                    )}
                  </div>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={hours} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis dataKey="label" tick={{ fill: "#6b7280", fontSize: 10 }} interval={3} />
                      <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8, color: "#f3f4f6" }}
                        formatter={(v: number) => [v, "actions"]}
                        labelFormatter={l => `${l} — ${Math.round((Number(hours.find(h => h.label === l)?.count ?? 0) / maxCount) * 100)}% of peak`}
                      />
                      <Bar dataKey="count" radius={[3, 3, 0, 0]} name="Actions">
                        {hours.map(h => (
                          <Cell key={h.hour} fill={top3.has(h.hour) ? ORANGE : "#374151"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </>
              );
            })()}
          </Card>
        </section>

        {/* ── Lapsed This Week ── */}
        <section>
          <SectionTitle icon={UserX} title="Active Last Week — Gone This Week" sub="Users who were active 7–14 days ago but haven't logged in since" />
          {lapsedLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : !lapsedUsers?.length ? (
            <Card><p className="text-gray-400 text-sm">No lapsed users this week — everyone who was active last week has returned.</p></Card>
          ) : (
            <Card className="p-0 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
                <p className="text-gray-300 text-sm font-semibold">
                  {lapsedUsers.length} {lapsedUsers.length === 1 ? "user" : "users"} went quiet this week
                </p>
                <button
                  onClick={() => {
                    const emails = lapsedUsers.map((u: { email: string }) => u.email).join(",");
                    window.open(`mailto:${emails}?subject=We%20miss%20you%20on%20SiteSort&body=Hi%20there%2C%0A%0AWe%20noticed%20you%20haven%27t%20been%20on%20SiteSort%20this%20week%20%E2%80%94%20is%20everything%20okay%3F%20Let%20us%20know%20if%20there%27s%20anything%20we%20can%20help%20with.%0A%0AKind%20regards%2C%0AThe%20SiteSort%20Team`, "_blank");
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-xs font-semibold transition-colors"
                >
                  Email All ({lapsedUsers.length})
                </button>
              </div>
              <div className="divide-y divide-gray-800">
                {lapsedUsers.map((u: { id: string; name: string; email: string; role: string; lastActiveAt: string; signedUpAt: string }) => (
                  <div key={u.id} className="flex items-center justify-between px-5 py-3 hover:bg-gray-800/40 transition-colors">
                    <div className="min-w-0">
                      <p className="text-gray-200 text-sm font-medium truncate">{u.name}</p>
                      <p className="text-gray-500 text-xs truncate">{u.email} · last active {timeAgo(u.lastActiveAt)}</p>
                    </div>
                    <a
                      href={`mailto:${u.email}?subject=We%20miss%20you%20on%20SiteSort`}
                      className="ml-4 flex-shrink-0 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg text-xs font-medium transition-colors"
                    >
                      Email
                    </a>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </section>

        {/* ── Dormant Users ── */}
        <section>
          <SectionTitle icon={UserX} title="Signed Up — Never Active" sub="Users who registered but have never uploaded a document, photo, permit, or sign-off" />
          {dormantLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : !dormantUsers?.length ? (
            <Card><p className="text-gray-400 text-sm">No dormant users — everyone has taken at least one action.</p></Card>
          ) : (
            <Card className="p-0 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
                <p className="text-gray-300 text-sm font-semibold">{dormantUsers.length} dormant {dormantUsers.length === 1 ? "user" : "users"}</p>
                <button
                  onClick={() => {
                    const emails = dormantUsers.map((u: { email: string }) => u.email).join(",");
                    window.open(`mailto:${emails}?subject=Getting%20started%20with%20SiteSort&body=Hi%20there%2C%0A%0AWe%20noticed%20you%20signed%20up%20to%20SiteSort%20but%20haven%27t%20had%20a%20chance%20to%20explore%20it%20yet.%20We%27d%20love%20to%20help%20you%20get%20started!%0A%0AKind%20regards%2C%0AThe%20SiteSort%20Team`, "_blank");
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-xs font-semibold transition-colors"
                >
                  Email All ({dormantUsers.length})
                </button>
              </div>
              <div className="divide-y divide-gray-800">
                {dormantUsers.map((u: { id: string; name: string; email: string; role: string; signedUpAt: string }) => (
                  <div key={u.id} className="flex items-center justify-between px-5 py-3 hover:bg-gray-800/40 transition-colors">
                    <div className="min-w-0">
                      <p className="text-gray-200 text-sm font-medium truncate">{u.name}</p>
                      <p className="text-gray-500 text-xs truncate">{u.email} · {u.role} · signed up {fmtDate(u.signedUpAt)}</p>
                    </div>
                    <a
                      href={`mailto:${u.email}?subject=Getting%20started%20with%20SiteSort`}
                      className="ml-4 flex-shrink-0 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg text-xs font-medium transition-colors"
                    >
                      Email
                    </a>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </section>

        {/* ── Not-tracked sections ── */}
        <section>
          <SectionTitle icon={AlertCircle} title="Not Yet Tracked" sub="These sections require additional instrumentation" />
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { icon: "🌍", label: "Geography", note: "IP-based geolocation not tracked" },
              { icon: "📱", label: "Devices & Browsers", note: "User-agent logging not enabled" },
              { icon: "⚠️", label: "Errors & Issues", note: "Error tracking (e.g. Sentry) not configured" },
              { icon: "🔍", label: "Search Analytics", note: "No search events tracked" },
            ].map(s => (
              <Card key={s.label} className="opacity-60">
                <p className="text-2xl mb-2">{s.icon}</p>
                <p className="text-gray-300 font-semibold text-sm mb-1">{s.label}</p>
                <p className="text-gray-600 text-xs">{s.note}</p>
              </Card>
            ))}
          </div>
        </section>

        {/* ── Companies & Beta Access ── */}
        <section>
          <SectionTitle icon={FlaskConical} title="Companies & Beta Access" sub="Manage beta access per company — bypasses all Stripe subscription checks" />
          <div className="rounded-xl border border-gray-800 overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900/60">
                  <th className="text-left text-gray-500 text-xs font-medium uppercase tracking-wide px-5 py-3">Company</th>
                  <th className="text-left text-gray-500 text-xs font-medium uppercase tracking-wide px-5 py-3 table-cell">Plan</th>
                  <th className="text-left text-gray-500 text-xs font-medium uppercase tracking-wide px-5 py-3 table-cell">Status</th>
                  <th className="text-right text-gray-500 text-xs font-medium uppercase tracking-wide px-5 py-3 table-cell">Users</th>
                  <th className="text-left text-gray-500 text-xs font-medium uppercase tracking-wide px-5 py-3 table-cell">Created</th>
                  <th className="text-center text-gray-500 text-xs font-medium uppercase tracking-wide px-5 py-3">Beta</th>
                  <th className="text-center text-gray-500 text-xs font-medium uppercase tracking-wide px-5 py-3">Delete</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {companiesLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>
                      <td className="px-5 py-3"><Skeleton className="h-4 w-32" /></td>
                      <td className="px-5 py-3 table-cell"><Skeleton className="h-4 w-16" /></td>
                      <td className="px-5 py-3 table-cell"><Skeleton className="h-4 w-16" /></td>
                      <td className="px-5 py-3 table-cell"><Skeleton className="h-4 w-8 ml-auto" /></td>
                      <td className="px-5 py-3 table-cell"><Skeleton className="h-4 w-24" /></td>
                      <td className="px-5 py-3"><Skeleton className="h-6 w-12 mx-auto rounded-full" /></td>
                      <td className="px-5 py-3"><Skeleton className="h-6 w-8 mx-auto rounded" /></td>
                    </tr>
                  ))
                ) : (companies ?? []).length === 0 ? (
                  <tr><td colSpan={7} className="px-5 py-8 text-center text-gray-600 text-sm">No companies found.</td></tr>
                ) : (
                  (companies as Array<{ id: string; name: string; subscriptionTier: string; subscriptionStatus: string; betaAccess: boolean; userCount: number; createdAt: string }>).map(c => (
                    <tr key={c.id} className="hover:bg-gray-900/40 transition-colors">
                      <td className="px-5 py-3 font-medium text-gray-200">{c.name}</td>
                      <td className="px-5 py-3 table-cell">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${
                          c.subscriptionTier === "pro" ? "bg-purple-900/50 text-purple-300" :
                          c.subscriptionTier === "team" ? "bg-blue-900/50 text-blue-300" :
                          c.subscriptionTier === "solo" ? "bg-emerald-900/50 text-emerald-300" :
                          "bg-gray-800 text-gray-400"
                        }`}>{c.subscriptionTier}</span>
                      </td>
                      <td className="px-5 py-3 table-cell">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${
                          c.subscriptionStatus === "active" ? "bg-emerald-900/40 text-emerald-400" :
                          c.subscriptionStatus === "trialing" ? "bg-amber-900/40 text-amber-400" :
                          c.subscriptionStatus === "cancelled" ? "bg-red-900/40 text-red-400" :
                          "bg-gray-800 text-gray-400"
                        }`}>{c.subscriptionStatus}</span>
                      </td>
                      <td className="px-5 py-3 text-right text-gray-400 text-xs table-cell">{c.userCount}</td>
                      <td className="px-5 py-3 text-gray-500 text-xs table-cell">{fmtDate(c.createdAt)}</td>
                      <td className="px-5 py-3 text-center">
                        <button
                          onClick={() => toggleBeta(c.id, c.betaAccess)}
                          disabled={betaTogglingId === c.id}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${
                            c.betaAccess ? "bg-orange-500" : "bg-gray-700"
                          }`}
                          title={c.betaAccess ? "Disable beta access" : "Enable beta access"}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            c.betaAccess ? "translate-x-6" : "translate-x-1"
                          }`} />
                        </button>
                      </td>
                      <td className="px-5 py-3 text-center">
                        {confirmDeleteId === c.id ? (
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => deleteCompany(c.id)}
                              disabled={deletingCompanyId === c.id}
                              className="px-2 py-1 rounded text-[11px] font-semibold bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-50"
                            >
                              {deletingCompanyId === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Confirm"}
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1 rounded text-[11px] font-semibold bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(c.id)}
                            disabled={!!deletingCompanyId}
                            className="p-1.5 rounded text-gray-600 hover:text-red-400 hover:bg-red-900/20 transition-colors disabled:opacity-30"
                            title="Delete company and all data"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </div>
          </div>
        </section>

        {/* ── Data Export ── */}
        <section>
          <SectionTitle icon={Download} title="Data Export" sub="Export raw data to CSV" />
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => downloadCsv("/api/admin/export/users", "sitesort-users.csv")}
              className="flex items-center gap-2 px-5 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg font-semibold text-sm transition-colors border border-gray-700"
            >
              <Download className="w-4 h-4" />
              Export Users CSV
            </button>
            <button
              onClick={() => downloadCsv("/api/admin/export/activity", "sitesort-activity.csv")}
              className="flex items-center gap-2 px-5 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg font-semibold text-sm transition-colors border border-gray-700"
            >
              <Download className="w-4 h-4" />
              Export Activity CSV
            </button>
          </div>
        </section>

        <div className="h-10" />
      </main>
    </div>
  );
}
