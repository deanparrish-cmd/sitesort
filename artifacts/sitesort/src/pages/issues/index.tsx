import { useState, useEffect, useCallback } from "react";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle, Search, Camera, MapPin, CheckCircle2, Clock,
  ExternalLink, Share2, X, AlertCircle, UserCheck, Calendar,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";
import { ShareModal } from "@/components/share-modal";
import { OverdueBadge } from "@/components/ui/overdue-badge";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useToast } from "@/hooks/use-toast";

type Issue = {
  id: string;
  projectId: string;
  projectName: string | null;
  uploaderName: string;
  photoUrl: string | null;
  category: "snag" | "safety_concern";
  description: string | null;
  zone: string | null;
  referenceNumber: string;
  takenAt: string;
  status: string | null;
  resolvedAt: string | null;
  latitude?: number | null;
  longitude?: number | null;
  assignedToUserId?: string | null;
  assignedToName?: string | null;
  dueDate?: string | null;
  overdue?: boolean;
};

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem("sitesort_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

const CATEGORY_LABEL: Record<string, string> = {
  snag: "Snag",
  safety_concern: "Safety Concern",
};

const CATEGORY_COLOUR: Record<string, string> = {
  snag: "bg-orange-50 border-orange-200 text-orange-700",
  safety_concern: "bg-red-50 border-red-200 text-red-700",
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  open:        { label: "Open",        cls: "bg-amber-50 border-amber-200 text-amber-700" },
  in_progress: { label: "In Progress", cls: "bg-blue-50 border-blue-200 text-blue-700" },
  resolved:    { label: "Resolved",    cls: "bg-emerald-50 border-emerald-200 text-emerald-700" },
};

export default function IssuesPage() {
  const caps = useCapabilities();
  const { toast } = useToast();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<"all" | "snag" | "safety_concern">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "in_progress" | "resolved">("all");
  const [viewingIssue, setViewingIssue] = useState<Issue | null>(null);
  const [shareItem, setShareItem] = useState<{ id: string; name: string; fileUrl: string; projectId?: string | null; additionalInfo?: string } | null>(null);

  function issueDetails(i: Issue) {
    const STATUS_LABEL: Record<string, string> = { open: "Open", in_progress: "In Progress", resolved: "Resolved" };
    const lines = [
      `Type: ${CATEGORY_LABEL[i.category] ?? i.category}`,
      `Ref: ${i.referenceNumber}`,
      i.description ? `Description: ${i.description}` : null,
      i.zone ? `Zone: ${i.zone}` : null,
      i.projectName ? `Project: ${i.projectName}` : null,
      `Status: ${STATUS_LABEL[i.status ?? "open"] ?? i.status ?? "Open"}`,
      `Logged: ${new Date(i.takenAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} by ${i.uploaderName}`,
      i.latitude && i.longitude ? `GPS: ${Number(i.latitude).toFixed(5)}, ${Number(i.longitude).toFixed(5)}` : null,
    ].filter(Boolean);
    return lines.join("\n");
  }

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/issues", { headers: authHeaders() });
    if (res.ok) setIssues(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Apply deep-link filters carried in the URL (shareable, e.g. /issues?status=open).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    const type = params.get("type");
    const q = params.get("q");
    if (status && ["all", "open", "in_progress", "resolved"].includes(status)) setStatusFilter(status as typeof statusFilter);
    if (type && ["all", "snag", "safety_concern"].includes(type)) setCatFilter(type as typeof catFilter);
    if (q) setSearch(q);
    if (status || type || q) window.history.replaceState({}, "", "/issues");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateStatus = async (issueId: string, status: string) => {
    const res = await fetch(`/api/photos/${issueId}`, {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) { toast({ title: "Couldn't update status", variant: "destructive" }); return; }
    const updated: Issue = await res.json();
    setIssues(prev => prev.map(i => i.id === issueId ? updated : i));
    setViewingIssue(prev => prev?.id === issueId ? updated : prev);
  };

  const filtered = issues.filter(i => {
    const matchSearch = !search ||
      i.referenceNumber.toLowerCase().includes(search.toLowerCase()) ||
      (i.description ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (i.zone ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (i.projectName ?? "").toLowerCase().includes(search.toLowerCase()) ||
      i.uploaderName.toLowerCase().includes(search.toLowerCase());
    const matchCat = catFilter === "all" || i.category === catFilter;
    const matchStatus = statusFilter === "all" || (i.status ?? "open") === statusFilter;
    return matchSearch && matchCat && matchStatus;
  }).sort((a, b) => b.takenAt.localeCompare(a.takenAt));

  const openCount = issues.filter(i => !i.status || i.status === "open").length;
  const inProgressCount = issues.filter(i => i.status === "in_progress").length;
  const resolvedCount = issues.filter(i => i.status === "resolved").length;

  return (
    <SidebarLayout>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <AlertTriangle className="w-7 h-7 text-amber-500" /> Site Issues
          </h1>
          <p className="text-muted-foreground">All snags and safety concerns logged across your projects.</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <Card className="p-4 border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900">
          <p className="text-xs font-medium text-amber-700 mb-1">Open</p>
          <p className="text-2xl font-extrabold text-amber-700">{openCount}</p>
        </Card>
        <Card className="p-4 border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-900">
          <p className="text-xs font-medium text-blue-700 mb-1">In Progress</p>
          <p className="text-2xl font-extrabold text-blue-700">{inProgressCount}</p>
        </Card>
        <Card className="p-4 border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-900">
          <p className="text-xs font-medium text-emerald-700 mb-1">Resolved</p>
          <p className="text-2xl font-extrabold text-emerald-700">{resolvedCount}</p>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input placeholder="Search issues…" className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          {(["all", "snag", "safety_concern"] as const).map(f => (
            <button key={f} onClick={() => setCatFilter(f)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors capitalize ${catFilter === f ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:border-primary/40"}`}>
              {f === "all" ? "All Types" : CATEGORY_LABEL[f]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {(["all", "open", "in_progress", "resolved"] as const).map(f => (
            <button key={f} onClick={() => setStatusFilter(f)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${statusFilter === f ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:border-primary/40"}`}>
              {f === "all" ? "All Statuses" : f === "in_progress" ? "In Progress" : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="divide-y">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex gap-4 p-4 animate-pulse">
                <div className="w-20 h-16 rounded-lg bg-muted shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-muted rounded w-1/3" />
                  <div className="h-3 bg-muted rounded w-2/3" />
                  <div className="h-3 bg-muted rounded w-1/4" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <AlertCircle className="w-10 h-10 text-muted-foreground/30 mb-3" />
            <p className="font-semibold text-muted-foreground">No issues found</p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              {issues.length === 0 ? "Snags and safety concerns logged on projects will appear here." : "Try adjusting your filters."}
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {filtered.map(issue => {
              const photoUrl = issue.photoUrl?.replace(/^\/uploads\//, "/api/uploads/") ?? null;
              const statusInfo = STATUS_BADGE[issue.status ?? "open"] ?? STATUS_BADGE.open;
              return (
                <div
                  key={issue.id}
                  onClick={() => setViewingIssue(issue)}
                  className="flex gap-4 p-4 hover:bg-muted/20 transition-colors cursor-pointer"
                >
                  {/* Thumbnail */}
                  <div className="w-20 h-16 rounded-lg overflow-hidden bg-muted shrink-0">
                    {photoUrl ? (
                      <img src={photoUrl} alt={issue.description ?? issue.category} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Camera className="w-5 h-5 text-muted-foreground/40" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap mb-1">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${CATEGORY_COLOUR[issue.category] ?? ""}`}>
                        {CATEGORY_LABEL[issue.category] ?? issue.category}
                      </span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${statusInfo.cls}`}>
                        {statusInfo.label}
                      </span>
                      {issue.overdue && <OverdueBadge />}
                      <span className="text-[10px] font-mono text-muted-foreground">{issue.referenceNumber}</span>
                    </div>
                    {issue.description && <p className="text-sm font-medium truncate">{issue.description}</p>}
                    <div className="flex items-center gap-3 mt-1 flex-wrap min-w-0">
                      {issue.projectName && <span className="text-xs text-muted-foreground truncate max-w-[120px]">{issue.projectName}</span>}
                      {issue.zone && <span className="text-xs text-muted-foreground flex items-center gap-1 truncate max-w-[100px]"><MapPin className="w-3 h-3 shrink-0" />{issue.zone}</span>}
                      {issue.assignedToName && <span className="text-xs text-muted-foreground flex items-center gap-1 truncate max-w-[120px]"><UserCheck className="w-3 h-3 shrink-0" />{issue.assignedToName}</span>}
                      {issue.dueDate && <span className={`text-xs flex items-center gap-1 whitespace-nowrap ${issue.overdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}><Calendar className="w-3 h-3 shrink-0" />Due {formatDate(issue.dueDate)}</span>}
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(issue.takenAt)} · {issue.uploaderName}</span>
                    </div>
                  </div>

                  {/* Quick resolve */}
                  {caps.canManageProjects && (
                    <div className="shrink-0 flex items-center" onClick={e => e.stopPropagation()}>
                      {issue.status !== "resolved" ? (
                        <button
                          onClick={() => updateStatus(issue.id, "resolved")}
                          title="Mark resolved"
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                      ) : (
                        <button
                          onClick={() => updateStatus(issue.id, "open")}
                          title="Re-open"
                          className="p-1.5 rounded-lg text-emerald-600 hover:text-muted-foreground hover:bg-muted transition-colors"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Detail overlay */}
      {viewingIssue && (() => {
        const photoUrl = viewingIssue.photoUrl?.replace(/^\/uploads\//, "/api/uploads/") ?? null;
        const statusInfo = STATUS_BADGE[viewingIssue.status ?? "open"] ?? STATUS_BADGE.open;
        return (
          <div className="fixed inset-0 z-50 flex items-stretch justify-center">
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setViewingIssue(null)} />
            <div className="relative z-10 flex flex-col w-full max-w-4xl m-4 bg-background rounded-2xl shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center gap-3 px-5 py-4 border-b bg-muted/30 flex-shrink-0">
                <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded border shrink-0 ${CATEGORY_COLOUR[viewingIssue.category] ?? ""}`}>
                    {CATEGORY_LABEL[viewingIssue.category] ?? viewingIssue.category}
                  </span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded border shrink-0 ${statusInfo.cls}`}>{statusInfo.label}</span>
                  <span className="font-mono text-xs text-muted-foreground shrink-0">{viewingIssue.referenceNumber}</span>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {caps.canManageProjects && viewingIssue.status !== "resolved" && (
                    <button
                      onClick={() => updateStatus(viewingIssue.id, "resolved")}
                      className="flex items-center gap-1.5 text-xs font-medium px-2 sm:px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /><span className="hidden sm:inline">Mark resolved</span>
                    </button>
                  )}
                  {caps.canManageProjects && viewingIssue.status === "resolved" && (
                    <button
                      onClick={() => updateStatus(viewingIssue.id, "open")}
                      className="flex items-center gap-1.5 text-xs font-medium px-2 sm:px-3 py-1.5 rounded-lg border border-border bg-muted text-muted-foreground hover:bg-muted/70 transition-colors"
                    >
                      <Clock className="w-3.5 h-3.5" /><span className="hidden sm:inline">Re-open</span>
                    </button>
                  )}
                  {photoUrl && (
                    <button
                      onClick={() => window.open(photoUrl, "_blank", "noopener,noreferrer")}
                      className="flex items-center gap-1.5 text-xs font-medium px-2 sm:px-3 py-1.5 rounded-lg border bg-background hover:bg-muted transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /><span className="hidden sm:inline">Open</span>
                    </button>
                  )}
                  {photoUrl && (
                    <button
                      onClick={() => setShareItem({ id: viewingIssue.id, name: `${CATEGORY_LABEL[viewingIssue.category]} ${viewingIssue.referenceNumber}`, fileUrl: viewingIssue.photoUrl!, projectId: viewingIssue.projectId, additionalInfo: issueDetails(viewingIssue) })}
                      className="flex items-center gap-1.5 text-xs font-medium px-2 sm:px-3 py-1.5 rounded-lg border bg-background hover:bg-muted transition-colors"
                    >
                      <Share2 className="w-3.5 h-3.5" /><span className="hidden sm:inline">Share</span>
                    </button>
                  )}
                  <button onClick={() => setViewingIssue(null)} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="flex flex-col sm:flex-row flex-1 min-h-0 overflow-hidden">
                {/* Details */}
                <div className="sm:w-64 flex-shrink-0 border-b sm:border-b-0 sm:border-r p-5 overflow-y-auto space-y-4">
                  {viewingIssue.description && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Description</p>
                      <p className="text-sm">{viewingIssue.description}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Project</p>
                    <p className="text-sm font-medium">{viewingIssue.projectName ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-2">Assignment {viewingIssue.overdue && <OverdueBadge />}</p>
                    <p className="text-sm flex items-center gap-1.5"><UserCheck className="w-3.5 h-3.5 text-muted-foreground" />{viewingIssue.assignedToName ?? "Unassigned"}</p>
                    {viewingIssue.dueDate && (
                      <p className={cn("text-sm flex items-center gap-1.5 mt-0.5", viewingIssue.overdue && "text-red-600 font-semibold")}><Calendar className="w-3.5 h-3.5" />Due {formatDate(viewingIssue.dueDate)}</p>
                    )}
                  </div>
                  {viewingIssue.zone && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Zone / Location</p>
                      <p className="text-sm flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-muted-foreground" />{viewingIssue.zone}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Logged</p>
                    <p className="text-sm">{formatDate(viewingIssue.takenAt)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">by {viewingIssue.uploaderName}</p>
                  </div>
                  {viewingIssue.latitude != null && viewingIssue.longitude != null && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">GPS</p>
                      <p className="text-xs font-mono text-muted-foreground">{Number(viewingIssue.latitude).toFixed(5)}, {Number(viewingIssue.longitude).toFixed(5)}</p>
                      <a
                        href={`https://www.google.com/maps?q=${viewingIssue.latitude},${viewingIssue.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline mt-0.5 inline-flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />View on map
                      </a>
                    </div>
                  )}
                  {viewingIssue.resolvedAt && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Resolved</p>
                      <p className="text-sm">{formatDate(viewingIssue.resolvedAt)}</p>
                    </div>
                  )}
                  {caps.canManageProjects && (
                    <div className="pt-2 space-y-1.5">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Update Status</p>
                      {(["open", "in_progress", "resolved"] as const).map(s => (
                        <button
                          key={s}
                          onClick={() => updateStatus(viewingIssue.id, s)}
                          className={cn(
                            "w-full text-left text-xs font-medium px-3 py-2 rounded-lg border transition-colors",
                            (viewingIssue.status ?? "open") === s
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border hover:bg-muted text-muted-foreground"
                          )}
                        >
                          {s === "open" ? "Open" : s === "in_progress" ? "In Progress" : "Resolved"}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Photo */}
                <div className="flex-1 min-h-0 overflow-auto bg-muted/20 flex items-center justify-center p-4">
                  {photoUrl ? (
                    <img
                      src={photoUrl}
                      alt={viewingIssue.description ?? viewingIssue.category}
                      className="max-w-full max-h-full object-contain rounded-lg shadow-md"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <Camera className="w-12 h-12 opacity-30" />
                      <p className="text-sm">No photo attached</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <ShareModal
        open={!!shareItem}
        onClose={() => setShareItem(null)}
        entityType="photo"
        entityId={shareItem?.id ?? ""}
        entityName={shareItem?.name ?? ""}
        fileUrl={shareItem?.fileUrl}
        projectId={shareItem?.projectId}
        additionalInfo={shareItem?.additionalInfo}
      />
    </SidebarLayout>
  );
}
