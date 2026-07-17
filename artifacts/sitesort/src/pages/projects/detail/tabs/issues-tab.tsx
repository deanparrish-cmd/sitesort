import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPin, Calendar, Upload, FileText, CheckCircle2, AlertTriangle, ShieldCheck, Eye, EyeOff, Users, Search, X, Phone, Mail, HardHat, UserCheck, Clock, Pencil, Camera, FolderOpen, ChevronDown, ChevronUp, ChevronRight, QrCode, Download, Printer, RefreshCw, ArrowDownCircle, ArrowUpCircle, Receipt, ClipboardCheck, UserPlus, ExternalLink, Share2, MessageCircle, FileDown, Plus, Trash2, Flag, Pin, PinOff, StickyNote, Send, Loader2, History, Archive, Paperclip } from "lucide-react";
import { FileDropZone } from "@/components/ui/file-drop-zone";
import { OverdueBadge } from "@/components/ui/overdue-badge";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatBytes, cn } from "@/lib/utils";
import { useDetail } from "../context";

export function IssuesTab() {
  const {
    members,
    photos,
    photoUploadUrl,
    setPhotoUploadUrl,
    photoTag,
    setPhotoTag,
    photoNote,
    setPhotoNote,
    photoZone,
    setPhotoZone,
    photoAssignee,
    setPhotoAssignee,
    photoDue,
    setPhotoDue,
    photoSubmitting,
    photoFormKey,
    setViewingPhoto,
    issueSearch,
    setIssueSearch,
    issueStatusFilter,
    setIssueStatusFilter,
    openTab,
    updatePhotoStatus,
    submitSnagPhoto,
    caps,
  } = useDetail();

  return (
    <>
        <TabsContent value="issues">
          {(() => {
            const ISSUE_CATEGORY_LABEL: Record<string, string> = { snag: "Snag", safety_concern: "Safety Concern" };
            const ISSUE_CATEGORY_COLOUR: Record<string, string> = {
              snag: "bg-orange-50 border-orange-200 text-orange-700",
              safety_concern: "bg-red-50 border-red-200 text-red-700",
            };
            const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
              open:        { label: "Open",        cls: "bg-amber-50 border-amber-200 text-amber-700" },
              in_progress: { label: "In Progress", cls: "bg-blue-50 border-blue-200 text-blue-700" },
              resolved:    { label: "Resolved",    cls: "bg-emerald-50 border-emerald-200 text-emerald-700" },
            };
            const issuePhotos = photos.filter(p => p.category === "snag" || p.category === "safety_concern");
            const openCount = issuePhotos.filter(p => !p.status || p.status === "open").length;
            const inProgressCount = issuePhotos.filter(p => p.status === "in_progress").length;
            const resolvedCount = issuePhotos.filter(p => p.status === "resolved").length;
            const overdueCount = issuePhotos.filter(p => p.overdue).length;
            const filtered = issuePhotos.filter(p => {
              const matchStatus = issueStatusFilter === "all"
                ? true
                : issueStatusFilter === "overdue"
                  ? !!p.overdue
                  : (p.status ?? "open") === issueStatusFilter;
              const matchSearch = !issueSearch || (p.description ?? "").toLowerCase().includes(issueSearch.toLowerCase()) || (p.zone ?? "").toLowerCase().includes(issueSearch.toLowerCase()) || p.referenceNumber.toLowerCase().includes(issueSearch.toLowerCase());
              return matchStatus && matchSearch;
            });
            const ISSUE_TAG_OPTIONS = [
              { value: "snag", label: "Snag" },
              { value: "safety_concern", label: "Safety Concern" },
              { value: "work_completed", label: "Work Completed" },
            ];
            const ISSUE_TAG_COLOURS: Record<string, string> = {
              snag: "bg-orange-50 border-orange-200 text-orange-700",
              safety_concern: "bg-red-50 border-red-200 text-red-700",
              work_completed: "bg-teal-50 border-teal-200 text-teal-700",
            };
            return (
              <div>
                <div className="flex items-center gap-2 mb-5">
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                  <h3 className="font-bold text-lg">Site Issues</h3>
                  <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{issuePhotos.length}</span>
                </div>
                {/* Log new issue */}
                {caps.canLogPhoto && (
                  <Card className="mb-5">
                    <CardContent className="pt-6 space-y-4">
                      <div>
                        <h4 className="font-semibold text-sm mb-1">Log a site issue</h4>
                        <p className="text-xs text-muted-foreground">Tag the issue type, attach a photo, and add a description.</p>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Type</label>
                        <div className="flex flex-wrap gap-2">
                          {ISSUE_TAG_OPTIONS.map(opt => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => setPhotoTag(opt.value)}
                              className={cn(
                                "text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors",
                                photoTag === opt.value
                                  ? (ISSUE_TAG_COLOURS[opt.value] ?? "bg-primary/10 border-primary text-primary")
                                  : "bg-background border-border text-muted-foreground hover:border-primary/40"
                              )}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <FileDropZone
                        key={photoFormKey}
                        accept=".jpg,.jpeg,.png,.webp"
                        onUploaded={f => setPhotoUploadUrl(f.url)}
                        onCleared={() => setPhotoUploadUrl(null)}
                      />
                      <div className="grid sm:grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Description (optional)</label>
                          <Textarea value={photoNote} onChange={e => setPhotoNote(e.target.value)} placeholder="What does this photo show?" rows={2} />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Zone / location (optional)</label>
                          <Input value={photoZone} onChange={e => setPhotoZone(e.target.value)} placeholder="e.g. Level 2, East wing" />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Assign to (optional)</label>
                          <select
                            value={photoAssignee}
                            onChange={e => setPhotoAssignee(e.target.value)}
                            className="flex h-11 w-full rounded-lg border-2 border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary [&>*]:min-w-0"
                          >
                            <option value="">— Unassigned —</option>
                            {((members as any[]) ?? []).filter(m => m.userId).map((m: any) => (
                              <option key={m.userId} value={m.userId}>{m.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Due by (optional)</label>
                          <Input type="date" value={photoDue} onChange={e => setPhotoDue(e.target.value)} icon={<Calendar className="w-4 h-4" />} />
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <Button onClick={submitSnagPhoto} disabled={!photoUploadUrl || photoSubmitting}>
                          {photoSubmitting ? "Logging…" : "Log issue"}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
                {/* Stats */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                  {([
                    { key: "open", count: openCount, label: "Open", cls: "border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900 text-amber-700 hover:ring-amber-300" },
                    { key: "in_progress", count: inProgressCount, label: "In Progress", cls: "border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-900 text-blue-700 hover:ring-blue-300" },
                    { key: "overdue", count: overdueCount, label: "Overdue", cls: "border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900 text-red-700 hover:ring-red-300" },
                    { key: "resolved", count: resolvedCount, label: "Resolved", cls: "border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-900 text-emerald-700 hover:ring-emerald-300" },
                  ] as const).map(s => (
                    <button
                      key={s.key}
                      type="button"
                      aria-pressed={issueStatusFilter === s.key}
                      onClick={() => { setIssueStatusFilter(s.key); openTab("issues", { issueStatus: s.key }); }}
                      className={cn(
                        "rounded-xl border p-3 text-center transition-shadow hover:ring-2 focus-visible:outline-none focus-visible:ring-2 min-h-[44px]",
                        s.cls,
                        issueStatusFilter === s.key && "ring-2 ring-offset-1",
                      )}
                    >
                      <p className="text-xl font-extrabold">{s.count}</p>
                      <p className="text-xs mt-0.5">{s.label}</p>
                    </button>
                  ))}
                </div>
                {/* Filters */}
                <div className="flex flex-col sm:flex-row gap-3 mb-5">
                  <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    <Input placeholder="Search issues…" className="pl-9" value={issueSearch} onChange={e => setIssueSearch(e.target.value)} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(["all", "open", "in_progress", "overdue", "resolved"] as const).map(f => (
                      <button key={f} onClick={() => setIssueStatusFilter(f)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${issueStatusFilter === f ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:border-primary/40"}`}>
                        {f === "all" ? "All" : f === "in_progress" ? "In Progress" : f.charAt(0).toUpperCase() + f.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                {/* List */}
                <Card className="overflow-hidden">
                  {issuePhotos.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                      <AlertTriangle className="w-10 h-10 text-muted-foreground/30 mb-3" />
                      <p className="font-semibold text-muted-foreground">No site issues logged</p>
                      <p className="text-sm text-muted-foreground/70 mt-1">Use the form above to log snags, safety concerns, and completed work.</p>
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                      <p className="font-semibold text-muted-foreground">No issues match your filters.</p>
                    </div>
                  ) : (
                    <div className="divide-y">
                      {filtered.map(issue => {
                        const photoUrl = issue.photoUrl?.replace(/^\/uploads\//, "/api/uploads/") ?? null;
                        const statusInfo = STATUS_BADGE[issue.status ?? "open"] ?? STATUS_BADGE.open;
                        return (
                          <div key={issue.id} onClick={() => setViewingPhoto(issue)} className="flex gap-4 p-4 hover:bg-muted/20 transition-colors cursor-pointer">
                            <div className="w-20 h-16 rounded-lg overflow-hidden bg-muted shrink-0">
                              {photoUrl ? (
                                <img src={photoUrl} alt={issue.description ?? issue.category} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center"><Camera className="w-5 h-5 text-muted-foreground/40" /></div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap mb-1">
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${ISSUE_CATEGORY_COLOUR[issue.category] ?? ""}`}>{ISSUE_CATEGORY_LABEL[issue.category] ?? issue.category}</span>
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${statusInfo.cls}`}>{statusInfo.label}</span>
                                {issue.overdue && <OverdueBadge />}
                                <span className="text-[10px] font-mono text-muted-foreground">{issue.referenceNumber}</span>
                              </div>
                              {issue.description && <p className="text-sm font-medium truncate">{issue.description}</p>}
                              <div className="flex items-center gap-3 mt-1 flex-wrap">
                                {issue.zone && <span className="text-xs text-muted-foreground flex items-center gap-1 truncate max-w-[120px]"><MapPin className="w-3 h-3 shrink-0" />{issue.zone}</span>}
                                {issue.assignedToName && <span className="text-xs text-muted-foreground flex items-center gap-1 truncate max-w-[140px]"><UserCheck className="w-3 h-3 shrink-0" />{issue.assignedToName}</span>}
                                {issue.dueDate && <span className={`text-xs flex items-center gap-1 whitespace-nowrap ${issue.overdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}><Calendar className="w-3 h-3 shrink-0" />Due {formatDate(issue.dueDate)}</span>}
                                <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(issue.takenAt)} · {issue.uploaderName}</span>
                              </div>
                            </div>
                            {caps.canManageProjects && (
                              <div className="shrink-0 flex items-center" onClick={e => e.stopPropagation()}>
                                {issue.status !== "resolved" ? (
                                  <button onClick={() => updatePhotoStatus(issue.id, "resolved")} title="Mark resolved" className="p-1.5 rounded-lg text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50 transition-colors">
                                    <CheckCircle2 className="w-4 h-4" />
                                  </button>
                                ) : (
                                  <button onClick={() => updatePhotoStatus(issue.id, "open")} title="Re-open" className="p-1.5 rounded-lg text-emerald-600 hover:text-muted-foreground hover:bg-muted transition-colors">
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
              </div>
            );
          })()}
        </TabsContent>
    </>
  );
}
