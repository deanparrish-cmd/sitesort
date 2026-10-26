import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MapPin, Calendar, Upload, FileText, CheckCircle2, AlertTriangle, ShieldCheck, Eye, EyeOff, Users, Search, X, Phone, Mail, HardHat, UserCheck, Clock, Pencil, Camera, FolderOpen, ChevronDown, ChevronUp, ChevronRight, QrCode, Download, Printer, RefreshCw, ArrowDownCircle, ArrowUpCircle, Receipt, ClipboardCheck, UserPlus, ExternalLink, Share2, MessageCircle, FileDown, Plus, Trash2, Flag, Pin, PinOff, StickyNote, Send, Loader2, History, Archive, Paperclip } from "lucide-react";
import { FileDropZone } from "@/components/ui/file-drop-zone";
import { openDocument, cadBadgeLabel, fileExt } from "@/lib/documents";
import { formatDate, formatBytes, cn } from "@/lib/utils";
import { DocStatePill } from "@/components/doc-state";
import { useSafetyAudience, SafetyUploadNotice, emailAllLabel } from "@/components/safety-audience";
import { useDetail } from "../context";
import { docRev, type CarryRule } from "../use-project-detail";

// These types always require a PIN to sign off (mirrors the server's
// PIN_REQUIRED_DOC_TYPES; drawings joined 2026-10-23).
const PIN_ALWAYS_TYPES = new Set(["drawing", "method_statement", "permit", "safety"]);
// The file types the document viewer draws (components/document-viewer.tsx).
const VIEWER_IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic", "heif"];

