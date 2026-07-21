import { useState, useEffect, useCallback } from "react";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle, Search, Camera, MapPin, CheckCircle2, Clock,
  ExternalLink, Share2, X, AlertCircle, UserCheck, Calendar, Ban,
  Archive, RefreshCw, Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";
import { ShareModal } from "@/components/share-modal";
import { OverdueBadge } from "@/components/ui/overdue-badge";
import { CloseInvalidDialog } from "@/pages/projects/detail/dialogs/close-issue-dialog";
import { ArchiveIssueDialog } from "@/pages/projects/detail/dialogs/archive-issue-dialog";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useToast } from "@/hooks/use-toast";

type Issue = {
  id: string;
  projectId: string;
  projectName: string | null;
  uploaderName: string;
  photoUrl: string | null;
  category: "snag" | "safety_concern" | "work_completed";
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
  closureReason?: string | null;
  closureNote?: string | null;
  archivedAt?: string | null;
  archivedByName?: string | null;
  archiveReason?: string | null;
};

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem("sitesort_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

const CATEGORY_LABEL: Record<string, string> = {
  snag: "Snag",
  safety_concern: "Safety Concern",
  work_completed: "Work Completed",
};

const CATEGORY_COLOUR: Record<string, string> = {
  snag: "bg-orange-50 border-orange-200 text-orange-700",
  safety_concern: "bg-red-50 border-red-200 text-red-700",
  work_completed: "bg-teal-50 border-teal-200 text-teal-700",
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  new:                  { label: "New — awaiting triage", cls: "bg-violet-50 border-violet-200 text-violet-700" },
  open:                 { label: "Open",                  cls: "bg-amber-50 border-amber-200 text-amber-700" },
  in_progress:          { label: "In Progress",            cls: "bg-blue-50 border-blue-200 text-blue-700" },
  pending_confirmation: { label: "Pending confirmation",   cls: "bg-cyan-50 border-cyan-200 text-cyan-700" },
  resolved:             { label: "Resolved",               cls: "bg-emerald-50 border-emerald-200 text-emerald-700" },
};

export default function IssuesPage() {
  const caps = useCapabilities();
  const { toast } = useToast();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<"all" | "snag" | "safety_concern" | "work_completed">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "new" | "open" | "in_progress" | "pending_confirmation" | "resolved">("all");
  const [viewingIssue, setViewingIssue] = useState<Issue | null>(null);
  const [shareItem, setShareItem] = useState<{ id: string; name: string; fileUrl: string; projectId?: string | null; additionalInfo?: string } | null>(null);
  const [closingIssueId, setClosingIssueId] = useState<string | null>(null);
  const [archivingIssueId, setArchivingIssueId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  function issueDetails(i: Issue) {
    const lines = [
      `Type: ${CATEGORY_LABEL[i.category] ?? i.category}`,
      `Ref: ${i.referenceNumber}`,
      i.description ? `Description: ${i.description}` : null,
      i.zone ? `Zone: ${i.zone}` : null,
      i.projectName ? `Project: ${i.projectName}` : null,
      `Status: ${STATUS_BADGE[i.status ?? "open"]?.label ?? i.status ?? "Open"}`,
      `Logged: ${new Date(i.takenAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} by ${i.uploaderName}`,
      i.latitude && i.longitude ? `GPS: ${Number(i.latitude).toFixed(5)}, ${Number(i.longitude).toFixed(5)}` : null,
    ].filter(Boolean);
    return lines.join("\n");
  }

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/issues${showArchived ? "?archived=true" : ""}`, { headers: authHeaders() });
    if (res.ok) setIssues(await res.json());
    setLoading(false);
  }, [showArchived]);

  useEffect(() => { load(); }, [load]);

  // Apply deep-link filters carried in the URL (shareable, e.g. /issues?status=open).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    const type = params.get("type");
    const q = params.get("q");
    if (status && ["all", "new", "open", "in_progress", "pending_confirmation", "resolved"].includes(status)) setStatusFilter(status as typeof statusFilter);
    if (type && ["all", "snag", "safety_concern", "work_completed"].includes(type)) setCatFilter(type as typeof catFilter);
    if (q) setSearch(q);
    if (status || type || q) window.history.replaceState({}, "", "/issues");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patchIssue = async (issueId: string, patch: Record<string, unknown>, errTitle = "Couldn't update issue") => {
    const res = await fetch(`/api/photos/${issueId}`, {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      toast({ title: errTitle, description: body?.message, variant: "destructive" });
      return;
    }
    const updated: Issue = await res.json();
    setIssues(prev => prev.map(i => i.id === issueId ? updated : i));
    setViewingIssue(prev => prev?.id === issueId ? updated : prev);
  };

  const updateStatus = (issueId: string, status: string) => patchIssue(issueId, { status }, "Couldn't update status");

  const archiveIssue = async (issueId: string, reason?: string) => {
    const res = await fetch(`/api/photos/${issueId}`, {
      method: "DELETE",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      toast({ title: "Couldn't archive issue", description: body?.message, variant: "destructive" });
      return;
    }
    setIssues(prev => prev.filter(i => i.id !== issueId));
    setViewingIssue(prev => (prev?.id === issueId ? null : prev));
    toast({ title: "Issue archived", description: "Find it under the Archived filter." });
  };

  const restoreIssue = async (issueId: string) => {
    const res = await fetch(`/api/photos/${issueId}/restore`, { method: "PATCH", headers: authHeaders() });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      toast({ title: "Couldn't restore issue", description: body?.message, variant: "destructive" });
      return;
    }
    setIssues(prev => prev.filter(i => i.id !== issueId));
    setViewingIssue(prev => (prev?.id === issueId ? null : prev));
    toast({ title: "Issue restored" });
  };

  const removeIssuePhoto = async (issueId: string) => {
    if (!confirm("Remove the photo from this issue? The issue itself is kept.")) return;
    const res = await fetch(`/api/photos/${issueId}/photo`, { method: "DELETE", headers: authHeaders() });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      toast({ title: "Couldn't remove photo", description: body?.message, variant: "destructive" });
      return;
    }
    const updated: Issue = await res.json();
    setIssues(prev => prev.map(i => (i.id === issueId ? updated : i)));
    setViewingIssue(prev => (prev?.id === issueId ? updated : prev));
    toast({ title: "Photo removed" });
  };
  const confirmIssueDone = (issueId: string) => patchIssue(issueId, { status: "resolved" }, "Couldn't confirm issue");
  const closeIssueAsInvalid = (issueId: string, reason: "invalid" | "duplicate", note: string) =>
    patchIssue(issueId, { status: "resolved", closureReason: reason, closureNote: note }, "Couldn't close issue");

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

  const newCount = issues.filter(i => i.status === "new").length;
  const openCount = issues.filter(i => !i.status || i.status === "open").length;
  const inProgressCount = issues.filter(i => i.status === "in_progress").length;
  const pendingConfirmationCount = issues.filter(i => i.status === "pending_confirmation").length;
  const resolvedCount = issues.filter(i => i.status === "resolved").length;

  return (
    <SidebarLayout>
      <PageHeader
        className="mb-8"
        icon={<AlertTriangle className="w-7 h-7 text-amber-500" />}
        title="Site Issues"
        description="All snags and safety concerns logged across your projects."
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <Card className="p-4 border-violet-200 bg-violet-50 dark:bg-violet-950/20 dark:border-violet-900">
          <p className="text-xs font-medium text-violet-700 mb-1">New</p>
          <p className="text-2xl font-extrabold text-violet-700">{newCount}</p>
        </Card>
        <Card className="p-4 border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900">
          <p className="text-xs font-medium text-amber-700 mb-1">Open</p>
          <p className="text-2xl font-extrabold text-amber-700">{openCount}</p>
        </Card>
        <Card className="p-4 border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-900">
          <p className="text-xs font-medium text-blue-700 mb-1">In Progress</p>
          <p className="text-2xl font-extrabold text-blue-700">{inProgressCount}</p>
        </Card>
        <Card className="p-4 border-cyan-200 bg-cyan-50 dark:bg-cyan-950/20 dark:border-cyan-900">
          <p className="text-xs font-medium text-cyan-700 mb-1">Pending confirmation</p>
          <p className="text-2xl font-extrabold text-cyan-700">{pendingConfirmationCount}</p>
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
          {(["all", "snag", "safety_concern", "work_completed"] as const).map(f => (
            <button key={f} onClick={() => setCatFilter(f)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors capitalize ${catFilter === f ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:border-primary/40"}`}>
              {f === "all" ? "All Types" : CATEGORY_LABEL[f]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {(["all", "new", "open", "in_progress", "pending_confirmation", "resolved"] as const).map(f => (
            <button key={f} onClick={() => setStatusFilter(f)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${statusFilter === f ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:border-primary/40"}`}>
              {f === "all" ? "All Statuses" : STATUS_BADGE[f]?.label ?? f}
            </button>
          ))}
          {caps.canManageProjects && (
            <button
              onClick={() => setShowArchived(v => !v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors inline-flex items-center gap-1.5 ${showArchived ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:border-primary/40"}`}
            >
              <Archive className="w-3.5 h-3.5" />Archived
            </button>
          )}
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
                    <div className="shrink-0 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      {issue.status === "pending_confirmation" ? (
                        <button
                          onClick={() => confirmIssueDone(issue.id)}
                          title="Confirm as resolved"
                          className="p-1.5 rounded-lg text-cyan-600 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                      ) : issue.status !== "resolved" ? (
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
                      {issue.status !== "resolved" && (
                        <button
                          onClick={() => setClosingIssueId(issue.id)}
                          title="Close as invalid/duplicate"
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <Ban className="w-4 h-4" />
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
                  {caps.canManageProjects && viewingIssue.status === "pending_confirmation" && (
                    <button
                      onClick={() => confirmIssueDone(viewingIssue.id)}
                      className="flex items-center gap-1.5 text-xs font-medium px-2 sm:px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /><span className="hidden sm:inline">Confirm resolved</span>
                    </button>
                  )}
                  {caps.canManageProjects && viewingIssue.status !== "resolved" && viewingIssue.status !== "pending_confirmation" && (
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
                  {caps.canManageProjects && viewingIssue.status !== "resolved" && (
                    <button
                      onClick={() => setClosingIssueId(viewingIssue.id)}
                      className="flex items-center gap-1.5 text-xs font-medium px-2 sm:px-3 py-1.5 rounded-lg border border-border bg-background text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <Ban className="w-3.5 h-3.5" /><span className="hidden sm:inline">Close invalid/duplicate</span>
                    </button>
                  )}
                  {caps.canManageProjects && !viewingIssue.archivedAt && (
                    <button
                      onClick={() => setArchivingIssueId(viewingIssue.id)}
                      className="flex items-center gap-1.5 text-xs font-medium px-2 sm:px-3 py-1.5 rounded-lg border border-border bg-background text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <Archive className="w-3.5 h-3.5" /><span className="hidden sm:inline">Archive</span>
                    </button>
                  )}
                  {caps.canManageProjects && viewingIssue.archivedAt && (
                    <button
                      onClick={() => restoreIssue(viewingIssue.id)}
                      className="flex items-center gap-1.5 text-xs font-medium px-2 sm:px-3 py-1.5 rounded-lg border bg-background hover:bg-muted transition-colors"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /><span className="hidden sm:inline">Restore</span>
                    </button>
                  )}
                  {caps.canManageProjects && photoUrl && (
                    <button
                      onClick={() => removeIssuePhoto(viewingIssue.id)}
                      className="flex items-center gap-1.5 text-xs font-medium px-2 sm:px-3 py-1.5 rounded-lg border border-border bg-background text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" /><span className="hidden sm:inline">Remove photo</span>
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
                  {viewingIssue.archivedAt && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Archived</p>
                      <p className="text-sm">{formatDate(viewingIssue.archivedAt)}{viewingIssue.archivedByName ? ` by ${viewingIssue.archivedByName}` : ""}</p>
                      {viewingIssue.archiveReason && <p className="text-xs text-muted-foreground italic mt-0.5 break-words">"{viewingIssue.archiveReason}"</p>}
                    </div>
                  )}
                  {caps.canManageProjects && (
                    <div className="pt-2 space-y-1.5">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Update Status</p>
                      {(viewingIssue.status === "new" || viewingIssue.status === "pending_confirmation") && (
                        <p className="text-xs text-muted-foreground italic">
                          {viewingIssue.status === "new" ? "Assign to trigger triage, or use the header actions above." : "Awaiting PM confirmation — use \"Confirm resolved\" above."}
                        </p>
                      )}
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
      <CloseInvalidDialog photoId={closingIssueId} onClose={() => setClosingIssueId(null)} closeIssueAsInvalid={closeIssueAsInvalid} />
      <ArchiveIssueDialog photoId={archivingIssueId} onClose={() => setArchivingIssueId(null)} archiveIssue={archiveIssue} />
    </SidebarLayout>
  );
}
