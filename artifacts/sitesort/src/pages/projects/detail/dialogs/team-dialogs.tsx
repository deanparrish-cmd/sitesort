import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MapPin, Calendar, Upload, FileText, CheckCircle2, AlertTriangle, ShieldCheck, Eye, EyeOff, Users, Search, X, Phone, Mail, HardHat, UserCheck, Clock, Pencil, Camera, FolderOpen, ChevronDown, ChevronUp, ChevronRight, QrCode, Download, Printer, RefreshCw, ArrowDownCircle, ArrowUpCircle, Receipt, ClipboardCheck, UserPlus, ExternalLink, Share2, MessageCircle, FileDown, Plus, Trash2, Flag, Pin, PinOff, StickyNote, Send, Loader2, History, Archive, Paperclip } from "lucide-react";
import { FileDropZone } from "@/components/ui/file-drop-zone";
import { openDocument, cadBadgeLabel } from "@/lib/documents";
import { formatDate, formatBytes, cn } from "@/lib/utils";
import { useDetail } from "../context";

export function TeamDialogs() {
  const {
    projectId,
    project,
    documents,
    caps,
    scheduleTarget,
    setScheduleTarget,
    scheduleError,
    setScheduleError,
    subNotesTarget,
    setSubNotesTarget,
    subNotesList,
    setSubNotesList,
    subNotesLoading,
    subNoteDraft,
    setSubNoteDraft,
    subNoteScope,
    setSubNoteScope,
    subNoteSubmitting,
    submitSubNote,
    SUB_DOC_TYPE_LABELS,
    subDocsTarget,
    setSubDocsTarget,
    subDocsList,
    setSubDocsList,
    subDocsLoading,
    subDocScope,
    setSubDocScope,
    subDocName,
    setSubDocName,
    subDocType,
    setSubDocType,
    subDocFile,
    setSubDocFile,
    subDocSubmitting,
    subDocFileZoneKey,
    submitSubDoc,
    removeTarget,
    setRemoveTarget,
    removing,
    confirmRemove,
    schedRegister,
    schedHandleSubmit,
    schedSetValue,
    schedWatch,
    DAYS,
    onScheduleSubmit,
  } = useDetail();

  return (
    <>
      <Dialog open={!!scheduleTarget} onOpenChange={v => { if (!v) { setScheduleTarget(null); setScheduleError(null); } }}>
        <DialogHeader>
          <DialogTitle>Site Schedule — {scheduleTarget?.name}</DialogTitle>
        </DialogHeader>
        {scheduleError && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">{scheduleError}</div>
        )}
        <form onSubmit={schedHandleSubmit(onScheduleSubmit)} className="space-y-5">
          <div>
            <label className="text-sm font-semibold mb-2 block">Days on Site</label>
            <div className="flex flex-wrap gap-2">
              {DAYS.map(day => {
                const checked = (schedWatch("scheduledDays") ?? []).includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => {
                      const current: string[] = schedWatch("scheduledDays") ?? [];
                      schedSetValue("scheduledDays", checked ? current.filter((d: string) => d !== day) : [...current, day]);
                    }}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-sm font-semibold border-2 transition-colors",
                      checked ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-input hover:border-primary/50"
                    )}
                  >{day}</button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 [&>*]:min-w-0">
            <div>
              <label className="text-sm font-semibold mb-1 block">Start Time</label>
              <Input type="time" {...schedRegister("siteStartTime")} icon={<Clock className="w-4 h-4" />} />
            </div>
            <div>
              <label className="text-sm font-semibold mb-1 block">End Time</label>
              <Input type="time" {...schedRegister("siteEndTime")} icon={<Clock className="w-4 h-4" />} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setScheduleTarget(null)}>Cancel</Button>
            <Button type="submit" variant="accent">Save Schedule</Button>
          </DialogFooter>
        </form>
      </Dialog>

      {/* Subcontractor Notes dialog (project context) */}
      <Dialog open={!!subNotesTarget} onOpenChange={open => { if (!open) { setSubNotesTarget(null); setSubNotesList([]); setSubNoteDraft(""); setSubNoteScope("general"); } }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <StickyNote className="w-4 h-4 text-amber-600" /> Notes & Reminders — {subNotesTarget?.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">General notes</span> appear across all projects this subcontractor is linked to. <span className="font-medium text-foreground">This project only</span> notes stay here.
          </p>

          {caps.canManageSubcontractors && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <button
                  onClick={() => setSubNoteScope("general")}
                  className={`flex-1 text-xs font-semibold py-1.5 rounded-lg border transition-colors ${subNoteScope === "general" ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-input hover:border-primary/50"}`}
                >
                  General (all projects)
                </button>
                <button
                  onClick={() => setSubNoteScope("project")}
                  className={`flex-1 text-xs font-semibold py-1.5 rounded-lg border transition-colors ${subNoteScope === "project" ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-input hover:border-primary/50"}`}
                >
                  This project only
                </button>
              </div>
              <textarea
                placeholder={subNoteScope === "general" ? "e.g. Insurance expires March 2027 — chase renewal…" : "e.g. Running 2 days behind on Block A…"}
                rows={3}
                value={subNoteDraft}
                onChange={e => setSubNoteDraft(e.target.value)}
                onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submitSubNote(); } }}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
              <div className="flex justify-end">
                <Button variant="accent" size="sm" onClick={submitSubNote} disabled={subNoteSubmitting || !subNoteDraft.trim()}>
                  {subNoteSubmitting ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</> : <><Send className="w-3.5 h-3.5 mr-1.5" />Add Note</>}
                </Button>
              </div>
            </div>
          )}

          <div className="border-t pt-3 max-h-72 overflow-y-auto -mr-1 pr-1">
            {subNotesLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : subNotesList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <StickyNote className="w-8 h-8 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">No notes yet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {subNotesList.map(n => (
                  <div key={n.id} className="rounded-lg border bg-muted/30 p-3">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-[13px] text-foreground whitespace-pre-wrap break-words flex-1 min-w-0">{n.body}</p>
                      {n.projectId ? (
                        <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary">This project</span>
                      ) : (
                        <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">General</span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />{new Date(n.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} · {n.authorName}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setSubNotesTarget(null); setSubNotesList([]); setSubNoteDraft(""); setSubNoteScope("general"); }}>Close</Button>
        </DialogFooter>
      </Dialog>

      {/* Subcontractor Documents dialog (project context) — F6 */}
      <Dialog open={!!subDocsTarget} onOpenChange={open => { if (!open) { setSubDocsTarget(null); setSubDocsList([]); setSubDocScope("project"); } }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" /> Documents — {subDocsTarget?.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">General documents</span> apply everywhere this contact is linked. <span className="font-medium text-foreground">This project only</span> documents stay here.
          </p>

          {caps.canManageSubcontractors && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <button
                  onClick={() => setSubDocScope("general")}
                  className={`flex-1 text-xs font-semibold py-1.5 rounded-lg border transition-colors ${subDocScope === "general" ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-input hover:border-primary/50"}`}
                >
                  General (everywhere)
                </button>
                <button
                  onClick={() => setSubDocScope("project")}
                  className={`flex-1 text-xs font-semibold py-1.5 rounded-lg border transition-colors ${subDocScope === "project" ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-input hover:border-primary/50"}`}
                >
                  This project only
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 [&>*]:min-w-0">
                <Input placeholder="Document name" value={subDocName} onChange={e => setSubDocName(e.target.value)} />
                <select
                  value={subDocType}
                  onChange={e => setSubDocType(e.target.value)}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {Object.entries(SUB_DOC_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <FileDropZone
                key={subDocFileZoneKey}
                onUploaded={f => setSubDocFile({ url: f.url, size: f.size })}
                onCleared={() => setSubDocFile(null)}
              />
              <div className="flex justify-end">
                <Button variant="accent" size="sm" onClick={submitSubDoc} disabled={subDocSubmitting || !subDocName.trim() || !subDocFile}>
                  {subDocSubmitting ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Uploading…</> : <>Upload</>}
                </Button>
              </div>
            </div>
          )}

          <div className="border-t pt-3 max-h-72 overflow-y-auto -mr-1 pr-1">
            {subDocsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : subDocsList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <FileText className="w-8 h-8 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">No documents yet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {subDocsList.map(d => (
                  <div key={d.id} className="rounded-lg border bg-muted/30 p-3">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-foreground truncate">{d.name}</p>
                        <p className="text-[11px] text-muted-foreground">{SUB_DOC_TYPE_LABELS[d.type] ?? d.type} · v{d.version}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {d.status === "superseded" ? (
                          <Badge variant="destructive" className="text-[9px]">SUPERSEDED</Badge>
                        ) : (
                          <Badge variant="success" className="text-[9px]">CURRENT</Badge>
                        )}
                        {d.projectId ? (
                          <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary">This project</span>
                        ) : (
                          <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">General</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />{new Date(d.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} · {d.uploaderName}
                      </p>
                      <button onClick={() => openDocument(d.fileUrl, d.name)} className="shrink-0 text-muted-foreground hover:text-primary transition-colors" title="Open document">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setSubDocsTarget(null); setSubDocsList([]); setSubDocScope("project"); }}>Close</Button>
        </DialogFooter>
      </Dialog>

      {/* Remove from project — confirmation (Phase B) */}
      <Dialog open={!!removeTarget} onOpenChange={v => { if (!v && !removing) setRemoveTarget(null); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="w-4 h-4" /> {removeTarget?.kind === "company" ? "Remove company from project" : "Remove from project"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <p className="text-sm">
            Remove <span className="font-semibold">{removeTarget?.name}</span>
            {removeTarget?.kind === "company" ? " and everyone who works for them" : ""} from this project?
          </p>
          <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
            {removeTarget?.isPortal && <li>Portal access is revoked immediately — any active session ends on their next request.</li>}
            {removeTarget?.isPortal && <li>Any pending portal invite is cancelled.</li>}
            <li>They'll disappear from team lists and share-target pickers for this project.</li>
            <li>Their past activity, document views, sign-offs and distribution records for this project are kept — shown with a "(removed from project)" note.</li>
          </ul>
          <p className="text-xs text-muted-foreground">This can be undone by adding them back to the project later.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setRemoveTarget(null)} disabled={removing}>Cancel</Button>
          <Button variant="destructive" onClick={confirmRemove} isLoading={removing}>Remove</Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
