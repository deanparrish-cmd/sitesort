import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { MapPin, Calendar, Upload, FileText, CheckCircle2, AlertTriangle, ShieldCheck, Eye, EyeOff, Users, Search, X, Phone, Mail, HardHat, UserCheck, Clock, Pencil, Camera, FolderOpen, ChevronDown, ChevronUp, ChevronRight, QrCode, Download, Printer, RefreshCw, ArrowDownCircle, ArrowUpCircle, Receipt, ClipboardCheck, UserPlus, ExternalLink, Share2, MessageCircle, FileDown, Plus, Trash2, Flag, Pin, PinOff, StickyNote, Send, Loader2, History, Archive, Paperclip } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { formatDate, formatBytes, cn } from "@/lib/utils";
import { useDetail } from "../context";
import { docRev } from "../use-project-detail";

export function QrTab() {
  const {
    project,
    documents,
    permits,
    photos,
    siteBoardUrl,
    qrCode,
    canSeeQr,
    isProjectApprover,
    qrLoading,
    qrFetched,
    qrChecking,
    qrError,
    retryQr,
    qrSvgRef,
    isPinned,
    togglePin,
    qrPins,
    loadQr,
    downloadQr,
    printQr,
  } = useDetail();

  // Pinning publishes (#167): say so plainly before anything goes up.
  const [confirmPin, setConfirmPin] = useState<{ itemType: string; itemId: string; name: string; noFile: boolean } | null>(null);
  const [pinning, setPinning] = useState(false);
  const askPin = (itemType: string, itemId: string, name: string, noFile = false) => {
    if (isPinned(itemType, itemId)) { void togglePin(itemType, itemId); return; }
    setConfirmPin({ itemType, itemId, name, noFile });
  };
  const hiddenPins = (qrPins ?? []).filter((p: any) => p.hidden);

  return (
    <>
        <TabsContent value="qr">
          <div className="max-w-xl mx-auto py-4">
            <div className="text-center mb-8">
              <QrCode className="w-10 h-10 text-primary mx-auto mb-3" />
              <h2 className="text-xl font-bold">{canSeeQr ? "Site Board QR Code" : "Site Board"}</h2>
              <p className="text-muted-foreground text-sm mt-1">
                {canSeeQr
                  ? "Print this QR code and post it on site. Workers can scan it to view live project information, permits, and documents, no login required."
                  : "The information pinned to this project's site board."}
              </p>
            </div>

            {/* Pinned documents — always visible so the PM can see what's on the board.
                Matches the public scanned view. Pin via Board Contents below or the Share dialog. */}
            {(() => {
              const pinnedDocs = (documents ?? []).filter(d => isPinned("document", d.id!));
              if (pinnedDocs.length === 0) return null;
              return (
                <div className="mb-6 rounded-xl border bg-muted/20 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Pin className="w-4 h-4 text-primary" fill="currentColor" />
                    <h3 className="font-semibold text-sm">Pinned documents</h3>
                    <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{pinnedDocs.length}</span>
                  </div>
                  <div className="rounded-lg border divide-y bg-background">
                    {pinnedDocs.map(doc => (
                      <div key={doc.id} className="flex items-center gap-3 px-3 py-2.5">
                        <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{doc.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[10px] font-semibold uppercase tracking-wide bg-muted px-1.5 py-0.5 rounded">{doc.type}</span>
                            <span className="text-xs text-muted-foreground">{docRev(doc)}</span>
                          </div>
                        </div>
                        {/* Unpinning changes the PUBLIC board: approvers only (the API enforces it). */}
                        {isProjectApprover && (
                          <button
                            onClick={() => togglePin("document", doc.id!)}
                            className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-destructive transition-colors px-2 py-1 rounded-lg hover:bg-muted"
                            title="Unpin from board"
                          >
                            <PinOff className="w-3.5 h-3.5" /> Unpin
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {!canSeeQr ? (
              <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground text-center" data-testid="text-qr-restricted">
                The site check-in QR code and link are only available to admins and project managers.
              </div>
            ) : qrError ? (
              <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 flex flex-col items-center gap-3 text-center" role="alert" data-testid="qr-load-error">
                <AlertTriangle className="w-6 h-6 text-destructive" />
                <p className="text-sm text-destructive break-words min-w-0">{qrError}</p>
                {/* Generate stays available so a project with no QR yet is never
                    stuck behind a failing load. It's safe: the server hands back
                    the existing QR if there is one, so it can't make a duplicate. */}
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="outline" onClick={() => void retryQr()} disabled={qrChecking || qrLoading} data-testid="button-qr-retry">
                    <RefreshCw className={cn("w-4 h-4 mr-2", qrChecking && "animate-spin")} /> Retry
                  </Button>
                  <Button onClick={() => void loadQr()} disabled={qrChecking || qrLoading} data-testid="button-qr-generate-from-error">
                    {qrLoading
                      ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Generating…</>
                      : <><QrCode className="w-4 h-4 mr-2" /> Generate Site Board QR Code</>}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">If this project already has a QR code, Generate shows that one. It never makes a second.</p>
              </div>
            ) : qrChecking && !qrFetched ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground" data-testid="qr-loading">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading QR code...
              </div>
            ) : !qrFetched ? (
              <div className="flex flex-col items-center gap-4">
                <div className="w-40 h-40 rounded-2xl bg-muted flex items-center justify-center opacity-40">
                  <QrCode className="w-16 h-16 text-muted-foreground" />
                </div>
                <Button onClick={loadQr} disabled={qrLoading} size="lg">
                  {qrLoading
                    ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Generating…</>
                    : <><QrCode className="w-4 h-4 mr-2" /> Generate Site Board QR Code</>}
                </Button>
              </div>
            ) : qrCode ? (
              <div className="flex flex-col items-center gap-5">
                <div ref={qrSvgRef} className="p-4 bg-white border-2 border-muted rounded-2xl shadow-sm">
                  <QRCodeSVG value={qrCode.siteUrl} size={200} level="H" includeMargin />
                </div>

                <div className="w-full bg-muted/50 rounded-xl px-4 py-3 text-center">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Scan target URL</p>
                  <p className="text-sm font-mono text-foreground break-all">{qrCode.siteUrl}</p>
                </div>

                <div className="flex gap-3 w-full">
                  <Button variant="outline" className="flex-1" onClick={downloadQr}>
                    <Download className="w-4 h-4 mr-2" /> Download SVG
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={printQr}>
                    <Printer className="w-4 h-4 mr-2" /> Print
                  </Button>
                </div>

                {siteBoardUrl && (
                  <a
                    href={siteBoardUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg border border-primary/30 bg-primary/5 text-primary text-sm font-medium hover:bg-primary/10 transition-colors"
                  >
                    <QrCode className="w-4 h-4" /> View Site Board
                  </a>
                )}

                <div className="w-full bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
                  <p className="font-semibold mb-1">What workers will see when they scan:</p>
                  <ul className="list-disc list-inside space-y-1 text-blue-700 text-xs">
                    <li>Project name, address and status</li>
                    <li>Site manager contact details</li>
                    <li>Active permits and expiry dates</li>
                    <li>Public documents on display</li>
                    <li>Trades currently working on site</li>
                    <li>Any items you pin below</li>
                  </ul>
                </div>

                {/* Board Contents — pin management */}
                <div className="w-full border-t pt-5">
                  <div className="flex items-center gap-2 mb-1">
                    <Pin className="w-4 h-4 text-primary" />
                    <h3 className="font-semibold text-sm">Board Contents</h3>
                  </div>
                  <p className="text-xs text-muted-foreground mb-4">Pin items to put them on the board. Anyone who scans this QR code, and everyone on the Team Portal for this project, can open what you pin.</p>

                  {/* Pins the board leaves off, with the reason (#166, #167). */}
                  {hiddenPins.length > 0 && (
                    <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 space-y-2" data-testid="hidden-pins">
                      <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wide">Not shown on the board</p>
                      {hiddenPins.map((p: any) => (
                        <div key={p.id} className="flex flex-wrap items-center gap-2 min-w-0">
                          <p className="text-sm min-w-0 flex-1 basis-48 break-words"><span className="font-medium">{p.name ?? "An item from elsewhere"}</span> <span className="text-muted-foreground">{p.hiddenText}</span></p>
                          {isProjectApprover && (
                            <button onClick={() => togglePin(p.itemType, p.itemId)} className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-destructive px-2 py-1 rounded-lg hover:bg-muted">
                              <PinOff className="w-3.5 h-3.5" /> Remove pin
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Documents */}
                  {(documents?.length ?? 0) > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Documents</p>
                      <div className="rounded-xl border divide-y">
                        {documents?.filter(d => (d as any).status === "current").map(doc => {
                          const pinned = isPinned("document", doc.id!);
                          return (
                            <div key={doc.id} className="flex items-center gap-3 px-3 py-2.5">
                              <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{doc.name}</p>
                                <p className="text-xs text-muted-foreground">{doc.type} · {docRev(doc)}</p>
                              </div>
                              <button
                                onClick={() => askPin("document", doc.id!, doc.name ?? "This document")}
                                className={cn("p-1.5 rounded-lg transition-colors", pinned ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-muted")}
                                title={pinned ? "Unpin from board" : "Pin to board"}
                              >
                                <Pin className="w-4 h-4" fill={pinned ? "currentColor" : "none"} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Photos */}
                  {photos.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Photos</p>
                      <div className="rounded-xl border divide-y">
                        {photos.slice(0, 20).map(photo => {
                          const pinned = isPinned("photo", photo.id);
                          return (
                            <div key={photo.id} className="flex items-center gap-3 px-3 py-2.5">
                              <Camera className="w-4 h-4 text-muted-foreground shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{photo.referenceNumber} · {photo.category}</p>
                                {photo.description && <p className="text-xs text-muted-foreground truncate">{photo.description}</p>}
                              </div>
                              <button
                                onClick={() => askPin("photo", photo.id, `Photo ${photo.referenceNumber}`, !photo.photoUrl)}
                                className={cn("p-1.5 rounded-lg transition-colors", pinned ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-muted")}
                                title={pinned ? "Unpin from board" : "Pin to board"}
                              >
                                <Pin className="w-4 h-4" fill={pinned ? "currentColor" : "none"} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Permits */}
                  {permits.filter(p => !p.archivedAt).length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Permits</p>
                      <div className="rounded-xl border divide-y">
                        {permits.filter(p => !p.archivedAt).map(permit => {
                          const pinned = isPinned("permit", permit.id);
                          return (
                            <div key={permit.id} className="flex items-center gap-3 px-3 py-2.5">
                              <ShieldCheck className="w-4 h-4 text-muted-foreground shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{permit.type}</p>
                                <p className="text-xs text-muted-foreground">Expires {new Date(permit.expiryDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                              </div>
                              <button
                                onClick={() => askPin("permit", permit.id, permit.type, !permit.documentUrl)}
                                className={cn("p-1.5 rounded-lg transition-colors", pinned ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-muted")}
                                title={pinned ? "Unpin from board" : "Pin to board"}
                              >
                                <Pin className="w-4 h-4" fill={pinned ? "currentColor" : "none"} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {(documents?.length ?? 0) === 0 && photos.length === 0 && permits.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">No items to pin yet. Add documents, photos, or permits to the project first.</p>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </TabsContent>
        <Dialog open={!!confirmPin} onOpenChange={v => { if (!v) setConfirmPin(null); }}>
          <DialogHeader>
            <DialogTitle className="flex items-start gap-2 break-words"><Pin className="w-4 h-4 shrink-0 mt-1 text-primary" /> Pin {confirmPin?.name} to the site board?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm" data-testid="pin-confirm">
            <p className="font-semibold">Anyone who scans the site QR code, and everyone on the Team Portal for this project, can open it.</p>
            {confirmPin?.itemType === "document" && <p className="text-muted-foreground">When a new revision is uploaded, the board shows the new one instead.</p>}
            {confirmPin?.noFile && (
              <p className="text-amber-700 dark:text-amber-400 font-medium">
                {confirmPin.itemType === "permit" ? "This permit has no document attached, so the board shows it as a notice and says so." : "It has no file attached, so the board says so."}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmPin(null)}>Cancel</Button>
            <Button isLoading={pinning} data-testid="button-pin-confirm" onClick={async () => {
              if (!confirmPin) return;
              setPinning(true);
              await togglePin(confirmPin.itemType, confirmPin.itemId);
              setPinning(false);
              setConfirmPin(null);
            }}>Pin to the board</Button>
          </DialogFooter>
        </Dialog>
    </>
  );
}
