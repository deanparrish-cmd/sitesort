import { useState, useEffect, useRef } from "react";
import { useRoute, useSearch, useLocation, Link } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  useGetPortalOverview, useGetPortalTeam,
  useGetPortalSiteIssues, useGetPortalSiteBoard, useGetPortalPermits,
  getGetPortalPermitsQueryKey,
  useGetPortalGeneral, useGetPortalShared,
  useGetPortalMyDocuments, useGetPortalUnseen, useGetPortalContext,
  useGetPortalPlantMaterials, useUpdatePortalPlantMaterialItem,
  useSubmitPortalPlantMaterialItem, useAddPortalPlantMaterialNote,
  useCreatePortalSiteIssue, useUpdatePortalSiteIssue,
  useEditPortalSiteIssueDraft, useSubmitPortalSiteIssue, useAddPortalSiteIssueNote,
  useGetPortalDailyReport, useGetPortalDailyReportHistory, useUpdatePortalDailyReport,
  useSubmitPortalDailyReport, useAddPortalDailyReportNote,
  getGetPortalOverviewQueryKey, getGetPortalSiteIssuesQueryKey,
  getGetPortalGeneralQueryKey, getGetPortalSharedQueryKey,
  getGetPortalMyDocumentsQueryKey, getGetPortalUnseenQueryKey,
  getGetPortalPlantMaterialsQueryKey,
  getGetPortalDailyReportQueryKey, getGetPortalDailyReportHistoryQueryKey,
  getGetPortalContextQueryKey,
} from "@workspace/api-client-react";
import { DictationButton } from "@/components/ui/dictation-button";
import { MessagesView } from "./messages-view";
import { QRCodeSVG } from "qrcode.react";
import { PortalLayout, SECTION_NAV } from "./layout";
import { portalQueryClient, PORTAL_LIVE_REFETCH } from "./query-client";
import { Spinner } from "@/components/ui/spinner";
import {
  ExternalLink, MapPin, Calendar, Phone, Mail,
  FileText, AlertTriangle, StickyNote, Download,
  QrCode, Copy, Building2, ShieldCheck, X, Sparkles, UploadCloud, Share, Plus,
  ChevronDown, Users, FileSignature, CheckCircle2,
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
import { useSignOffFlow } from "@/hooks/use-sign-off-flow";

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

// ── Save-vs-submit lifecycle (shared by Site Issues, Plant & Materials, Daily
// Reports): a "Draft" is saved to the member but not yet visible to the PM;
// "Submit to PM" locks the original and puts it in front of them. After
// submit, further changes are append-only notes — never a rewrite.
function fmtRelativeShort(iso?: string | null): string {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
function LifecycleBadge({ status, submittedAt, submittedByName }: { status: "draft" | "submitted"; submittedAt?: string | null; submittedByName?: string | null }) {
  if (status === "submitted") {
    return <Badge label={`Submitted${submittedByName ? ` by ${submittedByName}` : ""}${submittedAt ? ` · ${fmtRelativeShort(submittedAt)}` : ""}`} className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" />;
  }
  return <Badge label="Draft — not yet sent" className="bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" />;
}
type SubmissionNoteItem = { id: string; authorName: string; body: string; createdAt: string };
function SubmissionNotesThread({ notes, onAdd, adding }: { notes: SubmissionNoteItem[]; onAdd: (body: string) => Promise<void>; adding?: boolean }) {
  const [draft, setDraft] = useState("");
  return (
    <div className="space-y-2 mt-3 pt-3 border-t border-border/50">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notes</p>
      {notes.length === 0 && <p className="text-xs text-muted-foreground">No notes yet — the original above is locked; add updates here instead.</p>}
      {notes.map(n => (
        <div key={n.id} className="rounded-lg bg-muted/30 p-2">
          <p className="text-sm whitespace-pre-wrap break-words">{n.body}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{n.authorName} · {fmtRelativeShort(n.createdAt)}</p>
        </div>
      ))}
      <div className="flex gap-2">
        <input
          value={draft} onChange={e => setDraft(e.target.value)} placeholder="Add a note…"
          onKeyDown={e => { if (e.key === "Enter" && draft.trim() && !adding) { void onAdd(draft.trim()).then(() => setDraft("")); } }}
          className="flex-1 min-h-9 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <DictationButton transcribeUrl="/api/portal/transcribe" onTranscript={t => setDraft(d => (d.trim() ? d.trimEnd() + " " : "") + t)} />
        <button
          disabled={!draft.trim() || adding}
          onClick={() => { void onAdd(draft.trim()).then(() => setDraft("")); }}
          className="px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
        >Add</button>
      </div>
    </div>
  );
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

function DocRow({ doc, section, unseen, signOff }: { doc: any; section: string; unseen?: boolean; signOff: ReturnType<typeof useSignOffFlow> }) {
  const { toast } = useToast();
  const clickable = section === "drawings" || section === "method-statements";
  const cad = cadBadgeLabel(doc.fileUrl, doc.name);
  const [supersededNow, setSupersededNow] = useState(doc.status === "superseded");
  const [downloading, setDownloading] = useState(false);
  const active = signOff.target?.id === doc.id;

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
    // Log the view for every doc type (not just drawings/method-statements) —
    // opening never needs a PIN, only signing off does. Fire-and-forget.
    void fetch(`/api/portal/documents/${doc.id}/view`, { method: "POST" });
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

  const needsSignOff = doc.requiresAcknowledgment && doc.myStatus !== "acknowledged";
  const signedOff = doc.requiresAcknowledgment && doc.myStatus === "acknowledged";

  return (
    <div className={cn("border-b border-border/60 last:border-0", unseen && "-mx-4 px-4 bg-primary/5")}>
      <div className="flex items-center justify-between gap-3 py-2.5">
        <div className="min-w-0">
          <p className="font-medium truncate flex items-center gap-1.5">
            {unseen && <NewPill />}
            <span className="truncate">{doc.name}</span>
            {supersededNow && (
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 px-1.5 py-0.5 rounded">Superseded</span>
            )}
          </p>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
            <span>{doc.revision ? `Rev ${doc.revision}` : `v${doc.version}`} · {fmtDate(doc.createdAt)}</span>
            {cad && <span className="font-mono bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 px-1.5 py-0.5 rounded text-[10px] font-bold">{cad}</span>}
            {signedOff && (
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                <CheckCircle2 className="w-3 h-3" /> Signed off {doc.mySignedOffAt ? fmtDate(doc.mySignedOffAt) : ""}
              </span>
            )}
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
          {needsSignOff && !active && (
            <button
              onClick={() => signOff.open({ id: doc.id, name: doc.name })}
              className="inline-flex items-center gap-1 rounded-lg px-3 min-h-11 text-sm text-primary font-semibold hover:bg-primary/10"
            >
              <FileSignature className="w-4 h-4" /> Sign off
            </button>
          )}
        </div>
      </div>
      {active && (
        <div className="pb-3">
          <SignOffPinCard flow={signOff} />
        </div>
      )}
    </div>
  );
}

// Inline (no modal) PIN entry for a portal sign-off — mobile-first, matches the
// rest of the portal's "expand in place" pattern (e.g. AddPlantItemForm) rather
// than the dashboard's dialog-based flow.
function SignOffPinCard({ flow }: { flow: ReturnType<typeof useSignOffFlow> }) {
  if (!flow.target) return null;
  return (
    <Card className="border-primary/30 bg-primary/5">
      {flow.setPinMode ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Set a 4-digit sign-off PIN to continue — you'll use it to confirm future sign-offs.</p>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Account password</label>
            <input
              type="password" autoComplete="current-password" value={flow.password} onChange={e => flow.setPassword(e.target.value)}
              placeholder="Confirm it's you"
              className="mt-1 w-full min-h-11 rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Choose a 4-digit PIN</label>
            <input
              type="password" inputMode="numeric" value={flow.newPin} onChange={e => flow.setNewPin(flow.onlyDigits(e.target.value))}
              placeholder="••••"
              className="mt-1 w-full min-h-11 rounded-xl border border-border bg-background px-3 text-sm tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
        </div>
      ) : (
        <div>
          <label className="text-xs font-medium text-muted-foreground">Enter your 4-digit PIN</label>
          <input
            type="password" inputMode="numeric" autoFocus value={flow.pin}
            onChange={e => flow.setPin(flow.onlyDigits(e.target.value))}
            onKeyDown={e => { if (e.key === "Enter") void flow.submit(); }}
            placeholder="••••"
            className="mt-1 w-full min-h-11 rounded-xl border border-border bg-background px-3 text-sm tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <button
            type="button"
            onClick={flow.forgotPin}
            className="mt-2 text-xs text-primary hover:underline"
          >
            Forgot your PIN? Reset it with your password
          </button>
        </div>
      )}
      {flow.error && <p className="mt-2 text-xs text-destructive">{flow.error}</p>}
      <div className="flex gap-2 mt-3">
        <button
          onClick={() => void flow.submit()}
          disabled={flow.submitting}
          className="flex-1 min-h-11 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"
        >
          {flow.submitting ? "Signing off…" : flow.setPinMode ? "Set PIN & sign off" : "Sign off"}
        </button>
        <button onClick={flow.close} className="min-h-11 px-4 rounded-xl border text-sm font-medium hover:bg-muted">Cancel</button>
      </div>
    </Card>
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

// One site update, rendered identically in "Site Updates" and "Past Updates".
function UpdateCard({ n }: { n: { id: string; body: string; noteDate: string; authorName: string } }) {
  return (
    <Card>
      <p className="text-sm whitespace-pre-wrap break-words">{n.body}</p>
      <p className="text-xs text-muted-foreground mt-2">{n.authorName} · {fmtDate(n.noteDate)}</p>
    </Card>
  );
}

// Portal home — 5-box redesign. Exactly five glanceable boxes: 1) Project info,
// 2) Site manager, 3) Site Updates (the latest update only), 4) Past Updates
// (older ones), 5) Team (collapsible). Everything else lives elsewhere: Site
// Board + member-shared Permits moved to the second page (/portal/more, linked
// prominently below the boxes AND in the nav); permission-gated work sections,
// Messages and Shared with me are unchanged nav destinations. Old /portal/team
// and /portal/progress deep links land here.
function HomeView() {
  const { data: ctx } = useGetPortalContext();
  const { data: board } = useGetPortalSiteBoard();
  // Site updates are time-sensitive → poll while visible.
  const { data: overview, isLoading } = useGetPortalOverview({ query: { refetchInterval: PORTAL_LIVE_REFETCH, queryKey: getGetPortalOverviewQueryKey() } });
  const [teamOpen, setTeamOpen] = useState(false);
  const [pastOpen, setPastOpen] = useState(false);
  if (isLoading && !ctx) return <Loading />;
  const project = ctx?.project;
  const sm = board?.siteManager;
  const notes = overview?.recentNotes ?? [];
  const latest = notes[0];
  const past = notes.slice(1);
  const dates = project?.startDate || project?.targetEndDate
    ? [project?.startDate ? fmtDate(project.startDate) : "TBC", project?.targetEndDate ? fmtDate(project.targetEndDate) : "TBC"].join(" – ")
    : null;
  return (
    <div className="space-y-6">
      {/* Box 1 — Project info */}
      <Card>
        <h2 className="text-lg font-display font-bold truncate">{project?.name}</h2>
        {project?.address && (
          <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
            <MapPin className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{project.address}</span>
          </p>
        )}
        {dates && (
          <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
            <Calendar className="w-3.5 h-3.5 shrink-0" /><span>{dates}</span>
          </p>
        )}
        {typeof project?.progressPercent === "number" && (
          <div className="flex items-center gap-2 mt-3">
            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500" style={{ width: `${project.progressPercent}%` }} />
            </div>
            <span className="text-sm font-bold">{project.progressPercent}%</span>
          </div>
        )}
      </Card>

      {/* Box 2 — Site manager */}
      {sm && (
        <Card>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Site manager</p>
          <p className="font-medium truncate mt-1">{sm.name}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 min-w-0">
            {sm.phone && <a href={`tel:${sm.phone}`} className="inline-flex items-center gap-1 text-xs text-primary font-medium"><Phone className="w-3 h-3" /> {sm.phone}</a>}
            {sm.email && <a href={`mailto:${sm.email}`} className="inline-flex items-center gap-1 text-xs text-primary font-medium min-w-0 max-w-full"><Mail className="w-3 h-3 shrink-0" /><span className="truncate">{sm.email}</span></a>}
          </div>
        </Card>
      )}

      {/* Box 3 — Site Updates (latest only) — the title lives INSIDE the card
          (like Box 2's "Site manager") so the box reads as one unit. */}
      <Card>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Site updates</p>
        {latest ? (
          <>
            <p className="text-sm whitespace-pre-wrap break-words">{latest.body}</p>
            <p className="text-xs text-muted-foreground mt-2">{latest.authorName} · {fmtDate(latest.noteDate)}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No site updates posted yet.</p>
        )}
      </Card>

      {/* Box 4 — Past Updates (collapsible, identical pattern to Team below) */}
      <div>
        <button
          onClick={() => setPastOpen(o => !o)}
          aria-expanded={pastOpen}
          className="w-full flex items-center justify-between gap-3 bg-card border rounded-xl px-4 py-3 hover:bg-muted/50 transition-colors"
        >
          <span className="flex items-center gap-2 font-display font-bold"><StickyNote className="w-5 h-5 text-primary" /> Past updates</span>
          <ChevronDown className={cn("w-5 h-5 text-muted-foreground transition-transform", pastOpen && "rotate-180")} />
        </button>
        {pastOpen && (
          <div className="mt-3">
            {past.length === 0 ? <Empty>No earlier updates yet.</Empty> : (
              <div className="space-y-3">{past.map(n => <UpdateCard key={n.id} n={n} />)}</div>
            )}
          </div>
        )}
      </div>

      {/* Box 5 — Team (collapsible, collapsed by default = glanceable home) */}
      <div>
        <button
          onClick={() => setTeamOpen(o => !o)}
          aria-expanded={teamOpen}
          className="w-full flex items-center justify-between gap-3 bg-card border rounded-xl px-4 py-3 hover:bg-muted/50 transition-colors"
        >
          <span className="flex items-center gap-2 font-display font-bold"><Users className="w-5 h-5 text-primary" /> Team</span>
          <ChevronDown className={cn("w-5 h-5 text-muted-foreground transition-transform", teamOpen && "rotate-180")} />
        </button>
        {teamOpen && <div className="mt-3"><TeamView /></div>}
      </div>

      {/* Site Board + Permits are reachable from the workspace menu only —
          removed from Home to keep page 1 to the five glanceable boxes. */}
    </div>
  );
}

// Permits page (workspace menu) — the permits shared with THIS member. Comes
// from GET /api/portal/permits, which is server-gated to what has been shared
// with the member (visibleIds), same mechanism as "Shared with me". NOTE:
// navigation only — the PUBLIC QR board (/site/:token, no login) is a
// separate route and untouched.
function PermitsView() {
  const { data: permits, isLoading } = useGetPortalPermits({ query: { queryKey: getGetPortalPermitsQueryKey() } });
  if (isLoading) return <Loading />;
  if (!permits || permits.length === 0) return <Empty>No permits have been shared with you yet.</Empty>;
  return <Card>{permits.map((p: any) => <PermitRow key={p.id} p={p} />)}</Card>;
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
      toast({ title: "Saved as draft", description: "Submit it when you're ready — your PM won't see it until then." });
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
          <div className="mt-1 flex items-start gap-2">
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="What's the issue?" className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            <DictationButton transcribeUrl="/api/portal/transcribe" onTranscript={t => setDescription(d => (d.trim() ? d.trimEnd() + " " : "") + t)} />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Zone / location</label>
          <div className="mt-1 flex items-center gap-2">
            <input value={zone} onChange={e => setZone(e.target.value)} placeholder="e.g. Level 2, East wing" className="flex-1 min-h-12 rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            <DictationButton transcribeUrl="/api/portal/transcribe" onTranscript={t => setZone(z => (z.trim() ? z.trimEnd() + " " : "") + t)} />
          </div>
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

// Edit panel for a reporter's own DRAFT issue — full edit of type/description/
// zone while un-submitted. Locked out server-side once submitted.
function IssueDraftEditPanel({ issue, onDone }: { issue: { id: string; category: string; description?: string; zone?: string }; onDone: () => void }) {
  const { toast } = useToast();
  const edit = useEditPortalSiteIssueDraft();
  const [type, setType] = useState<"snag" | "safety_concern" | "work_completed">((issue.category as "snag" | "safety_concern" | "work_completed") ?? "snag");
  const [description, setDescription] = useState(issue.description ?? "");
  const [zone, setZone] = useState(issue.zone ?? "");

  const save = async () => {
    try {
      await edit.mutateAsync({ issueId: issue.id, data: { type, description: description || undefined, zone: zone || undefined } });
      toast({ title: "Draft updated" });
      onDone();
    } catch {
      toast({ title: "Couldn't update draft", variant: "destructive" });
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-border/60 space-y-3">
      <div>
        <label className="text-xs font-medium text-muted-foreground">Type</label>
        <select value={type} onChange={e => setType(e.target.value as typeof type)} className="mt-1 w-full min-h-11 rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
          <option value="snag">Snag</option>
          <option value="safety_concern">Safety Concern</option>
          <option value="work_completed">Work Completed</option>
        </select>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground">Description</label>
        <div className="mt-1 flex items-start gap-2">
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          <DictationButton transcribeUrl="/api/portal/transcribe" onTranscript={t => setDescription(d => (d.trim() ? d.trimEnd() + " " : "") + t)} />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground">Zone / location</label>
        <div className="mt-1 flex items-center gap-2">
          <input value={zone} onChange={e => setZone(e.target.value)} className="flex-1 min-h-11 rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          <DictationButton transcribeUrl="/api/portal/transcribe" onTranscript={t => setZone(z => (z.trim() ? z.trimEnd() + " " : "") + t)} />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={save} disabled={edit.isPending} className="flex-1 min-h-11 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {edit.isPending ? "Saving…" : "Save draft"}
        </button>
        <button onClick={onDone} className="min-h-11 px-4 rounded-xl border text-sm font-medium hover:bg-muted">Cancel</button>
      </div>
    </div>
  );
}

function SiteIssuesView() {
  const openOnly = new URLSearchParams(useSearch()).get("status") === "open";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: ctx } = useGetPortalContext();
  const selfUserId = ctx?.member?.userId;
  const canLogIssues = ctx?.member?.canLogIssues ?? false;
  const { data, isLoading } = useGetPortalSiteIssues({ query: { refetchInterval: PORTAL_LIVE_REFETCH, queryKey: getGetPortalSiteIssuesQueryKey() } });
  const markDone = useUpdatePortalSiteIssue();
  const submitIssue = useSubmitPortalSiteIssue();
  const addIssueNote = useAddPortalSiteIssueNote();
  const [showForm, setShowForm] = useState(false);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getGetPortalSiteIssuesQueryKey() });
  const doSubmit = async (issueId: string) => {
    try {
      await submitIssue.mutateAsync({ issueId });
      toast({ title: "Submitted to your PM", description: "The original is now locked — add updates as notes." });
      await invalidate();
    } catch {
      toast({ title: "Couldn't submit", variant: "destructive" });
    }
  };
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
        // reporterName is only serialized on issues the viewer reported themselves.
        const reportedByMe = !!issue.reporterName;
        const isDraft = issue.lifecycleStatus === "draft";
        return (
          <Card key={issue.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="font-medium">{ISSUE_TYPE_LABEL[issue.category] ?? issue.category}</span>
                  <span className="text-xs text-muted-foreground">#{issue.referenceNumber}</span>
                  {reportedByMe && <LifecycleBadge status={isDraft ? "draft" : "submitted"} submittedAt={issue.submittedAt} />}
                </div>
                {issue.description && <p className="text-sm mt-1 break-words">{issue.description}</p>}
                <p className="text-xs text-muted-foreground mt-1">
                  {issue.zone ? `${issue.zone} · ` : ""}{fmtDate(issue.takenAt)}
                  {reportedByMe ? ` · reported by you` : ""}
                </p>
              </div>
              <Badge label={(issue.status ?? "open").replace(/_/g, " ")} className={ISSUE_BADGE[issue.status ?? "open"] ?? "bg-muted text-muted-foreground"} />
            </div>
            {issue.photoUrl && (
              <img src={fileHref(issue.photoUrl)} alt="" className="mt-3 rounded-lg w-full max-h-56 object-cover" loading="lazy" />
            )}
            {reportedByMe && isDraft && (
              editingDraftId === issue.id ? (
                <IssueDraftEditPanel issue={issue} onDone={() => { setEditingDraftId(null); void invalidate(); }} />
              ) : (
                <div className="mt-3 flex gap-2">
                  <button onClick={() => doSubmit(issue.id)} disabled={submitIssue.isPending}
                    className="flex-1 min-h-11 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                    {submitIssue.isPending ? "Submitting…" : "Submit to PM"}
                  </button>
                  <button onClick={() => setEditingDraftId(issue.id)}
                    className="min-h-11 px-4 rounded-xl border text-sm font-medium hover:bg-muted">Edit draft</button>
                </div>
              )
            )}
            {reportedByMe && !isDraft && (
              <SubmissionNotesThread
                notes={issue.notes ?? []}
                adding={addIssueNote.isPending}
                onAdd={async (body) => {
                  try {
                    await addIssueNote.mutateAsync({ issueId: issue.id, data: { body } });
                    await invalidate();
                  } catch {
                    toast({ title: "Couldn't add note", variant: "destructive" });
                  }
                }}
              />
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
// `embedded` — rendered inside the Home landing page, where the project card
// and site manager contact already appear at the top, so skip them here.
function SiteBoardView({ embedded }: { embedded?: boolean }) {
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
      {/* Project (skipped when embedded — Home shows it at the top) */}
      {!embedded && (
        <Card>
          <h2 className="text-lg font-display font-bold truncate">{data.project.name}</h2>
          <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1"><MapPin className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{data.project.address}</span></p>
          <span className="inline-block mt-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-muted capitalize">{data.project.status}</span>
        </Card>
      )}

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

      {/* Site manager (skipped when embedded — Home shows the contact card up top) */}
      {!embedded && data.siteManager && (
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

// Map a document's type to its portal section so opening it from the aggregate
// "Shared with me" view still hits the per-item endpoint that logs the view +
// registers it in distribution tracking.
function docTypeSection(type?: string): string {
  if (type === "drawing") return "drawings";
  if (type === "method_statement") return "method-statements";
  if (type === "safety") return "safety";
  return "general";
}

// "Shared with me" now doubles as the home for what used to be six separate
// nav tabs (H&S/Drawings/Method Statements/Permits/Safety/General) — they were
// always just a differently-sliced view of the same shared documents/permits,
// so retiring them and adding a category filter here keeps the same browsing
// power with one less layer of nav. "H&S" is a convenience bundle (method
// statements + safety + permits together), not a real document type.
type SharedCategory = "all" | "drawings" | "hs" | "permits" | "method-statements" | "safety" | "general";
const SHARED_CATEGORIES: { key: SharedCategory; label: string }[] = [
  { key: "all", label: "All" },
  { key: "drawings", label: "Drawings" },
  { key: "hs", label: "H&S" },
  { key: "permits", label: "Permits" },
  { key: "method-statements", label: "Method Statements" },
  { key: "safety", label: "Safety" },
  { key: "general", label: "General" },
];
function docMatchesCategory(doc: any, cat: SharedCategory): boolean {
  if (cat === "all") return true;
  if (cat === "drawings") return doc.type === "drawing";
  if (cat === "method-statements") return doc.type === "method_statement";
  if (cat === "safety") return doc.type === "safety";
  if (cat === "general") return doc.type === "general";
  if (cat === "hs") return doc.type === "method_statement" || doc.type === "safety";
  return false;
}
const CATEGORY_SHOWS_PERMITS = new Set<SharedCategory>(["all", "permits", "hs"]);

function SharedView() {
  const queryClient = useQueryClient();
  const initial = new URLSearchParams(useSearch()).get("category") as SharedCategory | null;
  const [category, setCategory] = useState<SharedCategory>(
    initial && SHARED_CATEGORIES.some(c => c.key === initial) ? initial : "all",
  );
  const { data, isLoading } = useGetPortalShared({ query: { refetchInterval: PORTAL_LIVE_REFETCH, queryKey: getGetPortalSharedQueryKey() } });
  const { data: ctx } = useGetPortalContext();
  const hasPin = !!ctx?.member.hasPin;
  const signOff = useSignOffFlow({
    hasPin,
    acknowledgeUrl: id => `/api/portal/documents/${id}/acknowledge`,
    setPinUrl: "/api/portal/pin",
    onSigned: () => queryClient.invalidateQueries({ queryKey: getGetPortalSharedQueryKey() }),
    onPinSet: () => queryClient.invalidateQueries({ queryKey: getGetPortalContextQueryKey() }),
  });
  // Site notes lived on the old (now-retired) General tab alongside general
  // documents — they're project-wide announcements, not gated/shared content,
  // so they don't come back from /portal/shared. Pulled in here separately so
  // retiring that tab doesn't also remove access to the full notes history
  // (Overview only ever shows the latest 5).
  const { data: generalData } = useGetPortalGeneral({ query: { refetchInterval: PORTAL_LIVE_REFETCH, queryKey: getGetPortalGeneralQueryKey() } });
  const notes = generalData?.notes ?? [];
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
  const empty = !data || (!data.documents.length && !data.photos.length && !data.permits.length && !notes.length);
  if (empty) return <Empty>Nothing has been shared with you yet. Your project manager will share drawings, documents and updates here.</Empty>;

  const filteredDocs = data!.documents.filter(d => docMatchesCategory(d, category));
  const showPermits = CATEGORY_SHOWS_PERMITS.has(category) && data!.permits.length > 0;
  const showPhotos = category === "all" && data!.photos.length > 0;
  const showNotes = (category === "all" || category === "general") && notes.length > 0;
  const nothingInCategory = category !== "all" && filteredDocs.length === 0 && !showPermits && !(category === "general" && showNotes);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5">
        {SHARED_CATEGORIES.map(c => (
          <button
            key={c.key}
            onClick={() => setCategory(c.key)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors",
              category === c.key ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:bg-muted",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
      {filteredDocs.length > 0 && (
        <div><SectionTitle>Documents</SectionTitle><Card>{filteredDocs.map(d => <DocRow key={d.id} doc={d} section={docTypeSection(d.type)} unseen={isNew(d.id)} signOff={signOff} />)}</Card></div>
      )}
      {showPermits && (
        <div><SectionTitle>Permits</SectionTitle><Card>{data!.permits.map(p => <PermitRow key={p.id} p={p} unseen={isNew(p.id)} />)}</Card></div>
      )}
      {showPhotos && (
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
      {showNotes && (
        <div><SectionTitle>Site notes</SectionTitle><div className="space-y-3">
          {notes.map(n => (
            <Card key={n.id}>
              <p className="text-sm whitespace-pre-wrap break-words">{n.body}</p>
              <p className="text-xs text-muted-foreground mt-2">{n.authorName} · {fmtDate(n.noteDate)}</p>
            </Card>
          ))}
        </div></div>
      )}
      {nothingInCategory && <Empty>Nothing in this category yet.</Empty>}
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
  lifecycleStatus?: "draft" | "submitted";
  draft?: { status?: string | null; location?: string | null; notes?: string | null; updatedByName?: string | null; updatedAt: string } | null;
  submissionNotes?: SubmissionNoteItem[];
};

// Inline edit panel for one item — only rendered for members with the
// canUpdatePlantMaterials permission. Status/location/notes only (name/
// category/supplier/dates stay dashboard-only, per the feature's scope).
function PlantItemEditPanel({ item, onClose }: { item: PlantItemRow; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const update = useUpdatePortalPlantMaterialItem();
  // Prefill from a pending draft if one exists — reopening a draft continues
  // it rather than starting again from the live values.
  const [status, setStatus] = useState<"on_site" | "on_order" | "off_hired" | "depleted">((item.draft?.status ?? item.status) as "on_site" | "on_order" | "off_hired" | "depleted");
  const [location, setLocation] = useState(item.draft ? (item.draft.location ?? "") : (item.location ?? ""));
  const [notes, setNotes] = useState(item.draft ? (item.draft.notes ?? "") : (item.notes ?? ""));
  const [file, setFile] = useState<File | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = async () => {
    try {
      await update.mutateAsync({ itemId: item.id, data: { status, location: location || null, notes: notes || null } });
      toast({ title: "Saved as draft", description: "Submit it when you're ready — your PM won't see the change until then." });
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
        <div className="mt-1 flex items-center gap-2">
          <input value={location} onChange={e => setLocation(e.target.value)} className="flex-1 min-h-11 rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          <DictationButton transcribeUrl="/api/portal/transcribe" onTranscript={t => setLocation(l => (l.trim() ? l.trimEnd() + " " : "") + t)} />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground">Notes</label>
        <div className="mt-1 flex items-start gap-2">
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          <DictationButton transcribeUrl="/api/portal/transcribe" onTranscript={t => setNotes(n => (n.trim() ? n.trimEnd() + " " : "") + t)} />
        </div>
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

// Log a brand-new plant/material item from site — only rendered for members
// with the canUpdatePlantMaterials permission. Creation is live immediately
// (the PM is notified); the save-vs-submit draft flow applies only to edits.
function AddPlantItemForm({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<"plant_equipment" | "materials">("plant_equipment");
  const [itemStatus, setItemStatus] = useState<"on_site" | "on_order" | "off_hired" | "depleted">("on_site");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!name.trim()) { toast({ title: "Give the item a name", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/portal/plant-materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), category, status: itemStatus, location: location.trim() || null, notes: notes.trim() || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { message?: string } | null;
        throw new Error(body?.message || "");
      }
      toast({ title: "Item logged", description: "Your PM has been notified." });
      onDone();
    } catch (e) {
      toast({ title: "Couldn't log the item", description: e instanceof Error && e.message ? e.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <p className="font-medium mb-3">Log a new item</p>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Name</label>
          <div className="mt-1 flex items-center gap-2">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Excavator, Cement bags"
              className="flex-1 min-h-11 rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            <DictationButton transcribeUrl="/api/portal/transcribe" onTranscript={t => setName(n => (n.trim() ? n.trimEnd() + " " : "") + t)} />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Type</label>
          <div className="mt-1 flex gap-2">
            {([["plant_equipment", "Plant / equipment"], ["materials", "Materials"]] as const).map(([val, label]) => (
              <button key={val} type="button" onClick={() => setCategory(val)}
                className={cn("flex-1 min-h-11 rounded-xl border text-sm font-medium",
                  category === val ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:bg-muted")}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Status</label>
          <select value={itemStatus} onChange={e => setItemStatus(e.target.value as typeof itemStatus)}
            className="mt-1 w-full min-h-11 rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
            {PLANT_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Location on site</label>
          <div className="mt-1 flex items-center gap-2">
            <input value={location} onChange={e => setLocation(e.target.value)}
              className="flex-1 min-h-11 rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            <DictationButton transcribeUrl="/api/portal/transcribe" onTranscript={t => setLocation(l => (l.trim() ? l.trimEnd() + " " : "") + t)} />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Notes</label>
          <div className="mt-1 flex items-start gap-2">
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            <DictationButton transcribeUrl="/api/portal/transcribe" onTranscript={t => setNotes(n => (n.trim() ? n.trimEnd() + " " : "") + t)} />
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={create} disabled={saving}
            className="flex-1 min-h-11 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {saving ? "Logging…" : "Log item"}
          </button>
          <button onClick={onDone} className="min-h-11 px-4 rounded-xl border text-sm font-medium hover:bg-muted">Cancel</button>
        </div>
      </div>
    </Card>
  );
}

function PlantMaterialsView() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: ctx } = useGetPortalContext();
  const canEdit = ctx?.member?.canUpdatePlantMaterials ?? false;
  const { data, isLoading } = useGetPortalPlantMaterials({ query: { refetchInterval: PORTAL_LIVE_REFETCH, queryKey: getGetPortalPlantMaterialsQueryKey() } });
  const submitItem = useSubmitPortalPlantMaterialItem();
  const addItemNote = useAddPortalPlantMaterialNote();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getGetPortalPlantMaterialsQueryKey() });
  const doSubmit = async (itemId: string) => {
    try {
      await submitItem.mutateAsync({ itemId });
      toast({ title: "Submitted to your PM", description: "The item has been updated with your changes." });
      await invalidate();
    } catch {
      toast({ title: "Couldn't submit", variant: "destructive" });
    }
  };

  if (isLoading) return <Loading />;

  const items = (data ?? []) as PlantItemRow[];
  if (items.length === 0 && !canEdit) return <Empty>Nothing shared with you here yet.</Empty>;

  return (
    <div className="space-y-3">
      {canEdit && (
        adding ? (
          <AddPlantItemForm onDone={async () => { setAdding(false); await invalidate(); }} />
        ) : (
          <button onClick={() => setAdding(true)}
            className="w-full min-h-11 rounded-xl border border-dashed border-primary/50 text-sm font-semibold text-primary hover:bg-primary/5">
            + Log a new item
          </button>
        )
      )}
      {items.length === 0 && !adding && <Empty>No plant or materials logged yet — tap "Log a new item" to add the first one.</Empty>}
      {items.map(item => (
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
          {canEdit && item.draft && editingId !== item.id && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30 p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <LifecycleBadge status="draft" />
                <span className="text-xs text-muted-foreground">
                  {item.draft.updatedByName ? `by ${item.draft.updatedByName} · ` : ""}{fmtRelativeShort(item.draft.updatedAt)}
                </span>
              </div>
              <p className="text-sm break-words">
                {PLANT_STATUS_OPTIONS.find(o => o.value === item.draft?.status)?.label ?? item.draft.status}
                {item.draft.location ? ` · ${item.draft.location}` : ""}
                {item.draft.notes ? ` — ${item.draft.notes}` : ""}
              </p>
              <div className="flex gap-2">
                <button onClick={() => doSubmit(item.id)} disabled={submitItem.isPending}
                  className="flex-1 min-h-11 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  {submitItem.isPending ? "Submitting…" : "Submit to PM"}
                </button>
                <button onClick={() => setEditingId(item.id)} className="min-h-11 px-4 rounded-xl border text-sm font-medium hover:bg-muted">Edit draft</button>
              </div>
            </div>
          )}
          {canEdit && (
            editingId === item.id ? (
              <PlantItemEditPanel item={item} onClose={() => setEditingId(null)} />
            ) : !item.draft ? (
              <button onClick={() => setEditingId(item.id)} className="mt-3 text-sm font-medium text-primary hover:underline">Update</button>
            ) : null
          )}
          {canEdit && (
            <SubmissionNotesThread
              notes={item.submissionNotes ?? []}
              adding={addItemNote.isPending}
              onAdd={async (body) => {
                try {
                  await addItemNote.mutateAsync({ itemId: item.id, data: { body } });
                  await invalidate();
                } catch {
                  toast({ title: "Couldn't add note", variant: "destructive" });
                }
              }}
            />
          )}
        </Card>
      ))}
    </div>
  );
}

type DiaryFieldKey = "weather" | "labourOnSite" | "plantEquipment" | "workCompleted" | "delaysIssues" | "deliveries" | "hsNotes";
const DIARY_FIELDS: { key: DiaryFieldKey; label: string; multiline: boolean; placeholder: string }[] = [
  { key: "weather", label: "Weather", multiline: false, placeholder: "e.g. Dry, 16°C, light wind" },
  { key: "labourOnSite", label: "Labour on site", multiline: false, placeholder: "e.g. 8 (3 trades)" },
  { key: "plantEquipment", label: "Plant / equipment", multiline: false, placeholder: "e.g. Excavator, 2× dumper" },
  { key: "workCompleted", label: "Work completed", multiline: true, placeholder: "What was done on site today…" },
  { key: "delaysIssues", label: "Delays / issues", multiline: true, placeholder: "Anything holding up progress…" },
  { key: "deliveries", label: "Deliveries", multiline: true, placeholder: "Materials or plant delivered…" },
  { key: "hsNotes", label: "Health & safety / notes", multiline: true, placeholder: "Toolbox talks, incidents, observations…" },
];
type ManagerReportFields = Partial<Record<DiaryFieldKey, string>>;

function fmtReportDate(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", year: "numeric" });
}

// Daily Report — structural section (visible to every portal member, like
// Team/Progress), write-gated by canEditDailyReport AND the server's lock
// window (Feature: Daily Report in the portal). Dashboard and portal edit the
// same record via the shared upsertManagerReport backend helper.
function DailyReportView() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: today, isLoading } = useGetPortalDailyReport({ query: { refetchInterval: PORTAL_LIVE_REFETCH, queryKey: getGetPortalDailyReportQueryKey() } });
  const { data: history } = useGetPortalDailyReportHistory({ query: { queryKey: getGetPortalDailyReportHistoryQueryKey() } });
  const update = useUpdatePortalDailyReport();
  const submitReport = useSubmitPortalDailyReport();
  const addReportNote = useAddPortalDailyReportNote();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ManagerReportFields>({});
  const [showHistory, setShowHistory] = useState(false);

  // Only resync from the polled server data while NOT actively editing — the
  // 60s live refetch was silently overwriting in-progress typing/dictation
  // with the last-saved server state whenever a poll landed mid-edit (Fix:
  // dictation "not working" on the portal Daily Report — it wasn't the mic,
  // it was this effect discarding the just-dictated text on the next poll).
  useEffect(() => { if (today && !editing) setForm(today.managerReport ?? {}); }, [today, editing]);

  if (isLoading) return <Loading />;
  if (!today) return <Empty>Couldn't load today's report.</Empty>;

  const setField = (key: DiaryFieldKey, value: string) => setForm(f => ({ ...f, [key]: value }));
  const appendField = (key: DiaryFieldKey, text: string) =>
    setForm(f => ({ ...f, [key]: ((f[key] ?? "").trim() ? (f[key] ?? "").trimEnd() + " " : "") + text }));

  const save = async () => {
    try {
      await update.mutateAsync({ date: today.reportDate, data: form });
      toast({ title: "Report saved" });
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: getGetPortalDailyReportQueryKey() });
    } catch (e: any) {
      if (e?.status === 403) toast({ title: "Locked", description: "This day's report can no longer be amended from the portal.", variant: "destructive" });
      else toast({ title: "Couldn't save", variant: "destructive" });
    }
  };

  const hasContent = (mr: ManagerReportFields | null | undefined) => !!mr && DIARY_FIELDS.some(f => (mr[f.key] ?? "").trim().length > 0);
  const present = hasContent(today.managerReport);
  const isSubmitted = !!today.submittedAt;

  const doSubmitReport = async () => {
    try {
      await submitReport.mutateAsync({ date: today.reportDate });
      toast({ title: "Submitted to your PM", description: "Today's report is now locked — add updates as notes." });
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: getGetPortalDailyReportQueryKey() });
    } catch {
      toast({ title: "Couldn't submit", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between gap-2 mb-1">
          <p className="font-semibold">{fmtReportDate(today.reportDate)}</p>
          <div className="flex items-center gap-1.5">
            {present && <LifecycleBadge status={isSubmitted ? "submitted" : "draft"} submittedAt={today.submittedAt} submittedByName={today.submittedByName} />}
            {today.locked && <Badge label="Locked" className="bg-muted text-muted-foreground" />}
          </div>
        </div>
        {today.contributors.length > 0 && (
          <p className="text-xs text-muted-foreground mb-3">
            Contributors: {today.contributors.map(c => c.name).join(", ")}
          </p>
        )}

        {editing ? (
          <div className="space-y-3">
            {DIARY_FIELDS.map(f => (
              <div key={f.key}>
                <label className="text-xs font-medium text-muted-foreground">{f.label}</label>
                <div className="mt-1 flex items-start gap-2">
                  {f.multiline ? (
                    <textarea value={form[f.key] ?? ""} onChange={e => setField(f.key, e.target.value)} placeholder={f.placeholder} rows={2}
                      className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
                  ) : (
                    <input value={form[f.key] ?? ""} onChange={e => setField(f.key, e.target.value)} placeholder={f.placeholder}
                      className="flex-1 min-h-11 rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
                  )}
                  <DictationButton transcribeUrl="/api/portal/transcribe" onTranscript={t => appendField(f.key, t)} />
                </div>
              </div>
            ))}
            <div className="flex gap-2 pt-1">
              <button onClick={save} disabled={update.isPending} className="flex-1 min-h-11 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {update.isPending ? "Saving…" : "Save"}
              </button>
              <button onClick={() => { setForm(today.managerReport ?? {}); setEditing(false); }} className="min-h-11 px-4 rounded-xl border text-sm font-medium hover:bg-muted">Cancel</button>
            </div>
          </div>
        ) : present ? (
          <div className="space-y-3">
            {DIARY_FIELDS.filter(f => (today.managerReport?.[f.key] ?? "").trim()).map(f => (
              <div key={f.key}>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{f.label}</p>
                <p className="text-sm whitespace-pre-wrap break-words">{today.managerReport?.[f.key]}</p>
              </div>
            ))}
            {today.canEdit && !isSubmitted && (
              <div className="flex gap-2 pt-1">
                <button onClick={doSubmitReport} disabled={submitReport.isPending}
                  className="flex-1 min-h-11 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  {submitReport.isPending ? "Submitting…" : "Submit to PM"}
                </button>
                <button onClick={() => setEditing(true)} className="min-h-11 px-4 rounded-xl border text-sm font-medium hover:bg-muted">Edit</button>
              </div>
            )}
            {isSubmitted && (
              <SubmissionNotesThread
                notes={today.submissionNotes ?? []}
                adding={addReportNote.isPending}
                onAdd={async (body) => {
                  try {
                    await addReportNote.mutateAsync({ date: today.reportDate, data: { body } });
                    await queryClient.invalidateQueries({ queryKey: getGetPortalDailyReportQueryKey() });
                  } catch {
                    toast({ title: "Couldn't add note", variant: "destructive" });
                  }
                }}
              />
            )}
          </div>
        ) : today.canEdit ? (
          <button onClick={() => setEditing(true)} className="text-sm font-medium text-primary hover:underline">+ Add today's report</button>
        ) : (
          <p className="text-sm text-muted-foreground">No report yet for today.</p>
        )}
      </Card>

      <button onClick={() => setShowHistory(v => !v)} className="text-sm font-medium text-muted-foreground hover:text-foreground">
        {showHistory ? "Hide" : "Show"} past reports (last 14 days)
      </button>
      {showHistory && (
        (history ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No past reports on file.</p>
        ) : (
          <div className="space-y-3">
            {(history ?? []).map(h => (
              <Card key={h.reportDate}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="font-medium text-sm">{fmtReportDate(h.reportDate)}</p>
                  <Badge label="Read-only" className="bg-muted text-muted-foreground" />
                </div>
                {h.contributors.length > 0 && (
                  <p className="text-xs text-muted-foreground mb-2">Contributors: {h.contributors.map(c => c.name).join(", ")}</p>
                )}
                <div className="space-y-2">
                  {DIARY_FIELDS.filter(f => (h.managerReport?.[f.key] ?? "").trim()).map(f => (
                    <div key={f.key}>
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{f.label}</p>
                      <p className="text-sm whitespace-pre-wrap break-words">{h.managerReport?.[f.key]}</p>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )
      )}
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
      <PortalPinSection />
      <AddToHomeScreenCard />
    </div>
  );
}

// Sign-off PIN setup/reset — same password-reverification pattern as the
// dashboard's Settings PIN section (POST /api/auth/pin), just against the
// portal-scoped twin (POST /api/portal/pin). This form doubles as "forgot PIN":
// there's no separate reset flow, re-entering the account password IS the reset.
function PortalPinSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: ctx } = useGetPortalContext();
  const hasPin = !!ctx?.member.hasPin;
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const onlyDigits = (v: string) => v.replace(/\D/g, "").slice(0, 4);

  const save = async () => {
    setStatus(null);
    if (!password) { setStatus({ type: "error", text: "Enter your account password." }); return; }
    if (!/^\d{4}$/.test(pin)) { setStatus({ type: "error", text: "PIN must be exactly 4 digits." }); return; }
    if (pin !== confirmPin) { setStatus({ type: "error", text: "PINs do not match." }); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/portal/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: password, pin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setStatus({ type: "error", text: data.message ?? "Could not save your PIN." }); return; }
      setStatus({ type: "success", text: hasPin ? "Sign-off PIN updated." : "Sign-off PIN set." });
      toast({ title: hasPin ? "PIN updated" : "PIN set" });
      setPassword(""); setPin(""); setConfirmPin("");
      queryClient.invalidateQueries({ queryKey: getGetPortalContextQueryKey() });
    } catch {
      setStatus({ type: "error", text: "Network error. Please try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <SectionTitle>Sign-off PIN</SectionTitle>
      <Card>
        <p className="text-sm text-muted-foreground mb-3">
          {hasPin
            ? "Used to confirm document sign-offs. Forgotten it? Enter your account password and choose a new one below."
            : "Set a 4-digit PIN — you'll use it to sign off documents shared with you."}
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Account password</label>
            <input
              type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="Confirm it's you"
              className="mt-1 w-full min-h-11 rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">{hasPin ? "New PIN" : "Choose PIN"}</label>
              <input
                type="password" inputMode="numeric" value={pin} onChange={e => setPin(onlyDigits(e.target.value))}
                placeholder="••••"
                className="mt-1 w-full min-h-11 rounded-xl border border-border bg-background px-3 text-sm tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Confirm PIN</label>
              <input
                type="password" inputMode="numeric" value={confirmPin} onChange={e => setConfirmPin(onlyDigits(e.target.value))}
                placeholder="••••"
                className="mt-1 w-full min-h-11 rounded-xl border border-border bg-background px-3 text-sm tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
          </div>
          {status && <p className={cn("text-xs", status.type === "error" ? "text-destructive" : "text-emerald-600 dark:text-emerald-400")}>{status.text}</p>}
          <button
            onClick={() => void save()}
            disabled={saving}
            className="w-full min-h-11 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "Saving…" : hasPin ? "Update PIN" : "Set PIN"}
          </button>
        </div>
      </Card>
    </div>
  );
}

// Site Issues / Plant & Materials / Daily Report are viewable by EVERY portal
// member (read-only reopen of existing items); the per-member permission
// flags only gate the write affordances inside each view (checked there and
// again on the server's write endpoints).
function renderSection(section: string) {
  switch (section) {
    // 5-box-home redesign: Overview/Team/Progress deep links land on Home;
    // Site Board and Permits are their own workspace-menu pages again.
    case "overview":
    case "progress":
    case "team":
      return <HomeView />;
    case "site-board": return <SiteBoardView />;
    case "permits": return <PermitsView />;
    case "shared": return <SharedView />;
    case "my-documents": return <MyDocumentsView />;
    case "settings": return <SettingsView />;
    case "site-issues": return <SiteIssuesView />;
    case "plant-materials": return <PlantMaterialsView />;
    case "daily-report": return <DailyReportView />;
    case "messages": return <MessagesView />;
    default: return <Empty>Section not found.</Empty>;
  }
}

// Legacy section URLs from the old multi-tab portal: team/progress show the
// Home page. Site Board and Permits are real sections again. "more" was a
// short-lived alias for Site Board — canonicalize so nav highlighting, unseen
// counts, and the server's per-section tracking all agree on one key.
const LEGACY_HOME_SECTIONS = new Set(["team", "progress"]);

export default function PortalSectionPage() {
  const [, params] = useRoute("/portal/:section");
  const rawSection = params?.section ?? "overview";
  const section = LEGACY_HOME_SECTIONS.has(rawSection) ? "overview" : rawSection === "more" ? "site-board" : rawSection;
  const [, navigate] = useLocation();
  useEffect(() => {
    if (LEGACY_HOME_SECTIONS.has(rawSection)) navigate("/portal/overview", { replace: true });
    else if (rawSection === "more") navigate("/portal/site-board", { replace: true });
  }, [rawSection, navigate]);
  // Portal pages run on their own QueryClient (fresh-on-focus/mount + polling)
  // so a long-lived member session never shows stale content.
  return (
    <QueryClientProvider client={portalQueryClient}>
      <PortalLayout active={section}>{renderSection(section)}</PortalLayout>
    </QueryClientProvider>
  );
}
