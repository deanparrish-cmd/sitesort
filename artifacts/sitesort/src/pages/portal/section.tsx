import { useState, useEffect, useRef } from "react";
import { useRoute, useSearch, Link } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  useGetPortalOverview, useGetPortalProgress, useGetPortalTeam,
  useGetPortalSiteIssues, useGetPortalSiteBoard, useGetPortalHs,
  useGetPortalDrawings, useGetPortalMethodStatements, useGetPortalPermits,
  useGetPortalSafety, useGetPortalGeneral, useGetPortalShared,
  useGetPortalMyDocuments, useGetPortalUnseen, useGetPortalContext,
  useGetPortalPlantMaterials, useUpdatePortalPlantMaterialItem,
  useCreatePortalSiteIssue, useUpdatePortalSiteIssue,
  getGetPortalOverviewQueryKey, getGetPortalSiteIssuesQueryKey,
  getGetPortalGeneralQueryKey, getGetPortalSharedQueryKey,
  getGetPortalMyDocumentsQueryKey, getGetPortalUnseenQueryKey,
  getGetPortalPlantMaterialsQueryKey,
} from "@workspace/api-client-react";
import { QRCodeSVG } from "qrcode.react";
import { PortalLayout, SECTION_NAV } from "./layout";
import { portalQueryClient, PORTAL_LIVE_REFETCH } from "./query-client";
import { Spinner } from "@/components/ui/spinner";
import { LinkRow } from "@/components/ui/link-row";
import {
  ExternalLink, MapPin, Calendar, CheckCircle2, Circle, Phone, Mail,
  FileText, AlertTriangle, StickyNote, Download, TrendingUp, FileCheck, Users,
  QrCode, Copy, Building2, ShieldCheck, X, Sparkles, UploadCloud, Share, Plus,
} from "lucide-react";
import { isCadFile, cadBadgeLabel, downloadFile } from "@/lib/documents";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  pushSupported, permissionState, isDeviceSubscribed, enablePush, disablePush,
  iosNeedsInstall, isIOS,
} from "@/lib/portal-push";
import { Bell, BellOff } from "lucide-react";

