import { useState, useMemo, useEffect } from "react";
import { Link } from "wouter";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, AlertTriangle, ChevronLeft, ChevronRight, ArrowRight, ShieldAlert, FileSignature, Users, Mail, Bell } from "lucide-react";
import { useListProjects, useGetComplianceOverview } from "@workspace/api-client-react";
import type { ExpiringInsuranceItem, ExpiringPermitItem } from "@workspace/api-client-react";

type CalEvent = { date: string; label: string; type: "project-start" | "project-end" | "permit" | "insurance" | "invoice-out" | "invoice-in" };
type ExpiryAlert = { label: string; expiryDate: string; kind: "permit" | "insurance"; daysLeft: number };

const EVENT_STYLES: Record<CalEvent["type"], { dot: string; badge: string; label: string }> = {
  "project-start": { dot: "bg-primary",     badge: "bg-primary/10 text-primary border-primary/20",              label: "Project Start"    },
  "project-end":   { dot: "bg-destructive",  badge: "bg-destructive/10 text-destructive border-destructive/20",   label: "Project End"      },
  "permit":        { dot: "bg-yellow-500",   badge: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20",      label: "Permit Expiry"    },
  "insurance":     { dot: "bg-blue-500",     badge: "bg-blue-500/10 text-blue-700 border-blue-500/20",            label: "Insurance Expiry" },
  "invoice-out":   { dot: "bg-rose-500",     badge: "bg-rose-500/10 text-rose-700 border-rose-500/20",            label: "Payment Due"      },
  "invoice-in":    { dot: "bg-emerald-500",  badge: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",   label: "Invoice Due In"   },
};

function SiteCalendar({ events, alerts }: { events: CalEvent[]; alerts: ExpiryAlert[] }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const byDate = useMemo(() => {
    const map: Record<string, CalEvent[]> = {};
    for (const e of events) {
      (map[e.date] ??= []).push(e);
    }
    return map;
  }, [events]);

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const blanks = (firstDay + 6) % 7; // Mon-start offset

  const cells: (number | null)[] = [
    ...Array(blanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1);
  }

  const monthLabel = new Date(year, month).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  const upcoming = events
    .filter(e => e.date >= todayKey)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 8);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Calendar</CardTitle>
          <div className="flex items-center gap-2">
            <button onClick={prevMonth} className="p-1 rounded hover:bg-muted transition-colors"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-sm font-semibold w-36 text-center">{monthLabel}</span>
            <button onClick={nextMonth} className="p-1 rounded hover:bg-muted transition-colors"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {/* Expiry alerts */}
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
        {/* Day headers */}
        <div className="grid grid-cols-7 mb-1">
          {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => (
            <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
          ))}
        </div>
        {/* Day cells */}
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

        {/* Legend */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 pt-3 border-t">
          {(Object.entries(EVENT_STYLES) as [CalEvent["type"], typeof EVENT_STYLES[CalEvent["type"]]][]).map(([, s]) => (
            <span key={s.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={`w-2 h-2 rounded-full ${s.dot}`} />{s.label}
            </span>
          ))}
        </div>

        {/* Upcoming events */}
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

export default function Dashboard() {
  const { data: projects, isLoading: projectsLoading } = useListProjects();
  const { data: compliance, isLoading: compLoading } = useGetComplianceOverview();
  const [invoices, setInvoices] = useState<Array<{ id: string; direction: string; counterpartyName: string; description: string; amount: string; currency: string; dueDate: string; status: string; reference?: string }>>([]);
  useEffect(() => {
    const token = localStorage.getItem("sitesort_token");
    fetch("/api/invoices", { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.ok ? r.json() : [])
      .then(setInvoices)
      .catch(() => {});
  }, []);

  const [emailStatus, setEmailStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function sendTestEmail() {
    setEmailStatus("sending");
    try {
      const res = await fetch("/api/test-email", { method: "POST" });
      const data = await res.json();
      setEmailStatus(data.success ? "sent" : "error");
    } catch {
      setEmailStatus("error");
    }
  }

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

  return (
    <SidebarLayout>
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of your sites and compliance.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={sendTestEmail}
            disabled={emailStatus === "sending"}
            className="text-xs"
          >
            <Mail className="w-3.5 h-3.5 mr-1.5" />
            {emailStatus === "idle" && "Send Test Email"}
            {emailStatus === "sending" && "Sending…"}
            {emailStatus === "sent" && "✓ Email sent!"}
            {emailStatus === "error" && "✗ Failed — check console"}
          </Button>
          <Link href="/projects">
            <Button variant="accent">New Project</Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card className="bg-primary text-primary-foreground border-primary shadow-xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-primary-foreground text-lg flex items-center gap-2">
              <Building2 className="w-5 h-5 opacity-80" /> Active Projects
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-extrabold">{projects?.filter(p => p.status === 'active').length || 0}</div>
          </CardContent>
        </Card>
        
        <Card className="border-warning/50 bg-warning/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-warning-foreground text-lg flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-warning" /> Expiring Insurance/Permits
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-extrabold text-warning-foreground">
              {(compliance?.expiringInsurance?.length || 0) + (compliance?.expiringPermits?.length || 0)}
            </div>
            <Link href="/compliance" className="text-sm font-semibold text-warning mt-2 inline-flex items-center hover:underline">
              View Compliance Center <ArrowRight className="w-4 h-4 ml-1" />
            </Link>
          </CardContent>
        </Card>

        <Card className="border-destructive/50 bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-destructive text-lg flex items-center gap-2">
              <FileSignature className="w-5 h-5" /> Pending Acknowledgments
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-extrabold text-destructive">
              {compliance?.pendingAcknowledgments?.reduce((acc, curr) => acc + curr.pendingCount, 0) || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      <h2 className="text-2xl font-bold mb-4">Active Projects</h2>
      {projectsLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
          {[1,2,3].map(i => <div key={i} className="h-48 bg-muted rounded-xl"></div>)}
        </div>
      ) : projects?.length === 0 ? (
        <Card className="p-12 text-center border-dashed border-2">
          <Building2 className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-bold">No projects yet</h3>
          <p className="text-muted-foreground mb-6">Create your first project to get started.</p>
          <Link href="/projects"><Button>Create Project</Button></Link>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects?.filter(p => p.status === 'active').map(project => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <Card className="hover:shadow-lg hover:border-primary/30 transition-all cursor-pointer group h-full flex flex-col">
                <CardHeader>
                  <div className="flex justify-between items-start mb-2">
                    <Badge variant="success">Active</Badge>
                    {project.alertCount > 0 && (
                      <Badge variant="destructive" className="animate-pulse">
                        <AlertTriangle className="w-3 h-3 mr-1" /> {project.alertCount} Action Req.
                      </Badge>
                    )}
                  </div>
                  <CardTitle className="group-hover:text-accent transition-colors">{project.name}</CardTitle>
                  <p className="text-sm text-muted-foreground line-clamp-1">{project.address}</p>
                </CardHeader>
                <CardContent className="mt-auto">
                  <div className="mb-2 flex justify-between text-sm">
                    <span className="text-muted-foreground">Progress</span>
                    <span className="font-bold">{project.progressPercent}%</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
                    <div 
                      className="bg-primary h-2.5 rounded-full" 
                      style={{ width: `${project.progressPercent}%` }}
                    ></div>
                  </div>
                  <div className="mt-4 pt-4 border-t flex justify-between text-sm text-muted-foreground">
                    <span className="flex items-center gap-1"><Users className="w-4 h-4"/> {project.memberCount} Team</span>
                    <span>Started {new Date(project.startDate).toLocaleDateString(undefined, { month: 'short', year: 'numeric'})}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <div className="mt-8">
        <SiteCalendar events={calendarEvents} alerts={expiryAlerts} />
      </div>
    </SidebarLayout>
  );
}
