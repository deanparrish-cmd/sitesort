import { useRoute, useSearch, Link } from "wouter";
import {
  useGetPortalOverview, useGetPortalProgress, useGetPortalTeam,
  useGetPortalSiteIssues, useGetPortalSiteBoard, useGetPortalHs,
  useGetPortalDrawings, useGetPortalMethodStatements, useGetPortalPermits,
  useGetPortalSafety, useGetPortalGeneral, useGetPortalShared,
} from "@workspace/api-client-react";
import { QRCodeSVG } from "qrcode.react";
import { PortalLayout } from "./layout";
import { Spinner } from "@/components/ui/spinner";
import { LinkRow } from "@/components/ui/link-row";
import {
  ExternalLink, MapPin, Calendar, CheckCircle2, Circle, Phone, Mail,
  FileText, AlertTriangle, StickyNote, Download, TrendingUp, FileCheck, Users,
  QrCode, Copy, Building2, ShieldCheck, X,
} from "lucide-react";
import { isCadFile, cadBadgeLabel, downloadFile } from "@/lib/documents";

// ---------- shared helpers ----------

// New uploads are served at /api/uploads; legacy rows may still say /uploads.
function fileHref(url?: string | null): string | undefined {
  if (!url) return undefined;
  return url.startsWith("/uploads/") ? `/api${url}` : url;
}

// Open/download a document AND record the specific item view (drawings + method
// statements have a per-item endpoint that logs itemId server-side; the fetch is
// what registers the view/download in the activity log). CAD files download since
// the browser can't render them; PDFs/images open in a new tab. Fire-and-forget.
function viewDoc(doc: { id: string; fileUrl?: string | null; name?: string | null }, section: string, logItem: boolean) {
  if (logItem) void fetch(`/api/portal/${section}/${doc.id}`).catch(() => {});
  if (!doc.fileUrl) return;
  if (isCadFile(doc.fileUrl, doc.name)) downloadFile(doc.fileUrl, doc.name);
  else { const href = fileHref(doc.fileUrl); if (href) window.open(href, "_blank", "noopener"); }
}

