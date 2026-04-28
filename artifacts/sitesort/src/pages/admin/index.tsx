import { useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Users, FileText, PenLine, ClipboardCheck, ShieldCheck, QrCode, Camera,
  Building2, Bell, TrendingUp, TrendingDown, Minus, AlertTriangle,
  CheckCircle2, AlertCircle, Download, RefreshCw, HardHat, Clock,
  Activity, Layers, Zap, UserCheck, UserX, Trophy, BarChart2,
} from "lucide-react";

const ADMIN_EMAIL = "dean.parrish@me.com";
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
      {sub && <div className="text-gray-600 text-xs flex-shrink-0 hidden md:block">{sub}</div>}
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
  const { data: charts, isLoading: chartsLoading } = useChartData();
  const { data: activity, isLoading: activityLoading } = useActivity();

  const refetchAll = useCallback(() => {
    refetchStats();
  }, [refetchStats]);

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

  if (!me || me.email !== ADMIN_EMAIL) {
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
            <div className="w-7 h-7 bg-gradient-to-br from-orange-700 to-orange-500 rounded-lg flex items-center justify-center">
              <Building2 className="w-4 h-4 text-white" />
            </div>
            <span className="text-white font-bold text-sm hidden sm:block">SiteSort</span>
            <span className="text-gray-600 text-sm hidden sm:block">/</span>
            <span className="text-orange-400 font-semibold text-sm">Admin</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-gray-500 text-xs hidden sm:block">
              {dataUpdatedAt ? `Updated ${timeAgo(new Date(dataUpdatedAt).toISOString())}` : "Loading…"}
            </span>
            <button
              onClick={refetchAll}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-medium transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
            <button onClick={() => setLocation("/dashboard")} className="text-gray-500 hover:text-white text-xs transition-colors hidden sm:block">
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
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
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-900/60">
                    <th className="text-left text-gray-500 text-xs font-medium uppercase tracking-wide px-4 py-3">Type</th>
                    <th className="text-left text-gray-500 text-xs font-medium uppercase tracking-wide px-4 py-3">User</th>
                    <th className="text-left text-gray-500 text-xs font-medium uppercase tracking-wide px-4 py-3">Detail</th>
                    <th className="text-left text-gray-500 text-xs font-medium uppercase tracking-wide px-4 py-3 hidden md:table-cell">Sub-detail</th>
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
                          <td className="px-4 py-3 hidden md:table-cell"><Skeleton className="h-4 w-20" /></td>
                          <td className="px-4 py-3"><Skeleton className="h-4 w-16" /></td>
                        </tr>
                      ))
                    : (activity ?? []).map((a: any) => (
                        <tr key={a.id + a.ts} className="hover:bg-gray-800/30 transition-colors">
                          <td className="px-4 py-3"><ActivityBadge type={a.type} /></td>
                          <td className="px-4 py-3 text-gray-300 font-medium">{a.userName}</td>
                          <td className="px-4 py-3 text-gray-400 max-w-[180px] truncate">{a.detail}</td>
                          <td className="px-4 py-3 text-gray-600 text-xs hidden md:table-cell max-w-[140px] truncate">{a.subDetail}</td>
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
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
                    {s.retention.atRiskUsers.map((u: any) => (
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
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900/60">
                  <th className="text-left text-gray-500 text-xs font-medium uppercase tracking-wide px-5 py-3">Feature</th>
                  <th className="text-right text-gray-500 text-xs font-medium uppercase tracking-wide px-5 py-3">Total Uses</th>
                  <th className="px-5 py-3 hidden sm:table-cell">
                    <span className="text-gray-500 text-xs font-medium uppercase tracking-wide">Usage bar</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                {loading
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i}><td className="px-5 py-3"><Skeleton className="h-4 w-32" /></td><td className="px-5 py-3 text-right"><Skeleton className="h-4 w-10 ml-auto" /></td><td className="px-5 py-3 hidden sm:table-cell"><Skeleton className="h-3 w-full" /></td></tr>
                    ))
                  : (() => {
                      const maxCount = Math.max(1, ...((s?.featureUsage ?? []) as any[]).map((f: any) => f.count));
                      return (s?.featureUsage ?? [] as any[]).map((f: any) => (
                        <tr key={f.name} className="hover:bg-gray-800/30 transition-colors">
                          <td className="px-5 py-3 text-gray-200 font-medium">{f.name}</td>
                          <td className="px-5 py-3 text-right text-white font-semibold">{fmt(f.count)}</td>
                          <td className="px-5 py-3 hidden sm:table-cell">
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
          </Card>
        </section>

        {/* ── Power Users ── */}
        <section>
          <SectionTitle icon={Trophy} title="Power Users" sub="Top 10 most active users by document & photo uploads" />
          <Card className="p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900/60">
                  <th className="text-left text-gray-500 text-xs font-medium uppercase tracking-wide px-5 py-3">#</th>
                  <th className="text-left text-gray-500 text-xs font-medium uppercase tracking-wide px-5 py-3">Name</th>
                  <th className="text-left text-gray-500 text-xs font-medium uppercase tracking-wide px-5 py-3 hidden sm:table-cell">Email</th>
                  <th className="text-left text-gray-500 text-xs font-medium uppercase tracking-wide px-5 py-3">Joined</th>
                  <th className="text-right text-gray-500 text-xs font-medium uppercase tracking-wide px-5 py-3">Actions</th>
                  <th className="text-right text-gray-500 text-xs font-medium uppercase tracking-wide px-5 py-3 hidden md:table-cell">Last Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                {loading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i}><td className="px-5 py-3"><Skeleton className="h-4 w-4" /></td><td className="px-5 py-3"><Skeleton className="h-4 w-28" /></td><td className="px-5 py-3 hidden sm:table-cell"><Skeleton className="h-4 w-36" /></td><td className="px-5 py-3"><Skeleton className="h-4 w-20" /></td><td className="px-5 py-3 text-right"><Skeleton className="h-4 w-8 ml-auto" /></td><td className="px-5 py-3 hidden md:table-cell"><Skeleton className="h-4 w-16 ml-auto" /></td></tr>
                    ))
                  : (s?.topUsers ?? []).length === 0
                    ? <tr><td colSpan={6} className="px-5 py-8 text-center text-gray-500">No user activity data yet</td></tr>
                    : (s?.topUsers ?? []).map((u: any, i: number) => (
                        <tr key={u.id} className="hover:bg-gray-800/30 transition-colors">
                          <td className="px-5 py-3 text-gray-500 font-mono text-xs">{i + 1}</td>
                          <td className="px-5 py-3 text-gray-200 font-medium">{u.name}</td>
                          <td className="px-5 py-3 text-gray-500 text-xs hidden sm:table-cell">{u.email}</td>
                          <td className="px-5 py-3 text-gray-500 text-xs">{fmtDate(u.signupDate)}</td>
                          <td className="px-5 py-3 text-right text-orange-400 font-bold">{fmt(u.totalActions)}</td>
                          <td className="px-5 py-3 text-right text-gray-500 text-xs hidden md:table-cell">{timeAgo(u.lastActive)}</td>
                        </tr>
                      ))
                }
              </tbody>
            </table>
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

        {/* ── Not-tracked sections ── */}
        <section>
          <SectionTitle icon={AlertCircle} title="Not Yet Tracked" sub="These sections require additional instrumentation" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