// Portal-authed binary download: the app's global fetch interceptor attaches the
// portal bearer token to /api/portal/* requests, so a plain <a href> (which does
// NOT carry the Authorization header) would 401. Instead fetch to a blob, then
// trigger a download from that in-memory object URL.
async function downloadAuthed(url: string, filename: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

// ---------- shared helpers ----------

// New uploads are served at /api/uploads; legacy rows may still say /uploads.
function fileHref(url?: string | null): string | undefined {
  if (!url) return undefined;
  return url.startsWith("/uploads/") ? `/api${url}` : url;
}

// Open/download a document. CAD files download (the browser can't render them);
// PDFs/images open in a new tab. The window is opened SYNCHRONOUSLY from the click
// so popup blockers don't fire. Returns whether a file was actually opened.
function openDocFile(doc: { fileUrl?: string | null; name?: string | null }): boolean {
  if (!doc.fileUrl) return false;
  if (isCadFile(doc.fileUrl, doc.name)) { downloadFile(doc.fileUrl, doc.name); return true; }
  const href = fileHref(doc.fileUrl);
  if (href) { window.open(href, "_blank", "noopener"); return true; }
  return false;
}

// Re-check a document's CURRENT status at the moment it's opened (drawings +
// method statements have a per-item endpoint that returns fresh data AND logs the
// view server-side). This guarantees a doc that was superseded — or unshared —
// since the list was last fetched is reported accurately, never from a stale
// cache. Fired after the file opens; the result drives a toast, not the open.
type FreshDoc = { status?: string } | null;
async function fetchFreshDoc(section: string, id: string): Promise<{ ok: boolean; doc: FreshDoc }> {
  try {
    const res = await fetch(`/api/portal/${section}/${id}`);
    if (res.status === 404) return { ok: false, doc: null };
    if (!res.ok) return { ok: true, doc: null };
    return { ok: true, doc: await res.json() };
  } catch {
    return { ok: true, doc: null };
  }
}

function fmtDate(d?: string | null): string {
  if (!d) return "—";
  const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function fmtDateTime(d?: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function Loading() {
  return <div className="flex justify-center py-16"><Spinner className="size-7 text-primary" /></div>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-center py-12 text-muted-foreground text-sm">{children}</div>;
}
function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-card border border-border rounded-xl p-4 ${className}`}>{children}</div>;
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-display font-bold mb-3">{children}</h2>;
}
// Small dismissible "filtered by …" chip; the clear link drops the query param.
function FilterChip({ label, clearHref }: { label: string; clearHref: string }) {
  return (
    <div className="flex items-center gap-2 mb-1">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary text-xs font-semibold pl-3 pr-1.5 py-1">
        <span className="truncate max-w-[70vw]">{label}</span>
        <Link href={clearHref} className="shrink-0 rounded-full p-0.5 hover:bg-primary/20" aria-label="Show all"><X className="w-3 h-3" /></Link>
      </span>
    </div>
  );
}

const PERMIT_BADGE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  expiring_soon: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  expired: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
};
const ISSUE_BADGE: Record<string, string> = {
  new: "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  open: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
  in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  pending_confirmation: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-300",
  resolved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
};
const PLANT_STATUS_BADGE: Record<string, string> = {
  on_site: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  on_order: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  off_hired: "bg-muted text-muted-foreground",
  depleted: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
};
const PLANT_STATUS_OPTIONS = [
  { value: "on_site", label: "On site" },
  { value: "on_order", label: "On order" },
  { value: "off_hired", label: "Off-hired" },
  { value: "depleted", label: "Depleted" },
];
function Badge({ label, className }: { label: string; className?: string }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${className ?? "bg-muted text-muted-foreground"}`}>{label}</span>;
}

// Small "New" pill for unseen (newly-shared) items in "Shared with me".
function NewPill() {
  return <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide bg-primary text-primary-foreground px-1.5 py-0.5 rounded">New</span>;
}

// A row for a document (drawing / method statement / safety / general doc). The
// superseded badge reflects the last list fetch; opening re-checks live status.
// FreshDoc extended to carry the superseded replacement (T003): the per-item
// endpoint returns supersededBy pointing at the live version so we can offer it.
type SupersededBy = { id: string; name: string; version: number; revision?: string };
type FreshDocFull = { status?: string; supersededBy?: SupersededBy } | null;

function DocRow({ doc, section, unseen }: { doc: any; section: string; unseen?: boolean }) {
  const { toast } = useToast();
  const clickable = section === "drawings" || section === "method-statements";
  const cad = cadBadgeLabel(doc.fileUrl, doc.name);
  const [supersededNow, setSupersededNow] = useState(doc.status === "superseded");
  const [downloading, setDownloading] = useState(false);

  // Open the live replacement of a superseded document: fetch its detail for the
  // freshest fileUrl, then open/download it.
  const openReplacement = async (replacement: SupersededBy) => {
    try {
      const res = await fetch(`/api/portal/${section}/${replacement.id}`);
      if (!res.ok) throw new Error();
      const fresh = await res.json();
      if (!openDocFile(fresh)) throw new Error();
    } catch {
      toast({ title: "Couldn't open replacement", description: "Please try again from the list.", variant: "destructive" });
    }
  };

  const open = () => {
    openDocFile(doc);
    if (!clickable) return;
    // Confirm current status at open (not from the cached list row).
    void fetchFreshDoc(section, doc.id).then(({ ok, doc: fresh }: { ok: boolean; doc: FreshDocFull }) => {
      if (!ok) {
        toast({ title: "No longer available", description: "This document has been removed or is no longer shared with you.", variant: "destructive" });
        return;
      }
      if (fresh?.status === "superseded") {
        setSupersededNow(true);
        const repl = fresh.supersededBy;
        toast({
          title: "Superseded document",
          description: repl
            ? `"${doc.name}" has been replaced by "${repl.name}"${repl.revision ? ` (Rev ${repl.revision})` : ` (v${repl.version})`}.`
            : `"${doc.name}" has been superseded by a newer version.`,
          variant: "destructive",
          action: repl ? (
            <ToastAction altText="Open the latest version" onClick={() => void openReplacement(repl)}>
              Open latest
            </ToastAction>
          ) : undefined,
        });
      } else if (fresh && fresh.status !== "superseded") {
        setSupersededNow(false);
      }
    });
  };

  // Download the file itself (always, regardless of type) via the authed portal
  // download endpoint that streams with Content-Disposition attachment.
  const download = async () => {
    setDownloading(true);
    try {
      await downloadAuthed(`/api/portal/documents/${doc.id}/download`, doc.name || "document");
    } catch {
      toast({ title: "Download failed", description: "Please try again.", variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className={cn("flex items-center justify-between gap-3 py-2.5 border-b border-border/60 last:border-0", unseen && "-mx-4 px-4 bg-primary/5")}>
      <div className="min-w-0">
        <p className="font-medium truncate flex items-center gap-1.5">
          {unseen && <NewPill />}
          <span className="truncate">{doc.name}</span>
          {supersededNow && (
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 px-1.5 py-0.5 rounded">Superseded</span>
          )}
        </p>
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <span>{doc.revision ? `Rev ${doc.revision}` : `v${doc.version}`} · {fmtDate(doc.createdAt)}</span>
          {cad && <span className="font-mono bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 px-1.5 py-0.5 rounded text-[10px] font-bold">{cad}</span>}
        </p>
      </div>
      <div className="shrink-0 flex items-center gap-1">
        <button
          onClick={open}
          className="inline-flex items-center gap-1 rounded-lg px-3 min-h-11 text-sm text-primary font-medium hover:bg-primary/10"
        >
          {cad ? <><Download className="w-4 h-4" /> Download</> : <><ExternalLink className="w-4 h-4" /> View</>}
        </button>
        {!cad && (
          <button
            onClick={() => void download()}
            disabled={downloading}
            aria-label={`Download ${doc.name}`}
            className="inline-flex items-center justify-center rounded-lg px-3 min-h-11 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
function PermitRow({ p, unseen }: { p: any; unseen?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 py-2.5 border-b border-border/60 last:border-0", unseen && "-mx-4 px-4 bg-primary/5")}>
      <div className="min-w-0">
        <p className="font-medium truncate flex items-center gap-1.5">{unseen && <NewPill />}<span className="truncate">{p.type}</span></p>
        <p className="text-xs text-muted-foreground truncate">{p.description} · expires {fmtDate(p.expiryDate)}</p>
      </div>
      <Badge label={p.status === "expiring_soon" ? "Expiring" : p.status === "expired" ? "Expired" : "Active"} className={PERMIT_BADGE[p.status]} />
    </div>
  );
}

// ---------- section views ----------

// Human labels for the "New since your last visit" card — keyed by section key
// (from SECTION_NAV, minus non-content sections that never carry unseen counts).
const SECTION_LABEL: Record<string, string> = Object.fromEntries(SECTION_NAV.map(s => [s.key, s.label]));

function WhatsNewCard() {
  // Reuse the same unseen data the nav badges use (polled + focus-refetched).
  const { data } = useGetPortalUnseen({ query: { refetchInterval: 60_000, queryKey: getGetPortalUnseenQueryKey() } });
  const counts = (data?.counts ?? {}) as Record<string, number>;
  // Don't list Overview itself (you're already here); order follows the nav.
  const entries = SECTION_NAV
    .filter(s => s.key !== "overview" && (counts[s.key] ?? 0) > 0)
    .map(s => ({ key: s.key, label: SECTION_LABEL[s.key] ?? s.key, count: counts[s.key], Icon: s.Icon }));
  if (entries.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-display font-bold">New since your last visit</h2>
      </div>
      <div className="space-y-2">
        {entries.map(e => (
          <LinkRow
            key={e.key}
            href={`/portal/${e.key}`}
            icon={<e.Icon className="w-5 h-5 text-primary" />}
            label={e.label}
            detail={<span className="min-w-[1.5rem] h-6 px-1.5 rounded-full text-xs font-bold flex items-center justify-center bg-primary text-primary-foreground">{e.count > 99 ? "99+" : e.count}</span>}
            ariaLabel={`${e.label}: ${e.count} new`}
          />
        ))}
      </div>
    </div>
  );
}

function OverviewView() {
  // Site updates are time-sensitive → poll while visible.
  const { data, isLoading } = useGetPortalOverview({ query: { refetchInterval: PORTAL_LIVE_REFETCH, queryKey: getGetPortalOverviewQueryKey() } });
  if (isLoading) return <Loading />;
  if (!data) return <Empty>Nothing to show yet.</Empty>;
  const stats = [
    { label: "Open issues", value: data.stats.openIssues, href: "/portal/site-issues?status=open", Icon: AlertTriangle },
    { label: "Milestones left", value: data.stats.upcomingMilestones, href: "/portal/progress", Icon: TrendingUp },
    { label: "Active permits", value: data.stats.activePermits, href: "/portal/permits?status=active", Icon: FileCheck },
    { label: "Team size", value: data.stats.teamSize, href: "/portal/team", Icon: Users },
  ];
  return (
    <div className="space-y-5">
      <WhatsNewCard />
      <Card>
        <p className="text-sm text-muted-foreground">{data.project.address}</p>
        <div className="flex items-center gap-2 mt-3">
          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500" style={{ width: `${data.project.progressPercent}%` }} />
          </div>
          <span className="text-sm font-bold">{data.project.progressPercent}%</span>
        </div>
      </Card>
      {/* Each stat is a whole-row tap target (shared LinkRow) into its section, pre-filtered. */}
      <div className="space-y-2">
        {stats.map(s => (
          <LinkRow
            key={s.label}
            href={s.href}
            icon={<s.Icon className="w-5 h-5 text-primary" />}
            label={s.label}
            detail={<span className="text-lg font-bold text-foreground">{s.value}</span>}
            ariaLabel={`${s.label}: ${s.value}`}
          />
        ))}
      </div>
      <div>
        <SectionTitle>Recent site updates</SectionTitle>
        {data.recentNotes.length === 0 ? <Empty>No site updates posted yet.</Empty> : (
          <div className="space-y-3">
            {data.recentNotes.map(n => (
              <Card key={n.id}>
                <p className="text-sm whitespace-pre-wrap break-words">{n.body}</p>
                <p className="text-xs text-muted-foreground mt-2">{n.authorName} · {fmtDate(n.noteDate)}</p>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressView() {
  const { data, isLoading } = useGetPortalProgress();
  if (isLoading) return <Loading />;
  if (!data) return <Empty>Nothing to show yet.</Empty>;
  return (
    <div className="space-y-5">
      <Card>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500" style={{ width: `${data.progressPercent}%` }} />
          </div>
          <span className="text-sm font-bold">{data.progressPercent}%</span>
        </div>
      </Card>
      {data.milestones.length === 0 ? <Empty>No milestones set for this project yet.</Empty> : (
        <Card>
          {data.milestones.map(m => (
            <div key={m.id} className="flex items-start gap-3 py-2.5 border-b border-border/60 last:border-0">
              {m.completedAt
                ? <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                : <Circle className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />}
              <div className="min-w-0">
                <p className={`font-medium ${m.completedAt ? "line-through text-muted-foreground" : ""}`}>{m.title}</p>
                <p className="text-xs text-muted-foreground">Due {fmtDate(m.dueDate)}</p>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function TeamView() {
  const { data, isLoading } = useGetPortalTeam();
  if (isLoading) return <Loading />;
  if (!data || data.length === 0) return <Empty>No team members added yet.</Empty>;
  return (
    <div className="space-y-3">
      {data.map((m, i) => (
        <Card key={i} className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold shrink-0">
            {m.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium truncate">{m.name}</p>
            <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
              <Building2 className="w-3 h-3 shrink-0" /> {m.company}
            </p>
            <p className="text-xs text-muted-foreground truncate capitalize">{m.jobTitle || m.role}</p>
            {(m.phone || m.email) && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 min-w-0">
                {m.phone && (
                  <a href={`tel:${m.phone}`} className="inline-flex items-center gap-1 text-xs text-primary font-medium">
                    <Phone className="w-3 h-3 shrink-0" /> {m.phone}
                  </a>
                )}
                {m.email && (
                  <a href={`mailto:${m.email}`} className="inline-flex items-center gap-1 text-xs text-primary font-medium min-w-0 max-w-full">
                    <Mail className="w-3 h-3 shrink-0" /> <span className="truncate">{m.email}</span>
                  </a>
                )}
              </div>
            )}
            {(m.certifications?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {m.certifications!.map((c, ci) => (
                  <span key={ci} className={cn(
                    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border",
                    c.status === "expired" ? "bg-red-50 text-red-700 border-red-200" :
                    c.status === "expiring_soon" ? "bg-amber-50 text-amber-700 border-amber-200" :
                    "bg-emerald-50 text-emerald-700 border-emerald-200"
                  )}>
                    {c.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

const ISSUE_TYPE_LABEL: Record<string, string> = { snag: "Snag", safety_concern: "Safety concern", work_completed: "Work completed" };

// "Log an issue" form — gated on canLogIssues from /portal/me. Mirrors the
// dashboard form but WITHOUT "Assign to"; server also ignores any assignee/
// due-date the client might send. Uses the generated multipart mutation
// (photo is a plain Blob field in the request body — orval builds the
// FormData), same as MyDocumentsView's upload but without a manual fetch.
function LogIssueForm({ onLogged }: { onLogged: () => void }) {
  const { toast } = useToast();
  const create = useCreatePortalSiteIssue();
  const [type, setType] = useState<"snag" | "safety_concern" | "work_completed">("snag");
  const [description, setDescription] = useState("");
  const [zone, setZone] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await create.mutateAsync({ data: { type, description: description || undefined, zone: zone || undefined, photo: file ?? undefined } });
      toast({ title: "Issue logged" });
      setDescription(""); setZone(""); setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      onLogged();
    } catch {
      toast({ title: "Couldn't log issue", description: "Please try again.", variant: "destructive" });
    }
  };

  return (
    <Card>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Type</label>
          <select value={type} onChange={e => setType(e.target.value as typeof type)} className="mt-1 w-full min-h-12 rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
            <option value="snag">Snag</option>
            <option value="safety_concern">Safety Concern</option>
            <option value="work_completed">Work Completed</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="What's the issue?" className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Zone / location</label>
          <input value={zone} onChange={e => setZone(e.target.value)} placeholder="e.g. Level 2, East wing" className="mt-1 w-full min-h-12 rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Photo</label>
          <input ref={fileRef} type="file" accept="image/*" onChange={e => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 w-full text-sm file:mr-3 file:min-h-10 file:rounded-lg file:border-0 file:bg-primary/10 file:px-4 file:text-sm file:font-medium file:text-primary" />
        </div>
        <button type="submit" disabled={create.isPending} className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary min-h-12 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          <AlertTriangle className="w-4 h-4" /> {create.isPending ? "Logging…" : "Log issue"}
        </button>
      </form>
    </Card>
  );
}

function SiteIssuesView() {
  const openOnly = new URLSearchParams(useSearch()).get("status") === "open";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: ctx } = useGetPortalContext();
  const selfUserId = ctx?.member?.userId;
  const canLogIssues = ctx?.member?.canLogIssues ?? true;
  const { data, isLoading } = useGetPortalSiteIssues({ query: { refetchInterval: PORTAL_LIVE_REFETCH, queryKey: getGetPortalSiteIssuesQueryKey() } });
  const markDone = useUpdatePortalSiteIssue();
  const [showForm, setShowForm] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getGetPortalSiteIssuesQueryKey() });
  const doMarkDone = async (issueId: string) => {
    try {
      await markDone.mutateAsync({ issueId, data: {} });
      toast({ title: "Marked done — awaiting PM confirmation" });
      await invalidate();
    } catch {
      toast({ title: "Couldn't update issue", variant: "destructive" });
    }
  };

  const issues = data ?? [];
  const filtered = openOnly ? issues.filter(i => (i.status ?? "open") !== "resolved") : issues;

  return (
    <div className="space-y-4">
      {canLogIssues && (
        showForm ? (
          <LogIssueForm onLogged={() => { setShowForm(false); void invalidate(); }} />
        ) : (
          <button onClick={() => setShowForm(true)} className="w-full inline-flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border min-h-12 text-sm font-semibold text-primary hover:bg-primary/5">
            <AlertTriangle className="w-4 h-4" /> Log an issue
          </button>
        )
      )}
      {openOnly && <FilterChip label="Open issues only" clearHref="/portal/site-issues" />}
      {isLoading ? <Loading /> : filtered.length === 0 ? (
        <Empty>{issues.length === 0 ? "Nothing shared with you here yet." : "No open issues right now."}</Empty>
      ) : filtered.map(issue => {
        const isMine = !!selfUserId && issue.assignedToUserId === selfUserId;
        const canMarkDone = isMine && (issue.status === "open" || issue.status === "in_progress");
        return (
          <Card key={issue.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="font-medium">{ISSUE_TYPE_LABEL[issue.category] ?? issue.category}</span>
                  <span className="text-xs text-muted-foreground">#{issue.referenceNumber}</span>
                </div>
                {issue.description && <p className="text-sm mt-1 break-words">{issue.description}</p>}
                <p className="text-xs text-muted-foreground mt-1">
                  {issue.zone ? `${issue.zone} · ` : ""}{fmtDate(issue.takenAt)}
                  {issue.reporterName ? ` · reported by you` : ""}
                </p>
              </div>
              <Badge label={(issue.status ?? "open").replace(/_/g, " ")} className={ISSUE_BADGE[issue.status ?? "open"] ?? "bg-muted text-muted-foreground"} />
            </div>
            {issue.photoUrl && (
              <img src={fileHref(issue.photoUrl)} alt="" className="mt-3 rounded-lg w-full max-h-56 object-cover" loading="lazy" />
            )}
            {canMarkDone && (
              <button onClick={() => doMarkDone(issue.id)} disabled={markDone.isPending}
                className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-200 bg-cyan-50 text-cyan-700 min-h-11 text-sm font-semibold hover:bg-cyan-100 disabled:opacity-50">
                Mark as done — awaiting confirmation
              </button>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// Full Site Board — same content as the public scanned view (single source), plus
// the board's own QR so anyone on site can rescan/share it.
function SiteBoardView() {
  const { data, isLoading } = useGetPortalSiteBoard();
  if (isLoading) return <Loading />;
  if (!data) return <Empty>Site board unavailable.</Empty>;
  const siteUrl = data.qrToken ? `${window.location.origin}/site/${data.qrToken}` : null;
  const pins = data.pinnedItems ?? [];
  const pinnedDocs = pins.filter(p => p.itemType === "document");
  const pinnedPermits = pins.filter(p => p.itemType === "permit");
  const pinnedPhotos = pins.filter(p => p.itemType === "photo");
  const permitBadge = (s?: string) => s === "expired" ? "bg-rose-100 text-rose-800" : s === "expiring_soon" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800";
  return (
    <div className="space-y-5">
      {/* Project */}
      <Card>
        <h2 className="text-lg font-display font-bold truncate">{data.project.name}</h2>
        <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1"><MapPin className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{data.project.address}</span></p>
        <span className="inline-block mt-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-muted capitalize">{data.project.status}</span>
      </Card>

      {/* Site board QR */}
      {siteUrl && (
        <Card className="flex flex-col items-center text-center">
          <SectionTitle>Site board QR code</SectionTitle>
          <div className="p-3 bg-white rounded-xl border"><QRCodeSVG value={siteUrl} size={168} level="H" includeMargin /></div>
          <p className="text-xs text-muted-foreground break-all mt-2 px-2 max-w-full">{siteUrl}</p>
          <div className="flex gap-2 mt-3">
            <a href={siteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium hover:bg-muted"><QrCode className="w-4 h-4" /> Open</a>
            <button onClick={() => { navigator.clipboard.writeText(siteUrl).catch(() => {}); }} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium hover:bg-muted"><Copy className="w-4 h-4" /> Copy link</button>
          </div>
        </Card>
      )}

      {/* Site manager */}
      {data.siteManager && (
        <div>
          <SectionTitle>Site manager</SectionTitle>
          <Card>
            <p className="font-medium truncate">{data.siteManager.name}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 min-w-0">
              {data.siteManager.phone && <a href={`tel:${data.siteManager.phone}`} className="inline-flex items-center gap-1 text-xs text-primary font-medium"><Phone className="w-3 h-3" /> {data.siteManager.phone}</a>}
              {data.siteManager.email && <a href={`mailto:${data.siteManager.email}`} className="inline-flex items-center gap-1 text-xs text-primary font-medium min-w-0 max-w-full"><Mail className="w-3 h-3 shrink-0" /><span className="truncate">{data.siteManager.email}</span></a>}
            </div>
          </Card>
        </div>
      )}

      {/* Active permits */}
      {data.permits.length > 0 && (
        <div>
          <SectionTitle>Permits</SectionTitle>
          <Card>
            {data.permits.map(p => (
              <div key={p.id} className="flex items-center justify-between gap-3 py-2.5 border-b border-border/60 last:border-0">
                <div className="min-w-0"><p className="font-medium truncate capitalize">{p.type}</p>{p.description && <p className="text-xs text-muted-foreground truncate">{p.description}</p>}</div>
                <span className="text-xs text-muted-foreground shrink-0">Expires {fmtDate(p.expiryDate)}</span>
              </div>
            ))}
          </Card>
        </div>
      )}

      {/* Public documents on display */}
      {data.documents.length > 0 && (
        <div>
          <SectionTitle>Documents on display</SectionTitle>
          <Card>
            {data.documents.map(d => (
              <div key={d.id} className="flex items-center gap-3 py-2.5 border-b border-border/60 last:border-0">
                <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="min-w-0"><p className="font-medium truncate">{d.name}</p><p className="text-xs text-muted-foreground capitalize">{d.type} · v{d.version}</p></div>
              </div>
            ))}
          </Card>
        </div>
      )}

      {/* Trades on site */}
      {data.project.trades.length > 0 && (
        <div>
          <SectionTitle>Trades on site</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {data.project.trades.map(t => <span key={t} className="inline-flex max-w-full px-2.5 py-1 rounded-full bg-muted text-xs font-medium"><span className="truncate">{t}</span></span>)}
          </div>
        </div>
      )}

      {/* Pinned items */}
      {pinnedDocs.length > 0 && (
        <div>
          <SectionTitle>Pinned documents</SectionTitle>
          <Card>{pinnedDocs.map(d => (
            <div key={d.id} className="flex items-center justify-between gap-3 py-2.5 border-b border-border/60 last:border-0">
              <div className="min-w-0"><p className="font-medium truncate flex items-center gap-1.5"><span className="truncate">{d.name}</span>{d.superseded && <span className="shrink-0 text-[10px] font-bold uppercase bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Superseded</span>}</p><p className="text-xs text-muted-foreground capitalize">{d.type} · v{d.version}</p></div>
              {d.fileUrl && <button onClick={() => window.open(fileHref(d.fileUrl), "_blank", "noopener")} className="shrink-0 text-sm text-primary font-medium">View</button>}
            </div>
          ))}</Card>
        </div>
      )}
      {pinnedPermits.length > 0 && (
        <div>
          <SectionTitle>Pinned permits</SectionTitle>
          <Card>{pinnedPermits.map(p => (
            <div key={p.id} className="flex items-center justify-between gap-3 py-2.5 border-b border-border/60 last:border-0">
              <div className="min-w-0"><p className="font-medium truncate capitalize">{p.type}</p>{p.description && <p className="text-xs text-muted-foreground truncate">{p.description}</p>}</div>
              <span className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ${permitBadge(p.status)}`}>{p.status === "expiring_soon" ? "Expiring" : p.status === "expired" ? "Expired" : "Active"}</span>
            </div>
          ))}</Card>
        </div>
      )}
      {pinnedPhotos.length > 0 && (
        <div>
          <SectionTitle>Pinned photos</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            {pinnedPhotos.map(p => p.photoUrl && <img key={p.id} src={fileHref(p.photoUrl)} alt="" className="rounded-lg w-full h-32 object-cover" loading="lazy" />)}
          </div>
        </div>
      )}

      {/* Upcoming events */}
      {data.upcomingEvents.length > 0 && (
        <div>
          <SectionTitle>Upcoming events</SectionTitle>
          <Card>
            {data.upcomingEvents.map(e => (
              <div key={e.id} className="flex items-center gap-3 py-2 border-b border-border/60 last:border-0">
                <Calendar className="w-4 h-4 text-primary shrink-0" />
                <div className="min-w-0"><p className="font-medium truncate">{e.title}</p><p className="text-xs text-muted-foreground">{fmtDate(e.eventDate)}{e.note ? ` · ${e.note}` : ""}</p></div>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}

function HsView() {
  const { data, isLoading } = useGetPortalHs();
  if (isLoading) return <Loading />;
  if (!data) return <Empty>Nothing to show yet.</Empty>;
  return (
    <div className="space-y-5">
      <div>
        <SectionTitle>Method statements</SectionTitle>
        {data.methodStatements.length === 0 ? <Empty>None uploaded.</Empty> : <Card>{data.methodStatements.map(d => <DocRow key={d.id} doc={d} section="method-statements" />)}</Card>}
      </div>
      <div>
        <SectionTitle>Safety documents</SectionTitle>
        {data.safety.length === 0 ? <Empty>None uploaded.</Empty> : <Card>{data.safety.map(d => <DocRow key={d.id} doc={d} section="safety" />)}</Card>}
      </div>
      <div>
        <SectionTitle>Permits</SectionTitle>
        {data.permits.length === 0 ? <Empty>None active.</Empty> : <Card>{data.permits.map(p => <PermitRow key={p.id} p={p} />)}</Card>}
      </div>
    </div>
  );
}

function DocListView({ section, hook, empty, live, downloadAll }: { section: string; hook: any; empty: string; live?: boolean; downloadAll?: boolean }) {
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);
  const { data, isLoading } = hook(live ? { query: { refetchInterval: PORTAL_LIVE_REFETCH } } : undefined);
  if (isLoading) return <Loading />;
  if (!data || data.length === 0) return <Empty>{empty}</Empty>;
  const grabAll = async () => {
    setDownloading(true);
    try {
      await downloadAuthed("/api/portal/drawings/download-all", "drawings.zip");
    } catch {
      toast({ title: "Download failed", description: "Please try again.", variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  };
  return (
    <div className="space-y-3">
      {downloadAll && (
        <button
          onClick={() => void grabAll()}
          disabled={downloading}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 min-h-12 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Download className="w-4 h-4" /> {downloading ? "Preparing…" : "Download all"}
        </button>
      )}
      <Card>{data.map((d: any) => <DocRow key={d.id} doc={d} section={section} />)}</Card>
    </div>
  );
}

function PermitsView() {
  const activeOnly = new URLSearchParams(useSearch()).get("status") === "active";
  const { data, isLoading } = useGetPortalPermits();
  if (isLoading) return <Loading />;
  if (!data || data.length === 0) return <Empty>Nothing shared with you here yet.</Empty>;
  const permits = activeOnly ? data.filter(p => p.status === "active") : data;
  return (
    <div className="space-y-2">
      {activeOnly && <FilterChip label="Active permits only" clearHref="/portal/permits" />}
      {permits.length === 0 ? <Empty>No active permits right now.</Empty> : <Card>{permits.map(p => <PermitRow key={p.id} p={p} />)}</Card>}
    </div>
  );
}

function GeneralView() {
  // Site notes are time-sensitive → poll while visible.
  const { data, isLoading } = useGetPortalGeneral({ query: { refetchInterval: PORTAL_LIVE_REFETCH, queryKey: getGetPortalGeneralQueryKey() } });
  if (isLoading) return <Loading />;
  if (!data) return <Empty>Nothing to show yet.</Empty>;
  return (
    <div className="space-y-5">
      <div>
        <SectionTitle>General documents</SectionTitle>
        {data.documents.length === 0 ? <Empty>Nothing shared with you here yet.</Empty> : <Card>{data.documents.map(d => <DocRow key={d.id} doc={d} section="general" />)}</Card>}
      </div>
      <div>
        <SectionTitle>Site notes</SectionTitle>
        {data.notes.length === 0 ? <Empty>No notes posted.</Empty> : (
          <div className="space-y-3">
            {data.notes.map(n => (
              <Card key={n.id}>
                <p className="text-sm whitespace-pre-wrap break-words">{n.body}</p>
                <p className="text-xs text-muted-foreground mt-2">{n.authorName} · {fmtDate(n.noteDate)}</p>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Map a document's type to its portal section so opening it from the aggregate
// "Shared with me" view still hits the per-item endpoint that logs the view +
// registers it in distribution tracking.
function docTypeSection(type?: string): string {
  if (type === "drawing") return "drawings";
  if (type === "method_statement") return "method-statements";
  if (type === "safety") return "safety";
  return "general";
}

function SharedView() {
  const { data, isLoading } = useGetPortalShared({ query: { refetchInterval: PORTAL_LIVE_REFETCH, queryKey: getGetPortalSharedQueryKey() } });
  // "New" highlights are STICKY for the visit: capture the unseen ids on first
  // load and keep highlighting them, so a background refetch (which sees the
  // section as now-viewed → unseen:false) doesn't make the highlight flicker away
  // while the member is still reading the page. The nav badge still clears.
  const unseenIds = useRef<Set<string> | null>(null);
  if (data && unseenIds.current === null) {
    unseenIds.current = new Set<string>([...data.documents, ...data.permits, ...data.photos].filter((i: any) => i.unseen).map((i: any) => i.id));
  }
  const isNew = (id: string) => unseenIds.current?.has(id) ?? false;
  if (isLoading) return <Loading />;
  const empty = !data || (!data.documents.length && !data.photos.length && !data.permits.length);
  if (empty) return <Empty>Nothing has been shared with you yet. Your project manager will share drawings, documents and updates here.</Empty>;
  return (
    <div className="space-y-5">
      {data!.documents.length > 0 && (
        <div><SectionTitle>Documents</SectionTitle><Card>{data!.documents.map(d => <DocRow key={d.id} doc={d} section={docTypeSection(d.type)} unseen={isNew(d.id)} />)}</Card></div>
      )}
      {data!.permits.length > 0 && (
        <div><SectionTitle>Permits</SectionTitle><Card>{data!.permits.map(p => <PermitRow key={p.id} p={p} unseen={isNew(p.id)} />)}</Card></div>
      )}
      {data!.photos.length > 0 && (
        <div><SectionTitle>Site issues</SectionTitle><div className="space-y-3">
          {data!.photos.map(issue => (
            <Card key={issue.id} className={cn(isNew(issue.id) && "ring-1 ring-primary/40")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {isNew(issue.id) && <NewPill />}
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                    <span className="font-medium">{issue.category === "safety_concern" ? "Safety concern" : "Snag"}</span>
                    <span className="text-xs text-muted-foreground">#{issue.referenceNumber}</span>
                  </div>
                  {issue.description && <p className="text-sm mt-1 break-words">{issue.description}</p>}
                  <p className="text-xs text-muted-foreground mt-1">{issue.zone ? `${issue.zone} · ` : ""}{fmtDate(issue.takenAt)}</p>
                </div>
                <Badge label={(issue.status ?? "open").replace("_", " ")} className={ISSUE_BADGE[issue.status ?? "open"]} />
              </div>
              {issue.photoUrl && <img src={fileHref(issue.photoUrl)} alt="" className="mt-3 rounded-lg w-full max-h-56 object-cover" loading="lazy" />}
            </Card>
          ))}
        </div></div>
      )}
    </div>
  );
}

const MY_DOC_STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending review", className: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" },
  approved: { label: "Approved", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" },
  rejected: { label: "Rejected", className: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300" },
};
const MY_DOC_KINDS = [
  { value: "insurance", label: "Insurance" },
  { value: "certification", label: "Certification" },
  { value: "other", label: "Other" },
];

// "My documents" — a portal member's own self-uploads (insurance, certs) with
// their manager-review status, plus an upload form. Big touch-friendly controls.
type PlantItemRow = {
  id: string; name: string; category: string; quantity?: string | null; unit?: string | null;
  supplierOwnerText?: string | null; supplierContactName?: string | null; location?: string | null;
  status: string; notes?: string | null; lastUpdatedByName?: string | null; lastUpdatedAt?: string | null;
  attachments?: { id: string; name: string; kind: string; fileUrl: string; createdAt: string }[];
};

// Inline edit panel for one item — only rendered for members with the
// canUpdatePlantMaterials permission. Status/location/notes only (name/
// category/supplier/dates stay dashboard-only, per the feature's scope).
function PlantItemEditPanel({ item, onClose }: { item: PlantItemRow; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const update = useUpdatePortalPlantMaterialItem();
  const [status, setStatus] = useState<"on_site" | "on_order" | "off_hired" | "depleted">(item.status as "on_site" | "on_order" | "off_hired" | "depleted");
  const [location, setLocation] = useState(item.location ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = async () => {
    try {
      await update.mutateAsync({ itemId: item.id, data: { status, location: location || null, notes: notes || null } });
      toast({ title: "Saved" });
      await queryClient.invalidateQueries({ queryKey: getGetPortalPlantMaterialsQueryKey() });
      onClose();
    } catch {
      toast({ title: "Couldn't save", variant: "destructive" });
    }
  };

  const uploadPhoto = async () => {
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("name", file.name);
      form.append("kind", "photo");
      const res = await fetch(`/api/portal/plant-materials/${item.id}/attachments`, { method: "POST", body: form });
      if (!res.ok) throw new Error();
      toast({ title: "Photo added" });
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      await queryClient.invalidateQueries({ queryKey: getGetPortalPlantMaterialsQueryKey() });
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setUploadingPhoto(false);
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-border/60 space-y-3">
      <div>
        <label className="text-xs font-medium text-muted-foreground">Status</label>
        <select value={status} onChange={e => setStatus(e.target.value as typeof status)} className="mt-1 w-full min-h-11 rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
          {PLANT_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground">Location on site</label>
        <input value={location} onChange={e => setLocation(e.target.value)} className="mt-1 w-full min-h-11 rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground">Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground">Add a photo</label>
        <div className="mt-1 flex items-center gap-2">
          <input ref={fileRef} type="file" accept="image/*" onChange={e => setFile(e.target.files?.[0] ?? null)}
            className="flex-1 text-sm file:mr-3 file:min-h-10 file:rounded-lg file:border-0 file:bg-primary/10 file:px-3 file:text-sm file:font-medium file:text-primary" />
          <button type="button" onClick={uploadPhoto} disabled={!file || uploadingPhoto}
            className="shrink-0 min-h-10 px-3 rounded-lg border text-sm font-medium hover:bg-muted disabled:opacity-50">
            {uploadingPhoto ? "Adding…" : "Add"}
          </button>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={save} disabled={update.isPending} className="flex-1 min-h-11 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {update.isPending ? "Saving…" : "Save changes"}
        </button>
        <button onClick={onClose} className="min-h-11 px-4 rounded-xl border text-sm font-medium hover:bg-muted">Cancel</button>
      </div>
    </div>
  );
}

function PlantMaterialsView() {
  const { data: ctx } = useGetPortalContext();
  const canEdit = ctx?.member?.canUpdatePlantMaterials ?? false;
  const { data, isLoading } = useGetPortalPlantMaterials({ query: { refetchInterval: PORTAL_LIVE_REFETCH, queryKey: getGetPortalPlantMaterialsQueryKey() } });
  const [editingId, setEditingId] = useState<string | null>(null);

  if (isLoading) return <Loading />;
  if (!data || data.length === 0) return <Empty>Nothing shared with you here yet.</Empty>;

  return (
    <div className="space-y-3">
      {(data as PlantItemRow[]).map(item => (
        <Card key={item.id}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium truncate">{item.name}</p>
              <p className="text-xs text-muted-foreground capitalize">{item.category.replace("_", " ")}{item.location ? ` · ${item.location}` : ""}</p>
              {item.notes && <p className="text-sm mt-1 break-words">{item.notes}</p>}
              {item.lastUpdatedByName && (
                <p className="text-xs text-muted-foreground mt-1">Last updated by {item.lastUpdatedByName}, {fmtDateTime(item.lastUpdatedAt)}</p>
              )}
            </div>
            <Badge label={PLANT_STATUS_OPTIONS.find(o => o.value === item.status)?.label ?? item.status} className={PLANT_STATUS_BADGE[item.status]} />
          </div>
          {item.attachments && item.attachments.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {item.attachments.map(a => (
                <button key={a.id} onClick={() => window.open(fileHref(a.fileUrl), "_blank", "noopener")}
                  className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs hover:bg-muted">
                  <FileText className="w-3 h-3" /> {a.name}
                </button>
              ))}
            </div>
          )}
          {canEdit && (
            editingId === item.id ? (
              <PlantItemEditPanel item={item} onClose={() => setEditingId(null)} />
            ) : (
              <button onClick={() => setEditingId(item.id)} className="mt-3 text-sm font-medium text-primary hover:underline">Update</button>
            )
          )}
        </Card>
      ))}
    </div>
  );
}

function MyDocumentsView() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetPortalMyDocuments();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("insurance");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => { setName(""); setKind("insurance"); setFile(null); if (fileRef.current) fileRef.current.value = ""; };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !name.trim()) {
      toast({ title: "Add a name and file", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("name", name.trim());
      form.append("kind", kind);
      // Raw fetch (multipart) — the global interceptor attaches the portal token.
      const res = await fetch("/api/portal/my-documents", { method: "POST", body: form });
      if (!res.ok) throw new Error();
      toast({ title: "Uploaded", description: "Your document was sent for review." });
      reset();
      await queryClient.invalidateQueries({ queryKey: getGetPortalMyDocumentsQueryKey() });
    } catch {
      toast({ title: "Upload failed", description: "Please try again.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <SectionTitle>Upload a document</SectionTitle>
        <Card>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Document name</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Public liability insurance"
                className="mt-1 w-full min-h-12 rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Type</label>
              <select
                value={kind}
                onChange={e => setKind(e.target.value)}
                className="mt-1 w-full min-h-12 rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                {MY_DOC_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">File</label>
              <input
                ref={fileRef}
                type="file"
                onChange={e => setFile(e.target.files?.[0] ?? null)}
                className="mt-1 w-full text-sm file:mr-3 file:min-h-10 file:rounded-lg file:border-0 file:bg-primary/10 file:px-4 file:text-sm file:font-medium file:text-primary"
              />
            </div>
            <button
              type="submit"
              disabled={uploading}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary min-h-12 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <UploadCloud className="w-4 h-4" /> {uploading ? "Uploading…" : "Upload for review"}
            </button>
          </form>
        </Card>
      </div>
      <div>
        <SectionTitle>My uploads</SectionTitle>
        {isLoading ? <Loading /> : !data || data.length === 0 ? (
          <Empty>You haven't uploaded any documents yet.</Empty>
        ) : (
          <Card>
            {data.map(d => {
              const st = MY_DOC_STATUS[d.status] ?? { label: d.status, className: "bg-muted text-muted-foreground" };
              return (
                <div key={d.id} className="py-3 border-b border-border/60 last:border-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{d.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{d.kind} · {fmtDate(d.createdAt)}</p>
                    </div>
                    <Badge label={st.label} className={st.className} />
                  </div>
                  {d.status === "rejected" && d.reviewNote && (
                    <p className="mt-2 text-xs text-rose-700 dark:text-rose-300 break-words">Reason: {d.reviewNote}</p>
                  )}
                  <div className="mt-2">
                    <button
                      onClick={() => window.open(fileHref(d.fileUrl), "_blank", "noopener")}
                      className="inline-flex items-center gap-1 rounded-lg px-3 min-h-11 text-sm text-primary font-medium hover:bg-primary/10"
                    >
                      <ExternalLink className="w-4 h-4" /> View
                    </button>
                  </div>
                </div>
              );
            })}
          </Card>
        )}
      </div>
    </div>
  );
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const INSTALL_HELP_DISMISS_KEY = "sitesort_portal_install_help_dismissed";

// "Add to Home Screen" help card (T004). iOS Safari can't prompt programmatically
// → show the Share → Add to Home Screen steps; Android/Chrome captures
// beforeinstallprompt and offers a one-tap Install button. Hidden when already
// installed (standalone) or dismissed.
function AddToHomeScreenCard() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(INSTALL_HELP_DISMISS_KEY) === "1"; } catch { return false; }
  });
  const [standalone] = useState(() => {
    try {
      return window.matchMedia?.("(display-mode: standalone)").matches
        || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    } catch { return false; }
  });
  const ios = isIOS();

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setDeferred(e as BeforeInstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const dismiss = () => { try { localStorage.setItem(INSTALL_HELP_DISMISS_KEY, "1"); } catch { /* ignore */ } setDismissed(true); };
  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => {});
    setDeferred(null);
    dismiss();
  };

  // Already installed, dismissed, or a desktop browser with no install path → hide.
  if (standalone || dismissed) return null;
  if (!ios && !deferred) return null;

  return (
    <div>
      <SectionTitle>Install app</SectionTitle>
      <Card>
        <div className="flex items-start gap-3">
          <img src="/icon-192.png" alt="" className="w-11 h-11 rounded-xl shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium">Add SiteSort to your Home Screen</p>
            <p className="text-xs text-muted-foreground mt-0.5">Get quick, one-tap access to your project portal.</p>
          </div>
          <button onClick={dismiss} aria-label="Dismiss" className="shrink-0 -mr-1 -mt-1 p-1.5 rounded-lg text-muted-foreground hover:bg-muted">
            <X className="w-4 h-4" />
          </button>
        </div>
        {ios ? (
          <ol className="mt-3 space-y-1.5 text-xs text-foreground">
            <li className="flex items-center gap-2">
              <span className="shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center font-semibold text-[11px]">1</span>
              <span className="flex items-center gap-1">Tap the <Share className="w-4 h-4 text-primary inline" /> <span className="font-medium">Share</span> icon in Safari</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center font-semibold text-[11px]">2</span>
              <span className="flex items-center gap-1">Choose <Plus className="w-4 h-4 text-primary inline" /> <span className="font-medium">Add to Home Screen</span></span>
            </li>
          </ol>
        ) : (
          <button
            onClick={() => void install()}
            className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary min-h-12 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Download className="w-4 h-4" /> Install app
          </button>
        )}
      </Card>
    </div>
  );
}

// Portal member Settings — notification preferences (per member, per device).
function SettingsView() {
  const { toast } = useToast();
  const [subscribed, setSubscribed] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  const [busy, setBusy] = useState(false);
  const needsInstall = iosNeedsInstall();

  const refresh = () => { setPerm(permissionState()); isDeviceSubscribed().then(setSubscribed); };
  useEffect(() => { refresh(); }, []);

  const enable = async () => {
    setBusy(true);
    const r = await enablePush();
    setBusy(false);
    if (r === "enabled") { toast({ title: "Notifications on" }); refresh(); }
    else if (r === "denied") toast({ title: "Notifications blocked", description: "Allow notifications for this site in your browser settings, then try again.", variant: "destructive" });
    else if (r === "needs_install") toast({ title: "Add to Home Screen first", description: "On iPhone, install the portal to your Home Screen, then enable notifications.", variant: "destructive" });
    else if (r !== "unsupported") toast({ title: "Couldn't enable notifications", variant: "destructive" });
  };
  const disable = async () => { setBusy(true); await disablePush(); setBusy(false); setSubscribed(false); toast({ title: "Notifications off" }); };

  return (
    <div className="space-y-5">
      <div>
        <SectionTitle>Notifications</SectionTitle>
        <Card>
          {!pushSupported() && !needsInstall ? (
            <p className="text-sm text-muted-foreground">This device or browser doesn't support notifications.</p>
          ) : needsInstall ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Add SiteSort to your Home Screen to get notifications</p>
              <ol className="space-y-1.5 text-xs text-foreground">
                <li>1. Tap the Share icon in Safari</li>
                <li>2. Choose “Add to Home Screen”</li>
                <li>3. Open SiteSort from your Home Screen, then come back here to enable</li>
              </ol>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">New content alerts</p>
                <p className="text-xs text-muted-foreground">
                  {subscribed ? "On — you'll be notified when new drawings or notices are shared." : perm === "denied" ? "Blocked in your browser settings for this site." : "Off — get a heads-up when something new is shared with you."}
                </p>
              </div>
              {subscribed ? (
                <button onClick={disable} disabled={busy} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted disabled:opacity-50">
                  <BellOff className="w-4 h-4" /> Turn off
                </button>
              ) : (
                <button onClick={enable} disabled={busy || perm === "denied"} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
                  <Bell className="w-4 h-4" /> {busy ? "…" : "Turn on"}
                </button>
              )}
            </div>
          )}
        </Card>
      </div>
      <AddToHomeScreenCard />
    </div>
  );
}

function renderSection(section: string) {
  switch (section) {
    case "overview": return <OverviewView />;
    case "shared": return <SharedView />;
    case "my-documents": return <MyDocumentsView />;
    case "settings": return <SettingsView />;
    case "progress": return <ProgressView />;
    case "team": return <TeamView />;
    case "site-issues": return <SiteIssuesView />;
    case "site-board": return <SiteBoardView />;
    case "hs": return <HsView />;
    case "drawings": return <DocListView section="drawings" hook={useGetPortalDrawings} empty="Nothing shared with you here yet." live downloadAll />;
    case "method-statements": return <DocListView section="method-statements" hook={useGetPortalMethodStatements} empty="Nothing shared with you here yet." />;
    case "permits": return <PermitsView />;
    case "safety": return <DocListView section="safety" hook={useGetPortalSafety} empty="No safety documents uploaded." />;
    case "general": return <GeneralView />;
    case "plant-materials": return <PlantMaterialsView />;
    default: return <Empty>Section not found.</Empty>;
  }
}

export default function PortalSectionPage() {
  const [, params] = useRoute("/portal/:section");
  const section = params?.section ?? "overview";
  // Portal pages run on their own QueryClient (fresh-on-focus/mount + polling)
  // so a long-lived member session never shows stale content.
  return (
    <QueryClientProvider client={portalQueryClient}>
      <PortalLayout active={section}>{renderSection(section)}</PortalLayout>
    </QueryClientProvider>
  );
}
