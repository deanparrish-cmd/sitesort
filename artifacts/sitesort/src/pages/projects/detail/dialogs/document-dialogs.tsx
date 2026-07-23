import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MapPin, Calendar, Upload, FileText, CheckCircle2, AlertTriangle, ShieldCheck, Eye, EyeOff, Users, Search, X, Phone, Mail, HardHat, UserCheck, Clock, Pencil, Camera, FolderOpen, ChevronDown, ChevronUp, ChevronRight, QrCode, Download, Printer, RefreshCw, ArrowDownCircle, ArrowUpCircle, Receipt, ClipboardCheck, UserPlus, ExternalLink, Share2, MessageCircle, FileDown, Plus, Trash2, Flag, Pin, PinOff, StickyNote, Send, Loader2, History, Archive, Paperclip } from "lucide-react";
import { FileDropZone } from "@/components/ui/file-drop-zone";
import { openDocument, cadBadgeLabel } from "@/lib/documents";
import { formatDate, formatBytes, cn } from "@/lib/utils";
import { useDetail } from "../context";
import { docRev } from "../use-project-detail";

// Safety-critical document types always require a PIN to sign off (mirrors the server's list).
const PIN_ALWAYS_TYPES = new Set(["method_statement", "permit", "safety"]);

export function DocumentDialogs() {
  const {
    project,
    members,
    uploadMutation,
    isUploadOpen,
    setIsUploadOpen,
    allocateDoc,
    setAllocateDoc,
    allocateSelected,
    allocateSubmitting,
    editDocModal,
    setEditDocModal,
    editDocSaving,
    editDocStatus,
    setEditDocStatus,
    editDocVersion,
    setEditDocVersion,
    editDocRevision,
    setEditDocRevision,
    revHistoryDoc,
    setRevHistoryDoc,
    revHistory,
    revHistoryLoading,
    signOffDoc,
    signOffPin,
    setSignOffPin,
    signOffSubmitting,
    signOffError,
    setPinMode,
    setSetPinMode,
    setPinPassword,
    setSetPinPassword,
    setPinValue,
    setSetPinValue,
    signOffNeedsPin,
    onlyDigits,
    auditDoc,
    setAuditDoc,
    auditEntries,
    auditLoading,
    closeSignOff,
    submitSignOff,
    register,
    handleSubmit,
    setValue,
    watch,
    watchedType,
    editDocRequirePin,
    setEditDocRequirePin,
    supersedableDocs,
    onUpload,
    toggleAllocate,
    submitAllocate,
    saveDocEdit,
  } = useDetail();

  return (
    <>
      <Dialog open={!!editDocModal} onOpenChange={v => { if (!v) setEditDocModal(null); }}>
        <DialogHeader>
          <DialogTitle>Edit Document</DialogTitle>
        </DialogHeader>
        {editDocModal && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground truncate">{editDocModal.name}</p>
            <div className="space-y-1.5">
              <label className="text-sm font-semibold block">Status</label>
              <select
                value={editDocStatus}
                onChange={e => setEditDocStatus(e.target.value)}
                className="flex h-11 w-full rounded-lg border-2 border-input bg-background px-3 py-2 text-sm"
              >
                <option value="current">Current</option>
                <option value="superseded">Superseded</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-semibold block">Version</label>
              <input
                type="number"
                min={1}
                value={editDocVersion}
                onChange={e => setEditDocVersion(parseInt(e.target.value) || 1)}
                className="flex h-11 w-full rounded-lg border-2 border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            {editDocModal.type === "drawing" && (
              <div className="space-y-1.5">
                <label className="text-sm font-semibold block">Revision</label>
                <input
                  type="text"
                  value={editDocRevision}
                  onChange={e => setEditDocRevision(e.target.value)}
                  placeholder="e.g. A, B, C, P01"
                  className="flex h-11 w-full rounded-lg border-2 border-input bg-background px-3 py-2 text-sm"
                />
                <p className="text-xs text-muted-foreground">Drawing revision shown as “Rev …”. Override to match the title block.</p>
              </div>
            )}
            {PIN_ALWAYS_TYPES.has(editDocModal.type) ? (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-primary" />
                Safety-critical document — a 4-digit PIN is always required to sign off.
              </p>
            ) : (
              <div className="flex items-start gap-2 p-4 bg-muted/30 border rounded-lg">
                <input
                  type="checkbox"
                  id="editReqPin"
                  checked={editDocRequirePin}
                  onChange={e => setEditDocRequirePin(e.target.checked)}
                  className="w-4 h-4 mt-0.5 text-accent rounded border-input focus:ring-accent"
                />
                <label htmlFor="editReqPin" className="text-sm">
                  <span className="font-medium">Require a PIN to sign off</span>
                  <span className="block text-xs text-muted-foreground">Off by default — signers just tap a single confirmation.</span>
                </label>
              </div>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEditDocModal(null)}>Cancel</Button>
              <Button variant="accent" onClick={saveDocEdit} isLoading={editDocSaving}>Save</Button>
            </DialogFooter>
          </div>
        )}
      </Dialog>

      {/* F3 — drawing revision history */}
      <Dialog open={!!revHistoryDoc} onOpenChange={v => { if (!v) setRevHistoryDoc(null); }}>
        <DialogHeader>
          <DialogTitle>Revision history</DialogTitle>
        </DialogHeader>
        {revHistoryDoc && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground truncate">{revHistoryDoc.name}</p>
            {revHistoryLoading ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading…</p>
            ) : revHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground">No revision history.</p>
            ) : (
              <div className="space-y-2">
                {revHistory.map((r, i) => (
                  <div key={r.id} className={cn("flex items-center gap-3 rounded-lg border p-3", i === 0 && r.status !== "superseded" && "border-primary/40 bg-primary/5")}>
                    <span className="font-mono text-xs font-bold bg-muted px-2 py-0.5 rounded shrink-0">{r.revision ? `Rev ${r.revision}` : `v${r.version}`}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground truncate">By {r.uploaderName} · {formatDate(r.createdAt)}</p>
                    </div>
                    {i === 0 && r.status !== "superseded"
                      ? <Badge variant="success" className="text-[10px] shrink-0">CURRENT</Badge>
                      : <Badge variant="secondary" className="text-[10px] shrink-0">Superseded</Badge>}
                    <button onClick={() => openDocument(r.fileUrl)} className="shrink-0 text-muted-foreground hover:text-foreground" title={cadBadgeLabel(r.fileUrl) ? "Download this revision" : "Open this revision"}>
                      {cadBadgeLabel(r.fileUrl) ? <Download className="w-4 h-4" /> : <ExternalLink className="w-4 h-4" />}
                    </button>
                  </div>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setRevHistoryDoc(null)}>Close</Button>
            </DialogFooter>
          </div>
        )}
      </Dialog>

      <Dialog open={!!signOffDoc} onOpenChange={v => { if (!v) closeSignOff(); }}>
        <DialogHeader>
          <DialogTitle>{signOffNeedsPin ? "Sign off with your PIN" : "Confirm sign-off"}</DialogTitle>
        </DialogHeader>
        {signOffDoc && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/40 border">
              <ClipboardCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate">{signOffDoc.name}</p>
                <p className="text-xs text-muted-foreground">
                  Signing off confirms you have read and understood this document.
                </p>
              </div>
            </div>

            {!signOffNeedsPin && (
              <p className="text-sm text-muted-foreground">
                By signing off you confirm: <span className="font-medium text-foreground">"I confirm I have read and understood this document."</span> Your name and the time will be recorded.
              </p>
            )}

            {signOffNeedsPin && setPinMode && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  This is a critical document. Set a 4-digit sign-off PIN to continue — you'll use it to confirm future sign-offs.
                </p>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold block">Account password</label>
                  <Input
                    type="password"
                    value={setPinPassword}
                    onChange={e => setSetPinPassword(e.target.value)}
                    autoComplete="current-password"
                    placeholder="Confirm it's you"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold block">Choose a 4-digit PIN</label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    value={setPinValue}
                    onChange={e => setSetPinValue(onlyDigits(e.target.value))}
                    placeholder="••••"
                  />
                </div>
              </div>
            )}

            {signOffNeedsPin && !setPinMode && (
              <div className="space-y-1.5">
                <label className="text-sm font-semibold block">Enter your 4-digit PIN</label>
                <Input
                  type="password"
                  inputMode="numeric"
                  value={signOffPin}
                  onChange={e => setSignOffPin(onlyDigits(e.target.value))}
                  onKeyDown={e => { if (e.key === "Enter") submitSignOff(); }}
                  placeholder="••••"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => { setSetPinMode(true); setSignOffPin(""); }}
                  className="text-xs text-primary hover:underline"
                >
                  Forgot your PIN? Reset it with your password
                </button>
              </div>
            )}

            {signOffError && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{signOffError}</span>
              </div>
            )}

            <DialogFooter>
              <Button variant="ghost" onClick={closeSignOff}>Cancel</Button>
              <Button variant="accent" onClick={submitSignOff} isLoading={signOffSubmitting}>
                {!signOffNeedsPin ? "Confirm & sign off" : setPinMode ? "Set PIN & sign off" : "Sign off"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </Dialog>

      <Dialog open={!!auditDoc} onOpenChange={v => { if (!v) setAuditDoc(null); }}>
        <DialogHeader>
          <DialogTitle>Sign-off audit history</DialogTitle>
        </DialogHeader>
        {auditDoc && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/40 border">
              <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate">{auditDoc.name}</p>
                <p className="text-xs text-muted-foreground">
                  A permanent, tamper-proof record of every sign-off. Entries can never be edited or deleted.
                </p>
              </div>
            </div>

            {auditLoading ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Loading history…</p>
            ) : !auditEntries || auditEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No sign-offs recorded yet for this document.</p>
            ) : (
              <div className="max-h-80 overflow-y-auto space-y-2 -mx-1 px-1">
                {auditEntries.map(entry => (
                  <div key={entry.id} className="flex items-start gap-3 p-3 rounded-lg border bg-card">
                    <div className="w-9 h-9 rounded-full bg-success/10 text-success flex items-center justify-center shrink-0">
                      <CheckCircle2 className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm">{entry.userName}{entry.removedFromProject && <span className="font-normal text-muted-foreground"> (removed from project)</span>}</p>
                        <Badge variant="secondary" className="text-[10px] capitalize">{entry.userRole.replace(/_/g, " ")}</Badge>
                        <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-[10px] font-bold">v{entry.documentVersion}</span>
                        {entry.signedOffWithPin && (
                          <Badge variant="success" className="text-[10px]"><ShieldCheck className="w-3 h-3 mr-1" /> PIN verified</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Acknowledged on {formatDate(entry.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <DialogFooter>
              <Button variant="ghost" onClick={() => setAuditDoc(null)}>Close</Button>
            </DialogFooter>
          </div>
        )}
      </Dialog>

      <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
        <DialogHeader>
          <DialogTitle>Upload Document</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onUpload)} className="space-y-4">
          <div>
            <label className="text-sm font-semibold mb-1 block">Document Name</label>
            <Input {...register("name", { required: true })} placeholder="e.g. Ground Floor Plan" />
          </div>
          <div>
            <label className="text-sm font-semibold mb-1 block">Category</label>
            <select {...register("type")} className="flex h-11 w-full rounded-lg border-2 border-input bg-background px-3 py-2 text-sm">
              <option value="drawing">Drawing</option>
              <option value="method_statement">Method Statement (RAMS)</option>
              <option value="permit">Permit</option>
              <option value="safety">Safety Document</option>
              <option value="general">General</option>
            </select>
          </div>
          {supersedableDocs.length > 0 && (
            <div>
              <label className="text-sm font-semibold mb-1 block">Supersedes <span className="text-muted-foreground font-normal">(optional)</span></label>
              <select {...register("supersededDocumentId")} className="flex h-11 w-full rounded-lg border-2 border-input bg-background px-3 py-2 text-sm">
                <option value="">— None —</option>
                {supersedableDocs.map(d => (
                  <option key={d.id} value={d.id}>{d.name} ({docRev(d)})</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">The selected document will be moved to the Superseded tab.</p>
            </div>
          )}
          {watchedType === "drawing" && (
            <div>
              <label className="text-sm font-semibold mb-1 block">Revision <span className="text-muted-foreground font-normal">(optional)</span></label>
              <Input {...register("revision")} placeholder="Auto: A, B, C… — or set e.g. P01, C02" />
              <p className="text-xs text-muted-foreground mt-1">Leave blank to auto-assign the next letter; set it to match the drawing's title block.</p>
            </div>
          )}
          <div>
            <label className="text-sm font-semibold mb-2 block">File</label>
            <FileDropZone
              onUploaded={f => { setValue("fileUrl", f.url); setValue("fileSize", f.size); }}
              onCleared={() => { setValue("fileUrl", ""); setValue("fileSize", 0); }}
            />
          </div>
          <div className="flex items-center gap-2 p-4 bg-muted/30 border rounded-lg mt-4">
            <input type="checkbox" id="reqAck" {...register("requiresAcknowledgment")} className="w-4 h-4 text-accent rounded border-input focus:ring-accent" />
            <label htmlFor="reqAck" className="text-sm font-medium">Require team members to digitally sign-off</label>
          </div>
          {!!watch("requiresAcknowledgment") && (
            PIN_ALWAYS_TYPES.has(watchedType) ? (
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-primary" />
                Safety-critical document — a 4-digit PIN is always required to sign off.
              </p>
            ) : (
              <div className="flex items-start gap-2 p-4 bg-muted/30 border rounded-lg mt-2">
                <input type="checkbox" id="reqPin" {...register("requirePinSignoff")} className="w-4 h-4 mt-0.5 text-accent rounded border-input focus:ring-accent" />
                <label htmlFor="reqPin" className="text-sm">
                  <span className="font-medium">Require a PIN to sign off</span>
                  <span className="block text-xs text-muted-foreground">Off by default — signers just tap a single confirmation. Turn on for extra assurance.</span>
                </label>
              </div>
            )
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setIsUploadOpen(false)}>Cancel</Button>
            <Button type="submit" variant="accent" isLoading={uploadMutation.isPending}>Upload</Button>
          </DialogFooter>
        </form>
      </Dialog>

      <Dialog open={!!allocateDoc} onOpenChange={v => { if (!v) setAllocateDoc(null); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Send className="w-4 h-4" /> Allocate document</DialogTitle>
          {allocateDoc && <p className="text-sm text-muted-foreground truncate mt-0.5">{allocateDoc.name}</p>}
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Select team members to allocate this document to. They'll get an email with a tracked link, and their view registers when they open it.</p>
          {(() => {
            const allocatable = ((members as any[]) ?? []).filter(m => m.userId);
            if (allocatable.length === 0) {
              return <p className="text-sm text-muted-foreground py-4 text-center">No team members with accounts to allocate to. Add people to the project team first.</p>;
            }
            return (
              <div className="max-h-72 overflow-y-auto space-y-1.5 border rounded-lg p-2">
                {allocatable.map((m: any) => (
                  <label key={m.userId} className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer">
                    <input type="checkbox" checked={allocateSelected.has(m.userId)} onChange={() => toggleAllocate(m.userId)} className="w-4 h-4 rounded border-input shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{m.name}</p>
                      <p className="text-xs text-muted-foreground truncate capitalize">{(m.role ?? "").replace("_", " ")}{m.email ? ` · ${m.email}` : ""}</p>
                    </div>
                  </label>
                ))}
              </div>
            );
          })()}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setAllocateDoc(null)}>Cancel</Button>
          <Button type="button" onClick={submitAllocate} disabled={allocateSelected.size === 0} isLoading={allocateSubmitting}>
            Allocate{allocateSelected.size > 0 ? ` (${allocateSelected.size})` : ""}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
