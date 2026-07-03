import { useRoute } from "wouter";
import {
  useGetPortalOverview, useGetPortalProgress, useGetPortalTeam,
  useGetPortalSiteIssues, useGetPortalSiteBoard, useGetPortalHs,
  useGetPortalDrawings, useGetPortalMethodStatements, useGetPortalPermits,
  useGetPortalSafety, useGetPortalGeneral,
} from "@workspace/api-client-react";
import { PortalLayout } from "./layout";
import { Spinner } from "@/components/ui/spinner";
import {
  ExternalLink, MapPin, Calendar, CheckCircle2, Circle, Phone,
  FileText, AlertTriangle, StickyNote,
} from "lucide-react";

// ---------- shared helpers ----------

// New uploads are served at /api/uploads; legacy rows may still say /uploads.
function fileHref(url?: string | null): string | undefined {
  if (!url) return undefined;
  return url.startsWith("/uploads/") ? `/api${url}` : url;
}

// Open a document AND record the specific item view (drawings + method statements
// have a per-item endpoint that logs itemId server-side). Fire-and-forget.
function logAndOpen(section: string, id: string, url?: string | null) {
  void fetch(`/api/portal/${section}/${id}`).catch(() => {});
  const href = fileHref(url);
  if (href) window.open(href, "_blank", "noopener");
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
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-border/60 last:border-0">
      <div className="min-w-0">
        <p className="font-medium truncate">{doc.name}</p>
        <p className="text-xs text-muted-foreground">
          {doc.revision ? `Rev ${doc.revision}` : `v${doc.version}`} · {fmtDate(doc.createdAt)}
        </p>
      </div>
      <button
        onClick={() => clickable ? logAndOpen(section, doc.id, doc.fileUrl) : window.open(fileHref(doc.fileUrl), "_blank", "noopener")}
        className="shrink-0 flex items-center gap-1 text-sm text-primary font-medium hover:underline"
      >
        <ExternalLink className="w-3.5 h-3.5" /> View
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
    { label: "Open issues", value: data.stats.openIssues },
    { label: "Milestones left", value: data.stats.upcomingMilestones },
    { label: "Active permits", value: data.stats.activePermits },
    { label: "Team size", value: data.stats.teamSize },
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
      <div className="grid grid-cols-2 gap-3">
        {stats.map(s => (
          <Card key={s.label} className="text-center">
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
          </Card>
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
        <Card key={i} className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold shrink-0">
            {m.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium truncate">{m.name}</p>
            <p className="text-xs text-muted-foreground capitalize">{m.role}{m.trades?.length ? ` · ${m.trades.join(", ")}` : ""}</p>
          </div>
          {m.phone && (
            <a href={`tel:${m.phone}`} className="shrink-0 text-primary p-2 rounded-lg hover:bg-muted"><Phone className="w-4 h-4" /></a>
          )}
        </Card>
      ))}
    </div>
  );
}

function SiteIssuesView() {
  const { data, isLoading } = useGetPortalSiteIssues();
  if (isLoading) return <Loading />;
  if (!data || data.length === 0) return <Empty>No site issues logged.</Empty>;
  return (
    <div className="space-y-3">
      {data.map(issue => (
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

function SiteBoardView() {
  const { data, isLoading } = useGetPortalSiteBoard();
  if (isLoading) return <Loading />;
  if (!data) return <Empty>Nothing pinned to the board.</Empty>;
  const nothing = !data.documents.length && !data.photos.length && !data.permits.length && !data.upcomingEvents.length;
  if (nothing) return <Empty>Nothing pinned to the board yet.</Empty>;
  return (
    <div className="space-y-5">
      {data.upcomingEvents.length > 0 && (
        <div>
          <SectionTitle>Upcoming events</SectionTitle>
          <Card>
            {data.upcomingEvents.map(e => (
              <div key={e.id} className="flex items-center gap-3 py-2 border-b border-border/60 last:border-0">
                <Calendar className="w-4 h-4 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium truncate">{e.title}</p>
                  <p className="text-xs text-muted-foreground">{fmtDate(e.eventDate)}{e.note ? ` · ${e.note}` : ""}</p>
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}
      {data.documents.length > 0 && (
        <div><SectionTitle>Pinned documents</SectionTitle><Card>{data.documents.map(d => <DocRow key={d.id} doc={d} section="site-board" />)}</Card></div>
      )}
      {data.permits.length > 0 && (
        <div><SectionTitle>Pinned permits</SectionTitle><Card>{data.permits.map(p => <PermitRow key={p.id} p={p} />)}</Card></div>
      )}
      {data.photos.length > 0 && (
        <div>
          <SectionTitle>Pinned photos</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            {data.photos.map(p => p.photoUrl && (
              <img key={p.id} src={fileHref(p.photoUrl)} alt="" className="rounded-lg w-full h-32 object-cover" loading="lazy" />
            ))}
          </div>
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
  const { data, isLoading } = useGetPortalPermits();
  if (isLoading) return <Loading />;
  if (!data || data.length === 0) return <Empty>No permits for this project.</Empty>;
  return <Card>{data.map(p => <PermitRow key={p.id} p={p} />)}</Card>;
}

function GeneralView() {
  const { data, isLoading } = useGetPortalGeneral();
  if (isLoading) return <Loading />;
  if (!data) return <Empty>Nothing to show yet.</Empty>;
  return (
    <div className="space-y-5">
      <div>
        <SectionTitle>General documents</SectionTitle>
        {data.documents.length === 0 ? <Empty>No general documents.</Empty> : <Card>{data.documents.map(d => <DocRow key={d.id} doc={d} section="general" />)}</Card>}
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

function renderSection(section: string) {
  switch (section) {
    case "overview": return <OverviewView />;
    case "progress": return <ProgressView />;
    case "team": return <TeamView />;
    case "site-issues": return <SiteIssuesView />;
    case "site-board": return <SiteBoardView />;
    case "hs": return <HsView />;
    case "drawings": return <DocListView section="drawings" hook={useGetPortalDrawings} empty="No drawings uploaded." />;
    case "method-statements": return <DocListView section="method-statements" hook={useGetPortalMethodStatements} empty="No method statements uploaded." />;
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
