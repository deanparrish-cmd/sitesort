import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { MapPin, Calendar, Upload, FileText, CheckCircle2, AlertTriangle, ShieldCheck, Eye, EyeOff, Users, Search, X, Phone, Mail, HardHat, UserCheck, Clock, Pencil, Camera, FolderOpen, ChevronDown, ChevronUp, ChevronRight, QrCode, Download, Printer, RefreshCw, ArrowDownCircle, ArrowUpCircle, Receipt, ClipboardCheck, UserPlus, ExternalLink, Share2, MessageCircle, FileDown, Plus, Trash2, Flag, Pin, PinOff, StickyNote, Send, Loader2, History, Archive, Paperclip } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
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
    qrLoading,
    qrFetched,
    qrSvgRef,
    isPinned,
    togglePin,
    loadQr,
    downloadQr,
    printQr,
  } = useDetail();

  return (
    <>
        <TabsContent value="qr">
          <div className="max-w-xl mx-auto py-4">
            <div className="text-center mb-8">
              <QrCode className="w-10 h-10 text-primary mx-auto mb-3" />
              <h2 className="text-xl font-bold">Site Board QR Code</h2>
              <p className="text-muted-foreground text-sm mt-1">
                Print this QR code and post it on site. Workers can scan it to view live project information, permits, and documents — no login required.
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
                        <button
                          onClick={() => togglePin("document", doc.id!)}
                          className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-destructive transition-colors px-2 py-1 rounded-lg hover:bg-muted"
                          title="Unpin from board"
                        >
                          <PinOff className="w-3.5 h-3.5" /> Unpin
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {!qrFetched ? (
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
                  <p className="text-xs text-muted-foreground mb-4">Pin specific items to highlight them for workers who scan this QR code.</p>

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
                                onClick={() => togglePin("document", doc.id!)}
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
                                <p className="text-sm font-medium truncate">{photo.referenceNumber} — {photo.category}</p>
                                {photo.description && <p className="text-xs text-muted-foreground truncate">{photo.description}</p>}
                              </div>
                              <button
                                onClick={() => togglePin("photo", photo.id)}
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
                                onClick={() => togglePin("permit", permit.id)}
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
            ) : (
              <p className="text-destructive text-center text-sm">Failed to generate QR code. Please try again.</p>
            )}
          </div>
        </TabsContent>
    </>
  );
}
