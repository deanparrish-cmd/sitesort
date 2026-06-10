import { useState, useMemo, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Building2, AlertTriangle, ChevronLeft, ChevronRight, ArrowRight,
  ShieldAlert, FileSignature, Users, Bell, Search,
  MessageSquare, Camera, FilePlus, Plus, AlertCircle, CreditCard,
  FileText, CheckCircle2, Clock, TrendingUp, Zap, X, Circle,
} from "lucide-react";
import { useListProjects, useGetComplianceOverview } from "@workspace/api-client-react";
import type { ExpiringInsuranceItem, ExpiringPermitItem } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { useCapabilities } from "@/hooks/use-capabilities";

type CalEvent = { date: string; label: string; type: "project-start" | "project-end" | "permit" | "insurance" | "invoice-out" | "invoice-in" };
type ExpiryAlert = { label: string; expiryDate: string; kind: "permit" | "insurance"; daysLeft: number };
type Notification = { id: string; type: string; title: string; message: string; read: boolean; createdAt: string; relatedEntityId?: string; relatedEntityType?: string };
type Invoice = { id: string; direction: string; counterpartyName: string; description: string; amount: string; currency: string; dueDate: string; status: string; reference?: string };

const EVENT_STYLES: Record<CalEvent["type"], { dot: string; badge: string; label: string }> = {
  "project-start": { dot: "bg-primary",     badge: "bg-primary/10 text-primary border-primary/20",              label: "Project Start"    },
  "project-end":   { dot: "bg-destructive",  badge: "bg-destructive/10 text-destructive border-destructive/20",   label: "Project End"      },
  "permit":        { dot: "bg-yellow-500",   badge: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20",      label: "Permit Expiry"    },
  "insurance":     { dot: "bg-blue-500",     badge: "bg-blue-500/10 text-blue-700 border-blue-500/20",            label: "Insurance Expiry" },
  "invoice-out":   { dot: "bg-rose-500",     badge: "bg-rose-500/10 text-rose-700 border-rose-500/20",            label: "Payment Due"      },
  "invoice-in":    { dot: "bg-emerald-500",  badge: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",   label: "Invoice Due In"   },
};

function notifIcon(type: string) {
  switch (type) {
    case "new_message":    return <MessageSquare className="w-4 h-4 text-blue-500" />;
    case "document_uploaded": return <FileText className="w-4 h-4 text-indigo-500" />;
    case "safety_concern": return <AlertTriangle className="w-4 h-4 text-amber-500" />;
    case "trial_ending":   return <CreditCard className="w-4 h-4 text-orange-500" />;
    case "payment_failed": return <CreditCard className="w-4 h-4 text-red-500" />;
    default:               return <Bell className="w-4 h-4 text-muted-foreground" />;
  }
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d}d ago`;
  if (h >= 1) return `${h}h ago`;
  if (m >= 1) return `${m}m ago`;
  return "just now";
}

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem("sitesort_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function SiteCalendar({ events, alerts }: { events: CalEvent[]; alerts: ExpiryAlert[] }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const byDate = useMemo(() => {
    const map: Record<string, CalEvent[]> = {};
    for (const e of events) (map[e.date] ??= []).push(e);
    return map;
  }, [events]);

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const blanks = (firstDay + 6) % 7;
  const cells: (number | null)[] = [
    ...Array(blanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const monthLabel = new Date(year, month).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  const upcoming = events
    .filter(e => e.date >= todayKey)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 8);

  function prevMonth() { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); }
  function nextMonth() { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Site Calendar</CardTitle>
          <div className="flex items-center gap-2">
            <button onClick={prevMonth} className="p-1 rounded hover:bg-muted transition-colors"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-sm font-semibold w-36 text-center">{monthLabel}</span>
            <button onClick={nextMonth} className="p-1 rounded hover:bg-muted transition-colors"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {alerts.length > 0 && (
          <div className="mb-4 space-y-2">
            {alerts.map((a, i) => {
              const expired = a.daysLeft < 0;
              const urgent  = a.daysLeft <= 7;
              const soon    = a.daysLeft <= 30;
              const styles = expired
                ? "bg-destructive/10 border-destructive/30 text-destructive"
                : urgent
                ? "bg-orange-500/10 border-orange-500/30 text-orange-700 dark:text-orange-400"
                : soon
                ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-400"
                : "bg-muted border-border text-muted-foreground";
              const tag = expired ? "Expired" : urgent ? "Expires soon" : `${a.daysLeft}d`;
              return (
                <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${styles}`}>
                  <Bell className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="flex-1 font-medium truncate">{a.label}</span>
                  <span className="flex-shrink-0 font-semibold">{tag}</span>
                </div>
              );
            })}
            <Link href="/compliance" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1">
              <ArrowRight className="w-3 h-3" /> View Compliance Centre
            </Link>
          </div>
        )}
        <div className="grid grid-cols-7 mb-1">
          {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => (
            <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-1">
          {cells.map((day, i) => {
            if (!day) return <div key={`blank-${i}`} />;
            const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const dayEvents = byDate[key] ?? [];
            const isToday = key === todayKey;
            return (
              <div key={key} className="flex flex-col items-center py-1 gap-0.5">
                <span className={`text-xs w-7 h-7 flex items-center justify-center rounded-full font-medium transition-colors
                  ${isToday ? "bg-primary text-primary-foreground font-bold" : "text-foreground hover:bg-muted"}`}>
                  {day}
                </span>
                <div className="flex gap-0.5 flex-wrap justify-center">
                  {dayEvents.slice(0, 3).map((e, j) => (
                    <span key={j} title={e.label} className={`w-1.5 h-1.5 rounded-full ${EVENT_STYLES[e.type].dot}`} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 pt-3 border-t">
          {(Object.entries(EVENT_STYLES) as [CalEvent["type"], typeof EVENT_STYLES[CalEvent["type"]]][]).map(([, s]) => (
            <span key={s.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={`w-2 h-2 rounded-full ${s.dot}`} />{s.label}
            </span>
          ))}
        </div>
        {upcoming.length > 0 && (
          <div className="mt-4 pt-3 border-t space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Upcoming</p>
            {upcoming.map((e, i) => (
              <div key={i} className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs ${EVENT_STYLES[e.type].badge}`}>
                <span className="font-medium truncate">{e.label}</span>
                <span className="ml-3 flex-shrink-0 font-mono">{new Date(e.date + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatCard({ icon, label, value, sub, href, color }: {
  icon: React.ReactNode; label: string; value: number | string;
  sub?: string; href?: string; color?: string;
}) {
  const inner = (
    <Card className={cn("h-full transition-all", href && "hover:shadow-md hover:border-primary/30 cursor-pointer", color)}>
      <CardContent className="pt-5 pb-4 px-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
          {icon}
        </div>
        <div className="text-3xl font-extrabold mb-1">{value}</div>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export default function Dashboard() {
  const [, navigate] = useLocation();
  const { data: projects, isLoading: projectsLoading } = useListProjects();
  const { data: compliance } = useGetComplianceOverview();
  const caps = useCapabilities();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [userName, setUserName] = useState<string>("");

  type OnboardingStatus = { hasProject: boolean; hasTeamMember: boolean; hasDocument: boolean; hasSubcontractor: boolean; hasMilestone: boolean };
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [onboardingDismissed, setOnboardingDismissed] = useState(() => localStorage.getItem("sitesort_onboarding_dismissed") === "1");

  useEffect(() => {
    const h = authHeaders();
    fetch("/api/invoices", { headers: h }).then(r => r.ok ? r.json() : []).then(setInvoices).catch(() => {});
    fetch("/api/notifications", { headers: h }).then(r => r.ok ? r.json() : []).then(setNotifications).catch(() => {});
    fetch("/api/messages/unread-count", { headers: h }).then(r => r.ok ? r.json() : { count: 0 }).then(d => setUnreadMessages(d.count ?? 0)).catch(() => {});
    fetch("/api/auth/me", { headers: h }).then(r => r.ok ? r.json() : null).then(u => { if (u?.name) setUserName(u.name.split(" ")[0]); }).catch(() => {});
    fetch("/api/onboarding/status", { headers: h }).then(r => r.ok ? r.json() : null).then(setOnboarding).catch(() => {});
  }, []);

  const [search, setSearch] = useState("");

  const { calendarEvents, expiryAlerts } = useMemo(() => {
    const events: CalEvent[] = [];
    const alerts: ExpiryAlert[] = [];
    const todayMs = new Date().setHours(0, 0, 0, 0);
    for (const p of projects ?? []) {
      if (p.startDate) events.push({ date: p.startDate.slice(0, 10), label: `${p.name} starts`, type: "project-start" });
      if (p.targetEndDate) events.push({ date: p.targetEndDate.slice(0, 10), label: `${p.name} ends`, type: "project-end" });
    }
    for (const ins of (compliance?.expiringInsurance ?? []) as ExpiringInsuranceItem[]) {
      const date = ins.expiryDate.slice(0, 10);
      events.push({ date, label: `${ins.subcontractorName} — ${ins.insuranceType}`, type: "insurance" });
      const daysLeft = Math.ceil((new Date(date).getTime() - todayMs) / 86400000);
      alerts.push({ label: `${ins.subcontractorName} — ${ins.insuranceType}`, expiryDate: date, kind: "insurance", daysLeft });
    }
    for (const permit of (compliance?.expiringPermits ?? []) as ExpiringPermitItem[]) {
      const date = permit.expiryDate.slice(0, 10);
      events.push({ date, label: `${permit.projectName} — ${permit.permitType}`, type: "permit" });
      const daysLeft = Math.ceil((new Date(date).getTime() - todayMs) / 86400000);
      alerts.push({ label: `${permit.projectName} — ${permit.permitType}`, expiryDate: date, kind: "permit", daysLeft });
    }
    for (const inv of invoices) {
      if (inv.status === "paid") continue;
      const date = inv.dueDate.slice(0, 10);
      const type: CalEvent["type"] = inv.direction === "outbound" ? "invoice-out" : "invoice-in";
      const prefix = inv.direction === "outbound" ? "Pay" : "Receive";
      const amount = `${inv.currency} ${Number(inv.amount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
      events.push({ date, label: `${prefix}: ${inv.counterpartyName} — ${amount}`, type });
    }
    alerts.sort((a, b) => a.daysLeft - b.daysLeft);
    return { calendarEvents: events, expiryAlerts: alerts };
  }, [projects, compliance, invoices]);

  const todayStr = new Date().toISOString().slice(0, 10);

  const attentionItems = useMemo(() => {
    const items: { icon: React.ReactNode; label: string; href: string; severity: "critical" | "warning" }[] = [];

    // Expired compliance
    for (const a of expiryAlerts) {
      if (a.daysLeft < 0) items.push({ icon: <ShieldAlert className="w-4 h-4" />, label: `${a.label} — expired`, href: "/compliance", severity: "critical" });
      else if (a.daysLeft <= 3) items.push({ icon: <ShieldAlert className="w-4 h-4" />, label: `${a.label} — expires in ${a.daysLeft}d`, href: "/compliance", severity: "critical" });
    }

    // Overdue invoices
    const overdue = invoices.filter(inv => inv.status !== "paid" && inv.dueDate.slice(0, 10) < todayStr);
    if (overdue.length > 0)
      items.push({ icon: <FileText className="w-4 h-4" />, label: `${overdue.length} overdue invoice${overdue.length > 1 ? "s" : ""}`, href: "/invoices", severity: "critical" });

    // Pending sign-offs
    const pending = compliance?.pendingAcknowledgments?.reduce((a, c) => a + c.pendingCount, 0) ?? 0;
    if (pending > 0)
      items.push({ icon: <FileSignature className="w-4 h-4" />, label: `${pending} pending document sign-off${pending > 1 ? "s" : ""}`, href: "/projects", severity: "warning" });

    // Unread messages
    if (unreadMessages > 0)
      items.push({ icon: <MessageSquare className="w-4 h-4" />, label: `${unreadMessages} unread message${unreadMessages > 1 ? "s" : ""}`, href: "/messages", severity: "warning" });

    return items;
  }, [expiryAlerts, invoices, compliance, unreadMessages, todayStr]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dateLabel = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const activeProjects = projects?.filter(p => p.status === "active") ?? [];
  const expiringCount = (compliance?.expiringInsurance?.length ?? 0) + (compliance?.expiringPermits?.length ?? 0);
  const pendingSignOffs = compliance?.pendingAcknowledgments?.reduce((a, c) => a + c.pendingCount, 0) ?? 0;

  const filteredProjects = activeProjects.filter(p =>
    !search ||
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.address.toLowerCase().includes(search.toLowerCase())
  );

  const recentActivity = notifications.slice(0, 8);

  return (
    <SidebarLayout>
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">
            {greeting}{userName ? `, ${userName}` : ""}!
          </h1>
          <p className="text-muted-foreground mt-1">{dateLabel}</p>
        </div>
        <div className="flex flex-wrap gap-2 sm:flex-nowrap">
          {caps.canManageProjects && (
            <Button variant="accent" size="sm" onClick={() => navigate("/projects?new=1")}>
              <Plus className="w-4 h-4 mr-1.5" /> New Project
            </Button>
          )}
          {caps.canLogPhoto && (
            <Button variant="outline" size="sm" onClick={() => navigate("/projects?photo=1")}>
              <Camera className="w-4 h-4 mr-1.5" /> Log Photo
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => navigate("/messages?new=1")}>
            <MessageSquare className="w-4 h-4 mr-1.5" /> Message
          </Button>
          {caps.canUploadDocument && (
            <Button variant="outline" size="sm" onClick={() => navigate("/compliance?upload=1")}>
              <FilePlus className="w-4 h-4 mr-1.5" /> Upload Doc
            </Button>
          )}
        </div>
      </div>

      {/* Onboarding checklist — setup actions are manager-only */}
      {onboarding && !onboardingDismissed && caps.canManageProjects && (() => {
        const steps = [
          { key: "hasProject",       done: onboarding.hasProject,       title: "Create your first project",         desc: "Set up a project with a name, address, and start date.",  href: "/projects?new=1",       cta: "Create project" },
          { key: "hasTeamMember",    done: onboarding.hasTeamMember,    title: "Invite an in house team member",    desc: "Add a colleague to one of your projects.",                 href: "/subcontractors?new=1", cta: "Add to directory" },
          { key: "hasDocument",      done: onboarding.hasDocument,      title: "Upload your first document",        desc: "Share a drawing, method statement, or compliance doc.",    href: "/projects",             cta: "Go to projects" },
          { key: "hasSubcontractor", done: onboarding.hasSubcontractor, title: "Add a contact",                    desc: "Build your directory of contacts with trade info.",         href: "/subcontractors",       cta: "Add contact" },
          { key: "hasMilestone",     done: onboarding.hasMilestone,     title: "Set milestones on a project",      desc: "Track progress with key dates and completion markers.",     href: "/projects",             cta: "Go to projects" },
        ];
        const doneCount = steps.filter(s => s.done).length;
        const allDone = doneCount === steps.length;

        if (allDone) return null;

        return (
          <div className="mb-6 rounded-xl border border-primary/20 bg-primary/5 p-5 relative">
            <button
              onClick={() => { localStorage.setItem("sitesort_onboarding_dismissed", "1"); setOnboardingDismissed(true); }}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-center justify-between mb-1 pr-6">
              <h2 className="font-bold text-base">Get started with SiteSort</h2>
              <span className="text-sm font-semibold text-primary">{doneCount}/{steps.length} complete</span>
            </div>
            <div className="w-full bg-muted rounded-full h-1.5 mb-4 overflow-hidden">
              <div className="h-1.5 rounded-full bg-primary transition-all duration-500" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {steps.map(step => (
                <div key={step.key} className={cn("flex gap-3 rounded-lg p-3 border transition-colors", step.done ? "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800" : "bg-card border-border")}>
                  <div className="shrink-0 mt-0.5">
                    {step.done
                      ? <CheckCircle2 className="w-5 h-5 text-green-500" />
                      : <Circle className="w-5 h-5 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-sm font-semibold", step.done && "line-through text-muted-foreground")}>{step.title}</p>
                    {!step.done && <p className="text-xs text-muted-foreground mt-0.5">{step.desc}</p>}
                    {!step.done && (
                      <button onClick={() => navigate(step.href)} className="mt-1.5 text-xs font-medium text-primary hover:underline">
                        {step.cta} →
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          icon={<Building2 className="w-5 h-5 text-primary" />}
          label="Active Projects"
          value={activeProjects.length}
          sub={`${(projects?.filter(p => p.status === "completed") ?? []).length} completed`}
          href="/projects"
        />
        <StatCard
          icon={<ShieldAlert className={cn("w-5 h-5", expiringCount > 0 ? "text-orange-500" : "text-muted-foreground")} />}
          label="Expiring Soon"
          value={expiringCount}
          sub="insurance + permits (30d)"
          href="/compliance"
          color={expiringCount > 0 ? "border-orange-200 bg-orange-50/50" : undefined}
        />
        <StatCard
          icon={<FileSignature className={cn("w-5 h-5", pendingSignOffs > 0 ? "text-destructive" : "text-muted-foreground")} />}
          label="Pending Sign-offs"
          value={pendingSignOffs}
          sub="awaiting acknowledgment"
          href="/projects"
          color={pendingSignOffs > 0 ? "border-destructive/20 bg-destructive/5" : undefined}
        />
        <StatCard
          icon={<MessageSquare className={cn("w-5 h-5", unreadMessages > 0 ? "text-blue-500" : "text-muted-foreground")} />}
          label="Unread Messages"
          value={unreadMessages}
          sub="from in house team"
          href="/messages"
          color={unreadMessages > 0 ? "border-blue-200 bg-blue-50/50" : undefined}
        />
      </div>

      {/* Needs Attention */}
      {attentionItems.length > 0 && (
        <div className="mb-6 rounded-xl border border-orange-200 bg-orange-50/60 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-orange-800 mb-3">
            <Zap className="w-4 h-4" /> Needs Attention
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {attentionItems.map((item, i) => (
              <Link key={i} href={item.href}>
                <div className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer transition-all hover:shadow-sm",
                  item.severity === "critical"
                    ? "bg-destructive/10 border-destructive/30 text-destructive hover:bg-destructive/15"
                    : "bg-orange-100 border-orange-300 text-orange-800 hover:bg-orange-200"
                )}>
                  {item.icon}
                  <span className="font-medium truncate">{item.label}</span>
                  <ArrowRight className="w-3.5 h-3.5 ml-auto flex-shrink-0 opacity-60" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Main: Projects + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Active projects */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold">Active Projects</h2>
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search projects…"
                className="pl-9"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          {projectsLoading ? (
            <div className="space-y-4 animate-pulse">
              {[1,2].map(i => <div key={i} className="h-36 bg-muted rounded-xl" />)}
            </div>
          ) : filteredProjects.length === 0 ? (
            <Card className="p-10 text-center border-dashed border-2">
              <Building2 className="w-10 h-10 mx-auto text-muted-foreground mb-3 opacity-40" />
              <h3 className="font-bold mb-1">{search ? "No matches" : "No active projects"}</h3>
              <p className="text-sm text-muted-foreground mb-4">{search ? "Try a different search term." : "Create your first project to get started."}</p>
              {!search && <Link href="/projects"><Button size="sm">Create Project</Button></Link>}
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredProjects.map(project => (
                <Link key={project.id} href={`/projects/${project.id}`}>
                  <Card className="hover:shadow-md hover:border-primary/30 transition-all cursor-pointer group">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <Badge variant="success" className="text-xs">Active</Badge>
                            {project.alertCount > 0 && (
                              <Badge variant="destructive" className="text-xs animate-pulse">
                                <AlertTriangle className="w-3 h-3 mr-1" />{project.alertCount} Alert{project.alertCount > 1 ? "s" : ""}
                              </Badge>
                            )}
                          </div>
                          <p className="font-semibold group-hover:text-primary transition-colors truncate">{project.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{project.address}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-2xl font-extrabold text-primary leading-none">{project.progressPercent}%</p>
                          <p className="text-xs text-muted-foreground">progress</p>
                        </div>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2 overflow-hidden mb-3">
                        <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${project.progressPercent}%` }} />
                      </div>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{project.memberCount} team member{project.memberCount !== 1 ? "s" : ""}</span>
                        {project.targetEndDate && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            Due {new Date(project.targetEndDate + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                          </span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
              {activeProjects.length > 0 && (
                <Link href="/projects" className="flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors py-2">
                  View all projects <ArrowRight className="w-4 h-4" />
                </Link>
              )}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Recent Activity</h2>
            <Link href="/notifications" className="text-xs text-muted-foreground hover:text-primary transition-colors">View all</Link>
          </div>
          <Card>
            <CardContent className="p-0">
              {recentActivity.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  No recent activity
                </div>
              ) : (
                <div className="divide-y">
                  {recentActivity.map(n => (
                    <Link key={n.id} href="/notifications">
                      <div className={cn(
                        "flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer",
                        !n.read && "bg-primary/5"
                      )}>
                        <div className="mt-0.5 flex-shrink-0">
                          {notifIcon(n.type)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={cn("text-sm truncate", !n.read && "font-semibold")}>{n.title}</p>
                          <p className="text-xs text-muted-foreground truncate">{n.message}</p>
                        </div>
                        <span className="text-xs text-muted-foreground flex-shrink-0 mt-0.5">{timeAgo(n.createdAt)}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Performance snapshot */}
          {activeProjects.length > 0 && (
            <Card className="mt-4">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" /> Portfolio Snapshot
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Avg. progress</span>
                  <span className="font-bold">
                    {Math.round(activeProjects.reduce((a, p) => a + p.progressPercent, 0) / (activeProjects.length || 1))}%
                  </span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div
                    className="bg-primary h-2 rounded-full"
                    style={{ width: `${Math.round(activeProjects.reduce((a, p) => a + p.progressPercent, 0) / (activeProjects.length || 1))}%` }}
                  />
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total in house team</span>
                  <span className="font-bold">{activeProjects.reduce((a, p) => a + p.memberCount, 0)} members</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Projects on track</span>
                  <span className="font-bold text-emerald-600">
                    {activeProjects.filter(p => p.alertCount === 0).length}/{activeProjects.length}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Calendar */}
      <SiteCalendar events={calendarEvents} alerts={expiryAlerts} />
    </SidebarLayout>
  );
}