function fmtDate(d?: string | null): string {
  if (!d) return "—";
  const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
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
  open: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
  in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  resolved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
};
function Badge({ label, className }: { label: string; className?: string }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${className ?? "bg-muted text-muted-foreground"}`}>{label}</span>;
}

// A row for a document (drawing / method statement / safety / general doc).
function DocRow({ doc, section }: { doc: any; section: string }) {
  const clickable = section === "drawings" || section === "method-statements";
  const cad = cadBadgeLabel(doc.fileUrl, doc.name);
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-border/60 last:border-0">
      <div className="min-w-0">
        <p className="font-medium truncate flex items-center gap-1.5">
          <span className="truncate">{doc.name}</span>
          {doc.status === "superseded" && (
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 px-1.5 py-0.5 rounded">Superseded</span>
          )}
        </p>
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <span>{doc.revision ? `Rev ${doc.revision}` : `v${doc.version}`} · {fmtDate(doc.createdAt)}</span>
          {cad && <span className="font-mono bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 px-1.5 py-0.5 rounded text-[10px] font-bold">{cad}</span>}
        </p>
      </div>
      <button
        onClick={() => viewDoc(doc, section, clickable)}
        className="shrink-0 flex items-center gap-1 text-sm text-primary font-medium hover:underline"
      >
        {cad ? <><Download className="w-3.5 h-3.5" /> Download</> : <><ExternalLink className="w-3.5 h-3.5" /> View</>}
      </button>
    </div>
  );
}
function PermitRow({ p }: { p: any }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-border/60 last:border-0">
      <div className="min-w-0">
        <p className="font-medium truncate">{p.type}</p>
        <p className="text-xs text-muted-foreground truncate">{p.description} · expires {fmtDate(p.expiryDate)}</p>
      </div>
      <Badge label={p.status === "expiring_soon" ? "Expiring" : p.status === "expired" ? "Expired" : "Active"} className={PERMIT_BADGE[p.status]} />
    </div>
  );
}

// ---------- section views ----------

function OverviewView() {
  const { data, isLoading } = useGetPortalOverview();
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
          </div>
        </Card>
      ))}
    </div>
  );
}

function SiteIssuesView() {
  const openOnly = new URLSearchParams(useSearch()).get("status") === "open";
  const { data, isLoading } = useGetPortalSiteIssues();
  if (isLoading) return <Loading />;
  if (!data || data.length === 0) return <Empty>Nothing shared with you here yet.</Empty>;
  const issues = openOnly ? data.filter(i => (i.status ?? "open") !== "resolved") : data;
  return (
    <div className="space-y-3">
      {openOnly && <FilterChip label="Open issues only" clearHref="/portal/site-issues" />}
      {issues.length === 0 ? <Empty>No open issues right now.</Empty> : issues.map(issue => (
        <Card key={issue.id}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                <span className="font-medium">{issue.category === "safety_concern" ? "Safety concern" : "Snag"}</span>
                <span className="text-xs text-muted-foreground">#{issue.referenceNumber}</span>
              </div>
              {issue.description && <p className="text-sm mt-1 break-words">{issue.description}</p>}
              <p className="text-xs text-muted-foreground mt-1">
                {issue.zone ? `${issue.zone} · ` : ""}{fmtDate(issue.takenAt)}
              </p>
            </div>
            <Badge label={(issue.status ?? "open").replace("_", " ")} className={ISSUE_BADGE[issue.status ?? "open"]} />
          </div>
          {issue.photoUrl && (
            <img src={fileHref(issue.photoUrl)} alt="" className="mt-3 rounded-lg w-full max-h-56 object-cover" loading="lazy" />
          )}
        </Card>
      ))}
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

function DocListView({ section, hook, empty }: { section: string; hook: any; empty: string }) {
  const { data, isLoading } = hook();
  if (isLoading) return <Loading />;
  if (!data || data.length === 0) return <Empty>{empty}</Empty>;
  return <Card>{data.map((d: any) => <DocRow key={d.id} doc={d} section={section} />)}</Card>;
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
  const { data, isLoading } = useGetPortalGeneral();
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
  const { data, isLoading } = useGetPortalShared();
  if (isLoading) return <Loading />;
  const empty = !data || (!data.documents.length && !data.photos.length && !data.permits.length);
  if (empty) return <Empty>Nothing has been shared with you yet. Your project manager will share drawings, documents and updates here.</Empty>;
  return (
    <div className="space-y-5">
      {data!.documents.length > 0 && (
        <div><SectionTitle>Documents</SectionTitle><Card>{data!.documents.map(d => <DocRow key={d.id} doc={d} section={docTypeSection(d.type)} />)}</Card></div>
      )}
      {data!.permits.length > 0 && (
        <div><SectionTitle>Permits</SectionTitle><Card>{data!.permits.map(p => <PermitRow key={p.id} p={p} />)}</Card></div>
      )}
      {data!.photos.length > 0 && (
        <div><SectionTitle>Site issues</SectionTitle><div className="space-y-3">
          {data!.photos.map(issue => (
            <Card key={issue.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
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

function renderSection(section: string) {
  switch (section) {
    case "overview": return <OverviewView />;
    case "shared": return <SharedView />;
    case "progress": return <ProgressView />;
    case "team": return <TeamView />;
    case "site-issues": return <SiteIssuesView />;
    case "site-board": return <SiteBoardView />;
    case "hs": return <HsView />;
    case "drawings": return <DocListView section="drawings" hook={useGetPortalDrawings} empty="Nothing shared with you here yet." />;
    case "method-statements": return <DocListView section="method-statements" hook={useGetPortalMethodStatements} empty="Nothing shared with you here yet." />;
    case "permits": return <PermitsView />;
    case "safety": return <DocListView section="safety" hook={useGetPortalSafety} empty="No safety documents uploaded." />;
    case "general": return <GeneralView />;
    default: return <Empty>Section not found.</Empty>;
  }
}

export default function PortalSectionPage() {
  const [, params] = useRoute("/portal/:section");
  const section = params?.section ?? "overview";
  return <PortalLayout active={section}>{renderSection(section)}</PortalLayout>;
}
