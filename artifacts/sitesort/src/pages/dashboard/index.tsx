import { useState, useMemo, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { LinkRow } from "@/components/ui/link-row";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Building2, AlertTriangle, ChevronLeft, ChevronRight, ArrowRight,
  ShieldAlert, FileSignature, Users, Bell, Search,
  MessageSquare, Camera, FilePlus, Plus, AlertCircle, CreditCard,
  FileText, CheckCircle2, Clock, TrendingUp, Zap, X, Circle, ClipboardCheck,
  Lock, Sparkles, Trash2, Receipt, ArrowDownCircle, ArrowUpCircle, Eye, Share2,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { ShareModal } from "@/components/share-modal";
import { AlertViewer } from "@/components/alert-viewer";
import { useToast } from "@/hooks/use-toast";
import { useListProjects, useGetComplianceOverview } from "@workspace/api-client-react";
import type { ExpiringInsuranceItem, ExpiringPermitItem } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useSubscription } from "@/contexts/subscription";

type CalEvent = { date: string; label: string; type: "project-start" | "project-end" | "permit" | "insurance" | "invoice-out" | "invoice-in" | "custom"; href?: string; id?: string; note?: string | null; projectId?: string | null };
type CustomEvent = { id: string; title: string; eventDate: string; note: string | null; projectId: string | null };
type ExpiryAlert = { label: string; expiryDate: string; kind: "permit" | "insurance"; daysLeft: number };
type Notification = { id: string; type: string; title: string; message: string; read: boolean; createdAt: string; relatedEntityId?: string; relatedEntityType?: string };
type Invoice = { id: string; direction: string; counterpartyName: string; description: string; amount: string; currency: string; dueDate: string; status: string; reference?: string; attachmentUrl?: string | null; projectId?: string | null };