export function DocumentDialogs() {
  const {
    projectId,
    project,
    uploadMutation,
    isUploadOpen,
    setIsUploadOpen,
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
    carryFrom,
    carryRules,
    carryRulesLoading,
    carryRulesFailed,
    carryUnticked,
    toggleCarryRule,
    carryNameChoice,
    setCarryNameChoice,
    carryError,
    inheritsAck,
    inheritsPin,
    onUpload,
    saveDocEdit,
  } = useDetail();
  // A safety document goes to everyone: say who, before Upload (Dean, 2026-10-26).
  const safetyAudience = useSafetyAudience(projectId, null, isUploadOpen && watchedType === "safety");

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
              // Say what this document actually does: one uploaded before its
              // type needed sign-off asks nobody to sign (2026-10-23).
              editDocModal.requiresAcknowledgment === false ? (
                <p className="text-xs text-muted-foreground flex items-start gap-1.5" data-testid="edit-doc-no-signoff">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5 text-muted-foreground" />
                  Nobody is asked to sign this one: it was uploaded before {editDocModal.type === "drawing" ? "drawings" : "this type"} needed sign-off. Its next revision will need a PIN signature from everyone it goes to.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-primary" />
                  A 4-digit PIN is always required to sign off this type of document.
                </p>
              )
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
                  <span className="block text-xs text-muted-foreground">Off by default; signers just tap a single confirmation.</span>
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
                By acknowledging you confirm: <span className="font-medium text-foreground">"I confirm I have read and understood this document."</span> Your name and the time will be recorded. No PIN is asked for this document, so it's recorded as acknowledged, not signed with a PIN.
              </p>
            )}

            {signOffNeedsPin && setPinMode && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  This is a critical document. Set a 4-digit sign-off PIN to continue; you'll use it to confirm future sign-offs.
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
                {!signOffNeedsPin ? "Confirm & acknowledge" : setPinMode ? "Set PIN & sign off" : "Sign off"}
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
                  Every sign-off of this document, with who signed, when, and whether they used their PIN. Entries can't be edited. They are removed only if that person's account or the company is deleted.
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
                    <div className={cn("w-9 h-9 rounded-full flex items-center justify-center shrink-0", entry.signedOffWithPin ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>
                      {entry.signedOffWithPin ? <ShieldCheck className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm">{entry.userName}{entry.removedFromProject && <span className="font-normal text-muted-foreground"> (removed from project)</span>}</p>
                        <Badge variant="secondary" className="text-[10px] capitalize">{entry.userRole.replace(/_/g, " ")}</Badge>
                        <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-[10px] font-bold">v{entry.documentVersion}</span>
                      </div>
                      <p className="text-xs mt-0.5">
                        <DocStatePill state={entry.signedOffWithPin ? "pin" : "acknowledged"} at={formatDate(entry.createdAt)} />
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
              <option value="method_statement">Risk Assessment &amp; Method Statement (RAMS)</option>
              <option value="permit">Permit</option>
              <option value="safety">Safety Document</option>
              <option value="programme">Construction Programme</option>
              <option value="general">General</option>
            </select>
          </div>
          {watchedType === "safety" && (
            <div className="rounded-lg border p-3 space-y-2 min-w-0 bg-muted/30">
              {safetyAudience.data ? (
                <>
                  <SafetyUploadNotice audience={safetyAudience.data} />
                  {safetyAudience.data.members > 0 && (
                    <label className="flex items-start gap-2 text-sm cursor-pointer select-none" htmlFor="upload-email-all">
                      <input id="upload-email-all" type="checkbox" {...register("emailEveryone")} className="mt-0.5 h-4 w-4 shrink-0 accent-primary" data-testid="upload-email-all" />
                      <span className="min-w-0 break-words">
                        {emailAllLabel(safetyAudience.data.members)}
                        <span className="block text-xs text-muted-foreground">The email links to the Team Portal, so they sign in to open it.</span>
                      </span>
                    </label>
                  )}
                </>
              ) : safetyAudience.failed ? (
                <p className="text-sm break-words">Safety documents go to everyone on this project. Couldn't load how many people that is: check your connection.</p>
              ) : (
                <p className="text-xs text-muted-foreground">Checking who this reaches...</p>
              )}
            </div>
          )}
          {supersedableDocs.length > 0 && (
            <div>
              <label className="text-sm font-semibold mb-1 block">Supersedes <span className="text-muted-foreground font-normal">(optional)</span></label>
              <select {...register("supersededDocumentId")} className="flex h-11 w-full rounded-lg border-2 border-input bg-background px-3 py-2 text-sm">
                <option value="">None</option>
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
              <Input {...register("revision")} placeholder="Auto: A, B, C… or set e.g. P01, C02" />
              <p className="text-xs text-muted-foreground mt-1">Leave blank to auto-assign the next letter; set it to match the drawing's title block.</p>
            </div>
          )}
          {carryFrom && watchedType !== "safety" && (carryFrom.mode === "name" || carryRules.length > 0 || carryRulesLoading || carryRulesFailed) && (
            <div className={cn("rounded-lg border p-3 space-y-2 min-w-0", carryFrom.mode === "name" ? "border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800" : "bg-muted/30")}>
              {carryFrom.mode === "name" && (
                <p className="text-sm font-medium flex items-start gap-1.5 break-words min-w-0">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                  <span className="min-w-0">A current document is already called "{carryFrom.doc.name}" ({docRev(carryFrom.doc)}). Uploading this replaces it.</span>
                </p>
              )}
              {carryRulesLoading ? (
                <p className="text-xs text-muted-foreground">Checking who {docRev(carryFrom.doc)} was shared with...</p>
              ) : carryRulesFailed ? (
                <p className="text-xs text-destructive">
                  Couldn't load who the previous revision was shared with, so this can't be uploaded yet. Check your connection and try again.
                </p>
              ) : carryRules.length > 0 && (
                <>
                  <p className="text-sm font-semibold">{docRev(carryFrom.doc)} is shared on the Team Portal with:</p>
                  <ul className="space-y-1.5">
                    {carryRules.map(r => (
                      <li key={r.id} className="flex items-start gap-2 min-w-0">
                        <input type="checkbox" id={`carry-${r.id}`} checked={!carryUnticked.has(r.id)} onChange={() => toggleCarryRule(r.id)}
                          className="w-4 h-4 mt-0.5 shrink-0 text-accent rounded border-input focus:ring-accent" />
                        <label htmlFor={`carry-${r.id}`} className="text-sm break-words min-w-0">{carryRuleLabel(r)}</label>
                      </li>
                    ))}
                  </ul>
                  {carryFrom.mode === "choice" ? (
                    <p className="text-xs text-muted-foreground">This revision goes to everyone ticked, with an alert. Untick anyone who shouldn't get it.</p>
                  ) : (
                    <fieldset className="space-y-1.5 pt-1">
                      <legend className="text-sm font-semibold mb-1">Share this revision with them?</legend>
                      <label htmlFor="carry-choice-share" className="flex items-start gap-2 text-sm">
                        <input type="radio" id="carry-choice-share" name="carry-choice" checked={carryNameChoice === "share"} onChange={() => setCarryNameChoice("share")} className="mt-0.5 shrink-0" />
                        <span>Yes, share it with the people ticked</span>
                      </label>
                      <label htmlFor="carry-choice-hold" className="flex items-start gap-2 text-sm">
                        <input type="radio" id="carry-choice-hold" name="carry-choice" checked={carryNameChoice === "hold"} onChange={() => setCarryNameChoice("hold")} className="mt-0.5 shrink-0" />
                        <span>No, don't share it yet</span>
                      </label>
                    </fieldset>
                  )}
                </>
              )}
            </div>
          )}
          <div>
            <label className="text-sm font-semibold mb-2 block">File</label>
            {/* Tell them before they choose (Dean, 2026-10-24): a PDF or image
                gets a reached-the-end record before sign-off; any other file
                only records that it was opened. Not a block. */}
            {(!!watch("requiresAcknowledgment") || PIN_ALWAYS_TYPES.has(watchedType) || inheritsAck) && (() => {
              const ext = fileExt(watch("fileUrl") || null);
              const weak = !!watch("fileUrl") && ext !== "pdf" && !VIEWER_IMAGE_EXTS.includes(ext);
              return weak ? (
                <p className="text-xs mb-2 flex items-start gap-1.5 rounded-md bg-amber-50 text-amber-900 border border-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-900 p-2" data-testid="upload-signoff-format-warning">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>This file isn't a PDF or an image, so SiteSort can only record that signers opened it, not that they reached the end. Upload it as a PDF for the stronger record.</span>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mb-2" data-testid="upload-signoff-format-note">
                  Signers must reach the end of a PDF or image before they can sign, and SiteSort records that. For Word, Excel, CAD and other files, SiteSort can only record that the file was opened.
                </p>
              );
            })()}
            <FileDropZone
              onUploaded={f => { setValue("fileUrl", f.url); setValue("fileSize", f.size); }}
              onCleared={() => { setValue("fileUrl", ""); setValue("fileSize", 0); }}
            />
          </div>
          <div className="flex items-center gap-2 p-4 bg-muted/30 border rounded-lg mt-4">
            <input type="checkbox" id="reqAck" {...register("requiresAcknowledgment")} disabled={PIN_ALWAYS_TYPES.has(watchedType) || inheritsAck} className="w-4 h-4 shrink-0 text-accent rounded border-input focus:ring-accent" />
            <label htmlFor="reqAck" className="text-sm font-medium">
              Require team members to digitally sign-off
              {PIN_ALWAYS_TYPES.has(watchedType)
                ? <span className="block text-xs text-muted-foreground font-normal">Always required for drawings, RAMS, permits and safety documents.</span>
                : inheritsAck && <span className="block text-xs text-muted-foreground font-normal">Required: the revision this replaces needed sign-off.</span>}
            </label>
          </div>
          {!!watch("requiresAcknowledgment") && (
            PIN_ALWAYS_TYPES.has(watchedType) ? (
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-primary" />
                A 4-digit PIN is always required to sign off this type of document.
              </p>
            ) : (
              <div className="flex items-start gap-2 p-4 bg-muted/30 border rounded-lg mt-2">
                <input type="checkbox" id="reqPin" {...register("requirePinSignoff")} disabled={inheritsPin} className="w-4 h-4 mt-0.5 text-accent rounded border-input focus:ring-accent" />
                <label htmlFor="reqPin" className="text-sm">
                  <span className="font-medium">Require a PIN to sign off</span>
                  <span className="block text-xs text-muted-foreground">{inheritsPin ? "Required: the revision this replaces needed a PIN." : "Off by default; signers just tap a single confirmation. Turn on for extra assurance."}</span>
                </label>
              </div>
            )
          )}
          {carryError && <p role="alert" className="text-sm text-destructive">{carryError}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setIsUploadOpen(false)}>Cancel</Button>
            <Button type="submit" variant="accent" isLoading={uploadMutation.isPending}>Upload</Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}

function carryRuleLabel(r: CarryRule): string {
  if (r.audienceType === "all") return "Everyone on the portal";
  if (r.audienceType === "trade") return `Trade: ${r.trade ?? "Unknown"}`;
  const who = `${r.personName ?? "Unknown"}${r.personCompany ? ` · ${r.personCompany}` : ""}`;
  return r.portalStatus === "invited" ? `${who} (invite pending)` : r.portalStatus === "none" ? `${who} (not on the portal)` : who;
}
