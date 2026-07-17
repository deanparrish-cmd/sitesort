import { Input } from "@/components/ui/input";
import { MapPin, Calendar, Upload, FileText, CheckCircle2, AlertTriangle, ShieldCheck, Eye, EyeOff, Users, Search, X, Phone, Mail, HardHat, UserCheck, Clock, Pencil, Camera, FolderOpen, ChevronDown, ChevronUp, ChevronRight, QrCode, Download, Printer, RefreshCw, ArrowDownCircle, ArrowUpCircle, Receipt, ClipboardCheck, UserPlus, ExternalLink, Share2, MessageCircle, FileDown, Plus, Trash2, Flag, Pin, PinOff, StickyNote, Send, Loader2, History, Archive, Paperclip } from "lucide-react";
import { OverdueBadge } from "@/components/ui/overdue-badge";
import { formatDate, formatBytes, cn } from "@/lib/utils";
import { useDetail } from "../context";

export function PhotoOverlay() {
  const {
    project,
    members,
    viewingPhoto,
    setViewingPhoto,
    patchPhoto,
    updatePhotoStatus,
    caps,
    setSharingDoc,
  } = useDetail();

  return (
    <>
      {/* Photo detail overlay */}
      {viewingPhoto && (() => {
        const CATEGORY_LABELS: Record<string, string> = {
          general: "General", progress: "Progress", snag: "Snag", safety_concern: "Safety Concern",
          mistake: "Mistake", work_completed: "Work Completed",
        };
        const CATEGORY_COLOURS: Record<string, string> = {
          general: "bg-blue-50 border-blue-200 text-blue-700",
          progress: "bg-emerald-50 border-emerald-200 text-emerald-700",
          snag: "bg-orange-50 border-orange-200 text-orange-700",
          safety_concern: "bg-red-50 border-red-200 text-red-700",
          mistake: "bg-rose-50 border-rose-200 text-rose-700",
          work_completed: "bg-teal-50 border-teal-200 text-teal-700",
        };
        const isIssue = viewingPhoto.category === "snag" || viewingPhoto.category === "safety_concern";
        const photoUrl = viewingPhoto.photoUrl?.replace(/^\/uploads\//, "/api/uploads/") ?? null;
        return (
          <div className="fixed inset-0 z-50 flex items-stretch justify-center">
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setViewingPhoto(null)} />
            <div className="relative z-10 flex flex-col w-full max-w-4xl m-4 bg-background rounded-2xl shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center gap-3 px-5 py-4 border-b bg-muted/30 flex-shrink-0">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded border shrink-0 ${CATEGORY_COLOURS[viewingPhoto.category] ?? "bg-muted border-border text-muted-foreground"}`}>
                    {CATEGORY_LABELS[viewingPhoto.category] ?? viewingPhoto.category}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground shrink-0">{viewingPhoto.referenceNumber}</span>
                  {viewingPhoto.status === "open" && <span className="text-xs font-bold px-2 py-0.5 rounded border bg-amber-50 border-amber-200 text-amber-700 shrink-0">Open</span>}
                  {viewingPhoto.status === "in_progress" && <span className="text-xs font-bold px-2 py-0.5 rounded border bg-blue-50 border-blue-200 text-blue-700 shrink-0">In Progress</span>}
                  {viewingPhoto.status === "resolved" && <span className="text-xs font-bold px-2 py-0.5 rounded border bg-emerald-50 border-emerald-200 text-emerald-700 shrink-0">Resolved</span>}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {isIssue && caps.canManageProjects && viewingPhoto.status !== "resolved" && (
                    <button
                      onClick={() => updatePhotoStatus(viewingPhoto.id, "resolved")}
                      className="flex items-center gap-1.5 text-xs font-medium px-2 sm:px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /><span className="hidden sm:inline">Mark resolved</span>
                    </button>
                  )}
                  {isIssue && caps.canManageProjects && viewingPhoto.status === "resolved" && (
                    <button
                      onClick={() => updatePhotoStatus(viewingPhoto.id, "open")}
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
                      onClick={() => {
                        const isIssuePhoto = viewingPhoto.category === "snag" || viewingPhoto.category === "safety_concern";
                        const STATUS_LABEL: Record<string, string> = { open: "Open", in_progress: "In Progress", resolved: "Resolved" };
                        const info = isIssuePhoto ? [
                          `Type: ${viewingPhoto.category === "snag" ? "Snag" : "Safety Concern"}`,
                          `Ref: ${viewingPhoto.referenceNumber}`,
                          viewingPhoto.description ? `Description: ${viewingPhoto.description}` : null,
                          viewingPhoto.zone ? `Zone: ${viewingPhoto.zone}` : null,
                          `Project: ${project.name}`,
                          `Status: ${STATUS_LABEL[viewingPhoto.status ?? "open"] ?? "Open"}`,
                          `Logged: ${formatDate(viewingPhoto.takenAt)} by ${viewingPhoto.uploaderName}`,
                          (viewingPhoto.latitude && viewingPhoto.longitude) ? `GPS: ${Number(viewingPhoto.latitude).toFixed(5)}, ${Number(viewingPhoto.longitude).toFixed(5)}` : null,
                        ].filter(Boolean).join("\n") : undefined;
                        setSharingDoc({ type: "photo", id: viewingPhoto.id, name: `Photo ${viewingPhoto.referenceNumber}`, version: null, fileUrl: viewingPhoto.photoUrl!, additionalInfo: info });
                      }}
                      className="flex items-center gap-1.5 text-xs font-medium px-2 sm:px-3 py-1.5 rounded-lg border bg-background hover:bg-muted transition-colors"
                    >
                      <Share2 className="w-3.5 h-3.5" /><span className="hidden sm:inline">Share</span>
                    </button>
                  )}
                  <button onClick={() => setViewingPhoto(null)} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="flex flex-col sm:flex-row flex-1 min-h-0 overflow-hidden">
                {/* Details sidebar */}
                <div className="sm:w-64 flex-shrink-0 border-b sm:border-b-0 sm:border-r p-5 overflow-y-auto space-y-4">
                  {viewingPhoto.description && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Description</p>
                      <p className="text-sm">{viewingPhoto.description}</p>
                    </div>
                  )}
                  {viewingPhoto.zone && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Zone / Location</p>
                      <p className="text-sm flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-muted-foreground" />{viewingPhoto.zone}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Logged</p>
                    <p className="text-sm">{formatDate(viewingPhoto.takenAt)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">by {viewingPhoto.uploaderName}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Project</p>
                    <p className="text-sm font-medium">{project.name}</p>
                  </div>
                  {isIssue && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-2">Assignment {viewingPhoto.overdue && <OverdueBadge />}</p>
                      {caps.canManageProjects ? (
                        <div className="space-y-2">
                          <select
                            value={viewingPhoto.assignedToUserId ?? ""}
                            onChange={e => patchPhoto(viewingPhoto.id, { assignedToUserId: e.target.value || null }, "Couldn't update assignee")}
                            className="flex h-10 w-full rounded-lg border-2 border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:border-primary"
                          >
                            <option value="">— Unassigned —</option>
                            {((members as any[]) ?? []).filter(m => m.userId).map((m: any) => (
                              <option key={m.userId} value={m.userId}>{m.name}</option>
                            ))}
                          </select>
                          <Input
                            type="date"
                            value={viewingPhoto.dueDate ?? ""}
                            onChange={e => patchPhoto(viewingPhoto.id, { dueDate: e.target.value || null }, "Couldn't update due date")}
                            icon={<Calendar className="w-4 h-4" />}
                          />
                        </div>
                      ) : (
                        <div className="text-sm space-y-1">
                          <p className="flex items-center gap-1.5"><UserCheck className="w-3.5 h-3.5 text-muted-foreground" />{viewingPhoto.assignedToName ?? "Unassigned"}</p>
                          {viewingPhoto.dueDate && (
                            <p className={cn("flex items-center gap-1.5", viewingPhoto.overdue && "text-red-600 font-semibold")}><Calendar className="w-3.5 h-3.5" />Due {formatDate(viewingPhoto.dueDate)}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {viewingPhoto.latitude != null && viewingPhoto.longitude != null && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">GPS</p>
                      <p className="text-xs font-mono text-muted-foreground">{Number(viewingPhoto.latitude).toFixed(5)}, {Number(viewingPhoto.longitude).toFixed(5)}</p>
                      <a
                        href={`https://www.google.com/maps?q=${viewingPhoto.latitude},${viewingPhoto.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline mt-0.5 inline-flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />View on map
                      </a>
                    </div>
                  )}
                  {viewingPhoto.resolvedAt && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Resolved</p>
                      <p className="text-sm">{formatDate(viewingPhoto.resolvedAt)}</p>
                    </div>
                  )}
                  {isIssue && caps.canManageProjects && (
                    <div className="pt-2 space-y-1.5">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Update Status</p>
                      {(["open", "in_progress", "resolved"] as const).map(s => (
                        <button
                          key={s}
                          onClick={() => updatePhotoStatus(viewingPhoto.id, s)}
                          className={cn(
                            "w-full text-left text-xs font-medium px-3 py-2 rounded-lg border transition-colors",
                            viewingPhoto.status === s
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
                      alt={viewingPhoto.description ?? viewingPhoto.category}
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
    </>
  );
}