const EVENT_STYLES: Record<CalEvent["type"], { dot: string; badge: string; label: string }> = {
  "project-start": { dot: "bg-primary",     badge: "bg-primary/10 text-primary border-primary/20",              label: "Project Start"    },
  "project-end":   { dot: "bg-destructive",  badge: "bg-destructive/10 text-destructive border-destructive/20",   label: "Project End"      },
  "permit":        { dot: "bg-yellow-500",   badge: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20",      label: "Permit Expiry"    },
  "insurance":     { dot: "bg-blue-500",     badge: "bg-blue-500/10 text-blue-700 border-blue-500/20",            label: "Insurance Expiry" },
  "invoice-out":   { dot: "bg-rose-500",     badge: "bg-rose-500/10 text-rose-700 border-rose-500/20",            label: "Payment Due"      },
  "invoice-in":    { dot: "bg-emerald-500",  badge: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",   label: "Invoice Due In"   },
  "custom":        { dot: "bg-violet-500",   badge: "bg-violet-500/10 text-violet-700 border-violet-500/20",      label: "Custom Event"     },
};

// Fallback section + action label per event type for the "View" link in the day dialog.
// Individual events carry a deep `href` (to the specific project / invoice) where an id is
// available; these are the generic fallbacks used when an event has no deep link.
const EVENT_LINK: Record<CalEvent["type"], { href: string; label: string }> = {
  "project-start": { href: "/projects",   label: "Open project"       },
  "project-end":   { href: "/projects",   label: "Open project"       },
  "permit":        { href: "/compliance", label: "View permit"        },
  "insurance":     { href: "/compliance", label: "View in Compliance" },
  "invoice-out":   { href: "/invoices",   label: "Open invoice"       },
  "invoice-in":    { href: "/invoices",   label: "Open invoice"       },
  "custom":        { href: "#",           label: ""                   }, // custom events have no deep link; managers get a delete action instead
};

function notifIcon(type: string) {
  switch (type) {
    case "new_message":    return <MessageSquare className="w-4 h-4 text-blue-500" />;
    case "document_uploaded": return <FileText className="w-4 h-4 text-indigo-500" />;
    case "safety_concern": return <AlertTriangle className="w-4 h-4 text-amber-500" />;
    case "daily_report":   return <ClipboardCheck className="w-4 h-4 text-teal-500" />;
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

function fmtAmount(currency: string, amount: string) {
  return `${currency} ${Number(amount).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string) {
  return new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function daysUntilDue(dateStr: string) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr.slice(0, 10) + "T00:00:00");
  return Math.ceil((due.getTime() - today.getTime()) / 86400000);
}

function InvoiceStatusBadge({ invoice }: { invoice: Invoice }) {
  if (invoice.status === "paid") return <Badge variant="success" className="gap-1"><CheckCircle2 className="w-3 h-3" />Paid</Badge>;
  const days = daysUntilDue(invoice.dueDate);
  if (days < 0) return <Badge variant="destructive" className="gap-1"><AlertTriangle className="w-3 h-3" />Overdue</Badge>;
  if (days <= 7) return <Badge className="gap-1 bg-orange-100 text-orange-700 border-orange-200"><Clock className="w-3 h-3" />Due in {days}d</Badge>;
  return <Badge variant="secondary" className="gap-1"><Clock className="w-3 h-3" />Due in {days}d</Badge>;
}

function SiteCalendar({ events, alerts, canManage, projects, onCreate, onDelete }: {
  events: CalEvent[];
  alerts: ExpiryAlert[];
  canManage: boolean;
  projects: { id: string; name: string }[];
  onCreate: (data: { title: string; eventDate: string; note: string; projectId: string | null }) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
}) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Add-event dialog state
  const todayKey0 = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const [addOpen, setAddOpen] = useState(false);
  const [addDate, setAddDate] = useState(todayKey0);
  const [addTitle, setAddTitle] = useState("");
  const [addNote, setAddNote] = useState("");
  const [addProjectId, setAddProjectId] = useState(""); // "" = whole company
  const [saving, setSaving] = useState(false);

  function openAdd(date: string) {
    setAddDate(date);
    setAddTitle("");
    setAddNote("");
    setAddProjectId("");
    setAddOpen(true);
  }
  async function submitAdd() {
    if (!addTitle.trim() || !addDate || saving) return;
    setSaving(true);
    const ok = await onCreate({ title: addTitle.trim(), eventDate: addDate, note: addNote.trim(), projectId: addProjectId || null });
    setSaving(false);
    if (ok) setAddOpen(false);
  }

  const byDate = useMemo(() => {
    const map: Record<string, CalEvent[]> = {};
    for (const e of events) (map[e.date] ??= []).push(e);
    return map;
  }, [events]);

  const selectedEvents = selectedDate ? (byDate[selectedDate] ?? []) : [];
  const selectedLabel = selectedDate
    ? new Date(selectedDate + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : "";

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
    <>
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Site Calendar</CardTitle>
          <div className="flex items-center gap-2">
            {canManage && (
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" onClick={() => openAdd(todayKey0)}>
                <Plus className="w-3.5 h-3.5" /> Add Event
              </Button>
            )}
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
                <Link key={i} href={`/compliance?filter=expiring&kind=${a.kind}`} className={`group flex items-center gap-2 px-3 py-2 rounded-lg border text-xs min-h-[44px] transition-colors hover:brightness-95 ${styles}`}>
                  <Bell className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="flex-1 font-medium truncate">{a.label}</span>
                  <span className="flex-shrink-0 font-semibold">{tag}</span>
                  <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                </Link>
              );
            })}
            <Link href="/compliance?filter=expiring" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1">
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
            const hasEvents = dayEvents.length > 0;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedDate(key)}
                aria-label={`${day}${hasEvents ? ` — ${dayEvents.length} event${dayEvents.length > 1 ? "s" : ""}` : ""}`}
                className={cn(
                  "flex flex-col items-center py-1 gap-0.5 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  hasEvents ? "cursor-pointer hover:bg-muted" : "hover:bg-muted/50",
                )}
              >
                <span className="relative">
                  <span className={`text-xs w-7 h-7 flex items-center justify-center rounded-full font-medium transition-colors
                    ${isToday ? "bg-primary text-primary-foreground font-bold" : "text-foreground"}`}>
                    {day}
                  </span>
                  {hasEvents && (
                    <span
                      aria-hidden="true"
                      title={`${dayEvents.length} event${dayEvents.length > 1 ? "s" : ""}`}
                      className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-destructive border border-card"
                    />
                  )}
                </span>
                <div className="flex gap-0.5 flex-wrap justify-center items-center min-h-[6px]">
                  {dayEvents.slice(0, 3).map((e, j) => (
                    <span key={j} title={e.label} className={`w-1.5 h-1.5 rounded-full ${EVENT_STYLES[e.type].dot}`} />
                  ))}
                  {dayEvents.length > 3 && (
                    <span className="text-[8px] leading-none font-semibold text-muted-foreground">+{dayEvents.length - 3}</span>
                  )}
                </div>
              </button>
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
            {upcoming.map((e, i) => {
              const to = e.href ?? EVENT_LINK[e.type].href;
              const linkable = !!to && to !== "#";
              const dateStr = new Date(e.date + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
              const rowCls = `flex items-center justify-between gap-3 px-3 py-2 rounded-lg border text-xs min-h-[44px] ${EVENT_STYLES[e.type].badge}`;
              return linkable ? (
                <Link key={i} href={to} className={`group ${rowCls} transition-colors hover:brightness-95`}>
                  <span className="font-medium truncate">{e.label}</span>
                  <span className="flex-shrink-0 flex items-center gap-1.5 font-mono">{dateStr}<ChevronRight className="w-3.5 h-3.5 opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" /></span>
                </Link>
              ) : (
                <div key={i} className={rowCls}>
                  <span className="font-medium truncate">{e.label}</span>
                  <span className="flex-shrink-0 font-mono">{dateStr}</span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>

    <Dialog open={!!selectedDate} onOpenChange={(o) => { if (!o) setSelectedDate(null); }}>
      <DialogHeader>
        <DialogTitle className="text-lg sm:text-xl">{selectedLabel}</DialogTitle>
      </DialogHeader>
      {selectedEvents.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            {selectedEvents.length} {selectedEvents.length === 1 ? "event" : "events"} on this day
          </p>
          {selectedEvents.map((e, i) => (
            <div key={i} className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border ${EVENT_STYLES[e.type].badge}`}>
              <span className={`mt-1.5 w-2.5 h-2.5 rounded-full flex-shrink-0 ${EVENT_STYLES[e.type].dot}`} />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide opacity-70">{EVENT_STYLES[e.type].label}</p>
                <p className="text-sm font-medium break-words">{e.label}</p>
                {e.type === "custom" && (
                  <span className="inline-block mt-0.5 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-700">
                    {e.projectId ? (projects.find(p => p.id === e.projectId)?.name ?? "Project") : "Company-wide"}
                  </span>
                )}
                {e.type === "custom" && e.note && (
                  <p className="text-xs text-muted-foreground break-words mt-0.5 whitespace-pre-wrap">{e.note}</p>
                )}
                {e.type === "custom" ? (
                  canManage && e.id && (
                    <button
                      onClick={() => onDelete(e.id!)}
                      className="inline-flex items-center gap-1 mt-1 text-xs font-medium text-destructive underline-offset-2 hover:underline"
                    >
                      <Trash2 className="w-3 h-3" /> Delete event
                    </button>
                  )
                ) : (
                  <Link
                    href={e.href ?? EVENT_LINK[e.type].href}
                    onClick={() => setSelectedDate(null)}
                    className="inline-flex items-center gap-1 mt-1 text-xs font-medium underline-offset-2 hover:underline"
                  >
                    {EVENT_LINK[e.type].label} <ArrowRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-6 text-center">
          <p className="text-sm text-muted-foreground">No events scheduled for this day.</p>
        </div>
      )}
      {canManage && selectedDate && (
        <DialogFooter>
          <Button variant="outline" className="gap-1.5" onClick={() => { const d = selectedDate; setSelectedDate(null); openAdd(d); }}>
            <Plus className="w-4 h-4" /> Add event on this day
          </Button>
        </DialogFooter>
      )}
    </Dialog>

    <Dialog open={addOpen} onOpenChange={(o) => { if (!o) setAddOpen(false); }}>
      <DialogHeader>
        <DialogTitle className="text-lg sm:text-xl">Add calendar event</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Title</label>
          <Input
            autoFocus
            value={addTitle}
            onChange={(ev) => setAddTitle(ev.target.value)}
            placeholder="e.g. Site meeting, Concrete delivery, Inspection"
            maxLength={120}
            onKeyDown={(ev) => { if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) submitAdd(); }}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Date</label>
          <Input type="date" value={addDate} onChange={(ev) => setAddDate(ev.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Show on site board for</label>
          <select
            value={addProjectId}
            onChange={(ev) => setAddProjectId(ev.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <option value="">Whole company (every site board)</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Note <span className="text-muted-foreground font-normal">(optional)</span></label>
          <Textarea
            value={addNote}
            onChange={(ev) => setAddNote(ev.target.value)}
            placeholder="Add any extra detail the team should see…"
            rows={3}
            maxLength={500}
          />
        </div>
        <p className="text-xs text-muted-foreground">Appears on everyone's dashboard calendar. Upcoming events also show on the QR site board{addProjectId ? " for the selected project" : " of every project"}.</p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>Cancel</Button>
        <Button onClick={submitAdd} disabled={saving || !addTitle.trim() || !addDate}>
          {saving ? "Adding…" : "Add event"}
        </Button>
      </DialogFooter>
    </Dialog>
    </>
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

const DASH_PLAN_LIMITS: Record<string, number> = { free: 1, solo: 1, team: 5, pro: Infinity };
const DASH_NEXT_PLAN: Record<string, { name: string; projects: string; price: string }> = {
  free:  { name: "Team", projects: "5 projects",        price: "£79/mo" },
  solo:  { name: "Team", projects: "5 projects",        price: "£79/mo" },
  team:  { name: "Pro",  projects: "Unlimited projects", price: "£149/mo" },
};

export default function Dashboard() {
  const [, navigate] = useLocation();
  const { data: projects, isLoading: projectsLoading } = useListProjects();
  const { data: compliance } = useGetComplianceOverview();
  const caps = useCapabilities();
  const { isCancelled, tier, betaAccess } = useSubscription();
  const { toast } = useToast();

  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);
  const planLimit = DASH_PLAN_LIMITS[tier] ?? 1;
  const nextPlan = DASH_NEXT_PLAN[tier];
  const atLimit = !isCancelled && !betaAccess && planLimit !== Infinity && (projects?.length ?? 0) >= planLimit;

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [shareInvoice, setShareInvoice] = useState<Invoice | null>(null);
  const [moveToInvoice, setMoveToInvoice] = useState<Invoice | null>(null);
  const [movingProject, setMovingProject] = useState(false);
  const [customEvents, setCustomEvents] = useState<CustomEvent[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [userName, setUserName] = useState<string>("");

  type OnboardingStatus = { hasProject: boolean; hasTeamMember: boolean; hasDocument: boolean; hasSubcontractor: boolean; hasMilestone: boolean };
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [onboardingDismissed, setOnboardingDismissed] = useState(() => localStorage.getItem("sitesort_onboarding_dismissed") === "1");

  useEffect(() => {
    const h = authHeaders();
    fetch("/api/invoices", { headers: h }).then(r => r.ok ? r.json() : []).then(setInvoices).catch(() => {});
    fetch("/api/calendar-events", { headers: h }).then(r => r.ok ? r.json() : []).then(setCustomEvents).catch(() => {});
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
      if (p.startDate) events.push({ date: p.startDate.slice(0, 10), label: `${p.name} starts`, type: "project-start", href: `/projects/${p.id}` });
      if (p.targetEndDate) events.push({ date: p.targetEndDate.slice(0, 10), label: `${p.name} ends`, type: "project-end", href: `/projects/${p.id}` });
    }
    for (const ins of (compliance?.expiringInsurance ?? []) as ExpiringInsuranceItem[]) {
      const date = ins.expiryDate.slice(0, 10);
      events.push({ date, label: `${ins.subcontractorName} — ${ins.insuranceType}`, type: "insurance" });
      const daysLeft = Math.ceil((new Date(date).getTime() - todayMs) / 86400000);
      alerts.push({ label: `${ins.subcontractorName} — ${ins.insuranceType}`, expiryDate: date, kind: "insurance", daysLeft });
    }
    for (const permit of (compliance?.expiringPermits ?? []) as ExpiringPermitItem[]) {
      const date = permit.expiryDate.slice(0, 10);
      events.push({ date, label: `${permit.projectName} — ${permit.permitType}`, type: "permit", href: `/projects/${permit.projectId}?tab=permits` });
      const daysLeft = Math.ceil((new Date(date).getTime() - todayMs) / 86400000);
      alerts.push({ label: `${permit.projectName} — ${permit.permitType}`, expiryDate: date, kind: "permit", daysLeft });
    }
    for (const inv of invoices) {
      if (inv.status === "paid") continue;
      const date = inv.dueDate.slice(0, 10);
      const type: CalEvent["type"] = inv.direction === "outbound" ? "invoice-out" : "invoice-in";
      const prefix = inv.direction === "outbound" ? "Pay" : "Receive";
      const amount = `${inv.currency} ${Number(inv.amount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
      events.push({ date, label: `${prefix}: ${inv.counterpartyName} — ${amount}`, type, href: `/invoices?invoice=${inv.id}` });
    }
    for (const ce of customEvents) {
      events.push({ date: ce.eventDate.slice(0, 10), label: ce.title, type: "custom", id: ce.id, note: ce.note, projectId: ce.projectId });
    }
    alerts.sort((a, b) => a.daysLeft - b.daysLeft);
    return { calendarEvents: events, expiryAlerts: alerts };
  }, [projects, compliance, invoices, customEvents]);

  const todayStr = new Date().toISOString().slice(0, 10);

  async function createCalendarEvent(data: { title: string; eventDate: string; note: string; projectId: string | null }): Promise<boolean> {
    if (isCancelled) {
      toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" });
      return false;
    }
    try {
      const res = await fetch("/api/calendar-events", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        toast({ title: "Couldn't add event", description: "Please try again.", variant: "destructive" });
        return false;
      }
      const created: CustomEvent = await res.json();
      setCustomEvents(prev => [...prev, created]);
      toast({ title: "Event added", description: `"${data.title}" is now on the team calendar.` });
      return true;
    } catch {
      toast({ title: "Couldn't add event", description: "Please try again.", variant: "destructive" });
      return false;
    }
  }

  async function deleteCalendarEvent(id: string): Promise<void> {
    if (isCancelled) {
      toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" });
      return;
    }
    const prev = customEvents;
    setCustomEvents(cur => cur.filter(e => e.id !== id)); // optimistic
    try {
      const res = await fetch(`/api/calendar-events/${id}`, { method: "DELETE", headers: authHeaders() });
      if (!res.ok && res.status !== 204) {
        setCustomEvents(prev);
        toast({ title: "Couldn't delete event", description: "Please try again.", variant: "destructive" });
      }
    } catch {
      setCustomEvents(prev);
      toast({ title: "Couldn't delete event", description: "Please try again.", variant: "destructive" });
    }
  }

  async function markInvoicePaid(inv: Invoice) {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    const res = await fetch(`/api/invoices/${inv.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ status: "paid" }),
    }).catch(() => null);
    if (!res?.ok) { toast({ title: "Couldn't mark as paid", description: "Please try again.", variant: "destructive" }); return; }
    setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, status: "paid" } : i));
    // Unassigned invoices prompt a move-to-project picker; already-linked ones just confirm.
    if (!inv.projectId) setMoveToInvoice({ ...inv, status: "paid" });
    else toast({ title: "Marked as paid", description: `${inv.counterpartyName} invoice updated.` });
  }

  async function moveInvoiceToProject(invoiceId: string, projectId: string) {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    setMovingProject(true);
    const res = await fetch(`/api/invoices/${invoiceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ projectId }),
    }).catch(() => null);
    setMovingProject(false);
    if (res?.ok) {
      setInvoices(prev => prev.map(i => i.id === invoiceId ? { ...i, projectId } : i));
      const projectName = projects?.find(p => p.id === projectId)?.name ?? "project";
      toast({ title: "Invoice moved", description: `Invoice moved to ${projectName}.` });
      setMoveToInvoice(null);
    } else {
      toast({ title: "Couldn't move invoice", description: "Please try again.", variant: "destructive" });
    }
  }

  // Outstanding invoices: unpaid/overdue, overdue first, then soonest due. Capped for the dashboard.
  const outstandingInvoices = useMemo(() => {
    return invoices
      .filter(inv => inv.status !== "paid")
      .sort((a, b) => daysUntilDue(a.dueDate) - daysUntilDue(b.dueDate))
      .slice(0, 5);
  }, [invoices]);
  const outstandingCount = invoices.filter(inv => inv.status !== "paid").length;

  const attentionItems = useMemo(() => {
    const items: { icon: React.ReactNode; label: string; href: string; severity: "critical" | "warning" }[] = [];

    // Expired compliance
    for (const a of expiryAlerts) {
      if (a.daysLeft < 0) items.push({ icon: <ShieldAlert className="w-4 h-4" />, label: `${a.label} — expired`, href: "/compliance?filter=expiring", severity: "critical" });
      else if (a.daysLeft <= 3) items.push({ icon: <ShieldAlert className="w-4 h-4" />, label: `${a.label} — expires in ${a.daysLeft}d`, href: "/compliance?filter=expiring", severity: "critical" });
    }

    // Overdue invoices
    const overdue = invoices.filter(inv => inv.status !== "paid" && inv.dueDate.slice(0, 10) < todayStr);
    if (overdue.length > 0)
      items.push({ icon: <FileText className="w-4 h-4" />, label: `${overdue.length} overdue invoice${overdue.length > 1 ? "s" : ""}`, href: "/invoices?status=overdue", severity: "critical" });

    // Pending sign-offs
    const pending = compliance?.pendingAcknowledgments?.reduce((a, c) => a + c.pendingCount, 0) ?? 0;
    if (pending > 0)
      items.push({ icon: <FileSignature className="w-4 h-4" />, label: `${pending} pending document sign-off${pending > 1 ? "s" : ""}`, href: "/compliance?filter=signoffs", severity: "warning" });

    // Unread messages
    if (unreadMessages > 0)
      items.push({ icon: <MessageSquare className="w-4 h-4" />, label: `${unreadMessages} unread message${unreadMessages > 1 ? "s" : ""}`, href: "/messages?filter=unread", severity: "warning" });

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
  const [activityViewer, setActivityViewer] = useState<{ items: Notification[]; index: number } | null>(null);

  const markActivityRead = (id: string) => {
    setNotifications(prev => prev.map(x => x.id === id ? { ...x, read: true } : x));
    fetch(`/api/notifications/${id}/read`, { method: "PATCH", headers: authHeaders() }).catch(() => {});
  };

  const handleActivityClick = async (n: Notification) => {
    markActivityRead(n.id);

    const h = authHeaders();

    if (n.type === "daily_report" && n.relatedEntityId) {
      const res = await fetch(`/api/daily-reports/${n.relatedEntityId}`, { headers: h }).catch(() => null);
      if (res?.ok) {
        const r = await res.json();
        navigate(`/projects/${r.projectId}?tab=reports&report=${n.relatedEntityId}`);
        return;
      }
    }

    if (n.type === "safety_concern" && n.relatedEntityId) {
      const res = await fetch(`/api/photos/${n.relatedEntityId}`, { headers: h }).catch(() => null);
      if (res?.ok) {
        const photo = await res.json();
        navigate(`/projects/${photo.projectId}?tab=photos&photo=${n.relatedEntityId}`);
        return;
      }
    }

    if (n.type === "document_uploaded" && n.relatedEntityId) {
      const res = await fetch(`/api/documents/${n.relatedEntityId}`, { headers: h }).catch(() => null);
      if (res?.ok) {
        const doc = await res.json();
        navigate(`/projects/${doc.projectId}?tab=documents`);
        return;
      }
    }

    if (n.type === "new_message") { navigate("/messages"); return; }
    if (n.type === "trial_ending" || n.type === "payment_failed") { navigate("/settings?tab=billing"); return; }

    navigate("/notifications");
  };

  return (
    <SidebarLayout>
      <PageHeader
        className="mb-6"
        title={<>{greeting}{userName ? `, ${userName}` : ""}!</>}
        description={dateLabel}
        actions={<>
          {caps.canManageProjects && (
            <Button variant="accent" size="sm" onClick={() => {
              if (isCancelled) { navigate("/settings?tab=billing"); return; }
              if (atLimit && !projectsLoading) { setShowUpgradeDialog(true); return; }
              navigate("/projects?new=1");
            }}>
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
        </>}
      />

      {/* Onboarding checklist — setup actions are manager-only */}
      {onboarding && !onboardingDismissed && caps.canManageProjects && (() => {
        const steps = [
          { key: "hasProject",       done: onboarding.hasProject,       title: "Create your first project",         desc: "Set up a project with a name, address, and start date.",  href: "/projects?new=1",       cta: "Create project" },
          { key: "hasTeamMember",    done: onboarding.hasTeamMember,    title: "Invite an in house team member",    desc: "Add a colleague to one of your projects.",                 href: "/subcontractors?new=1", cta: "Add to directory" },
          { key: "hasDocument",      done: onboarding.hasDocument,      title: "Upload your first document",        desc: "Share a drawing, method statement, or compliance doc.",    href: "/compliance?upload=1",  cta: "Upload document" },
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          icon={<Building2 className="w-5 h-5 text-primary" />}
          label="Active Projects"
          value={activeProjects.length}
          sub={`${(projects?.filter(p => p.status === "complete") ?? []).length} completed`}
          href="/projects?status=active"
        />
        <StatCard
          icon={<ShieldAlert className={cn("w-5 h-5", expiringCount > 0 ? "text-orange-500" : "text-muted-foreground")} />}
          label="Expiring Soon"
          value={expiringCount}
          sub="insurance + permits (30d)"
          href="/compliance?filter=expiring"
          color={expiringCount > 0 ? "border-orange-200 bg-orange-50/50" : undefined}
        />
        <StatCard
          icon={<FileSignature className={cn("w-5 h-5", pendingSignOffs > 0 ? "text-destructive" : "text-muted-foreground")} />}
          label="Pending Sign-offs"
          value={pendingSignOffs}
          sub="awaiting acknowledgment"
          href="/compliance?filter=signoffs"
          color={pendingSignOffs > 0 ? "border-destructive/20 bg-destructive/5" : undefined}
        />
        <StatCard
          icon={<MessageSquare className={cn("w-5 h-5", unreadMessages > 0 ? "text-blue-500" : "text-muted-foreground")} />}
          label="Unread Messages"
          value={unreadMessages}
          sub="from in house team"
          href="/messages?filter=unread"
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

      {/* Outstanding invoices */}
      {outstandingInvoices.length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Receipt className="w-4 h-4 text-primary" /> Outstanding Invoices
                <span className="text-xs font-normal text-muted-foreground">({outstandingCount})</span>
              </CardTitle>
              <Link href="/invoices" className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
                View all <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-0 divide-y">
            {outstandingInvoices.map(inv => (
              <div key={inv.id} className="py-3 first:pt-0 last:pb-0">
                {/* Row 1: avatar + name + amount */}
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0",
                      inv.direction === "inbound" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                    )}>
                      {inv.counterpartyName.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{inv.counterpartyName}</p>
                      <p className="text-xs text-muted-foreground truncate">{inv.reference ? `${inv.reference} · ` : ""}{inv.description}</p>
                    </div>
                  </div>
                  <span className="font-bold tabular-nums text-sm shrink-0">{fmtAmount(inv.currency, inv.amount)}</span>
                </div>
                {/* Row 2: direction + status + due */}
                <div className="flex items-center gap-2 flex-wrap mb-2.5">
                  {inv.direction === "inbound"
                    ? <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium"><ArrowDownCircle className="w-3.5 h-3.5" />In</span>
                    : <span className="flex items-center gap-1 text-xs text-rose-600 font-medium"><ArrowUpCircle className="w-3.5 h-3.5" />Out</span>
                  }
                  <InvoiceStatusBadge invoice={inv} />
                  <span className="text-xs text-muted-foreground">Due {fmtDate(inv.dueDate)}</span>
                </div>
                {/* Row 3: pill action buttons */}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => navigate(`/invoices?invoice=${inv.id}`)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-background text-sm font-medium text-foreground hover:bg-muted transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5" />Open
                  </button>
                  {inv.attachmentUrl && (
                    <button
                      type="button"
                      onClick={() => setShareInvoice(inv)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-background text-sm font-medium text-foreground hover:bg-muted transition-colors"
                    >
                      <Share2 className="w-3.5 h-3.5" />Share
                    </button>
                  )}
                  {caps.canManageInvoices && (
                    <button
                      type="button"
                      onClick={() => markInvoicePaid(inv)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-amber-200 bg-amber-50 text-sm font-medium text-amber-700 hover:bg-amber-100 transition-colors"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />Mark Paid
                    </button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
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
              {!search && <Link href="/projects?new=1"><Button size="sm">Create Project</Button></Link>}
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
                    <button
                      key={n.id}
                      onClick={() => setActivityViewer({ items: recentActivity, index: recentActivity.indexOf(n) })}
                      className="w-full text-left"
                    >
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
                    </button>
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
              <CardContent className="px-4 pb-4 space-y-1">
                <LinkRow
                  plain
                  href="/projects?status=active"
                  label={<span className="text-muted-foreground">Avg. progress</span>}
                  detail={<span className="font-bold text-foreground">{Math.round(activeProjects.reduce((a, p) => a + p.progressPercent, 0) / (activeProjects.length || 1))}%</span>}
                />
                <div className="w-full bg-muted rounded-full h-2">
                  <div
                    className="bg-primary h-2 rounded-full"
                    style={{ width: `${Math.round(activeProjects.reduce((a, p) => a + p.progressPercent, 0) / (activeProjects.length || 1))}%` }}
                  />
                </div>
                <LinkRow
                  plain
                  href="/team"
                  label={<span className="text-muted-foreground">Total in house team</span>}
                  detail={<span className="font-bold text-foreground">{activeProjects.reduce((a, p) => a + p.memberCount, 0)} members</span>}
                />
                {(() => {
                  const onTrack = activeProjects.filter(p => p.alertCount === 0).length;
                  const total = activeProjects.length;
                  const allClear = onTrack === total;
                  return (
                    <LinkRow
                      plain
                      href={allClear ? "/projects?status=active" : "/projects?filter=alerts"}
                      quiet={allClear}
                      label={<span className="text-muted-foreground">Projects on track</span>}
                      detail={<span className={cn("font-bold", allClear ? "text-emerald-600" : "text-amber-600")}>{onTrack}/{total}</span>}
                    />
                  );
                })()}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Calendar */}
      <SiteCalendar
        events={calendarEvents}
        alerts={expiryAlerts}
        canManage={caps.canManageProjects}
        projects={(projects ?? []).map(p => ({ id: p.id, name: p.name }))}
        onCreate={createCalendarEvent}
        onDelete={deleteCalendarEvent}
      />

      <Dialog open={showUpgradeDialog} onOpenChange={setShowUpgradeDialog}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-destructive" /> Project limit reached
          </DialogTitle>
        </DialogHeader>
        <div className="my-3 space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="capitalize inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">{tier || "Free"} plan</span>
            <span className="text-muted-foreground">
              {projects?.length ?? 0} of {planLimit} project{planLimit !== 1 ? "s" : ""} used
            </span>
          </div>
          {nextPlan && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
              <p className="font-semibold text-primary">{nextPlan.name} plan — {nextPlan.projects}</p>
              <p className="text-muted-foreground mt-0.5">{nextPlan.price} · More projects, team collaboration, advanced compliance &amp; more.</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setShowUpgradeDialog(false)}>Maybe later</Button>
          <Button variant="accent" onClick={() => { setShowUpgradeDialog(false); navigate("/settings?tab=billing"); }} className="gap-2">
            <Sparkles className="w-4 h-4" /> Upgrade plan
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Move-to-project picker shown after marking an unassigned invoice paid */}
      <Dialog open={!!moveToInvoice} onOpenChange={open => { if (!open) setMoveToInvoice(null); }}>
        <DialogHeader>
          <DialogTitle>Move to</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Invoice marked as paid. Choose a project to move it to.
          </p>
        </DialogHeader>
        <div className="max-h-80 overflow-y-auto -mx-1 px-1 space-y-1">
          {(projects ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">No projects yet.</p>
          )}
          {(projects ?? []).map(p => (
            <button
              key={p.id}
              type="button"
              disabled={movingProject}
              onClick={() => moveToInvoice && moveInvoiceToProject(moveToInvoice.id, p.id)}
              className="w-full text-left rounded-lg border border-border px-4 py-3 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
            >
              {p.name}
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setMoveToInvoice(null)}>
            {movingProject ? "Moving…" : "Skip"}
          </Button>
        </DialogFooter>
      </Dialog>

      <ShareModal
        open={!!shareInvoice}
        onClose={() => setShareInvoice(null)}
        entityType="invoice"
        entityId={shareInvoice?.id ?? ""}
        entityName={shareInvoice ? `Invoice – ${shareInvoice.counterpartyName}` : ""}
        fileUrl={shareInvoice?.attachmentUrl ?? undefined}
        projectId={shareInvoice?.projectId}
      />

      {activityViewer && (
        <AlertViewer
          items={activityViewer.items}
          startIndex={activityViewer.index}
          onOpenItem={handleActivityClick}
          onMarkRead={markActivityRead}
          onClose={() => setActivityViewer(null)}
        />
      )}
    </SidebarLayout>
  );
}
