import { useRoute, useLocation, Link } from "wouter";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { ListRow, Pill } from "@/components/ui/list-row";
import { Badge } from "@/components/ui/badge";
import { MapPin, Calendar, Upload, FileText, CheckCircle2, AlertTriangle, ShieldCheck, Eye, EyeOff, Users, Search, X, Phone, Mail, HardHat, UserCheck, Clock, Pencil, Camera, FolderOpen, ChevronDown, ChevronUp, ChevronRight, QrCode, Download, Printer, RefreshCw, ArrowDownCircle, ArrowUpCircle, Receipt, ClipboardCheck, UserPlus, ExternalLink, Share2, MessageCircle, FileDown, Plus, Trash2, Flag, Pin, PinOff, StickyNote, Send, Loader2, History, Archive, Paperclip } from "lucide-react";
import { openDocument, cadBadgeLabel } from "@/lib/documents";
import { formatDate, formatBytes, cn } from "@/lib/utils";
import { useDetail } from "../context";
import { docRev } from "../use-project-detail";

export function FinancesTab() {
  const {
    projectId,
    project,
    documents,
    permits,
    projectInvoices,
    invoiceFullUrl,
    markInvoiceUnpaid,
    caps,
    setSharingDoc,
    setSharingInvoice,
  } = useDetail();

  return (
    <>
        <TabsContent value="finances">
          {(() => {
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const daysLeft = (dateStr: string) => Math.ceil((new Date(dateStr + "T00:00:00").getTime() - today.getTime()) / 86400000);
            const fmtDate = (s: string) => new Date(s + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
            const fmtAmt = (currency: string, amount: string) => `${currency} ${Number(amount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;

            const statusStyle = (days: number, paid = false) => {
              if (paid) return "bg-emerald-50 border-emerald-200 text-emerald-700";
              if (days < 0) return "bg-red-50 border-red-200 text-red-700";
              if (days <= 7) return "bg-orange-50 border-orange-200 text-orange-700";
              if (days <= 30) return "bg-yellow-50 border-yellow-200 text-yellow-700";
              return "bg-muted/30 border-border text-muted-foreground";
            };
            const statusLabel = (days: number, paid = false) => {
              if (paid) return "Paid";
              if (days < 0) return "Overdue";
              if (days <= 7) return `${days}d — urgent`;
              if (days <= 30) return `${days}d`;
              return `${days}d`;
            };
            // Permits use expiry wording, not the invoice "Overdue" label.
            const permitLabel = (days: number) =>
              days < 0 ? "Expired" : days === 0 ? "Expires today" : days <= 30 ? `${days}d left` : "Active";

            const unpaidInbound = projectInvoices.filter(i => i.direction === "inbound" && i.status !== "paid").reduce((s, i) => s + Number(i.amount), 0);
            const unpaidOutbound = projectInvoices.filter(i => i.direction === "outbound" && i.status !== "paid").reduce((s, i) => s + Number(i.amount), 0);

            return (
              <div className="space-y-8">

                {/* Permit Expiry */}
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <ClipboardCheck className="w-5 h-5 text-primary" />
                    <h3 className="font-bold text-lg">Permit Expiry</h3>
                    <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{permits.filter(p => !p.archivedAt).length}</span>
                  </div>
                  {permits.filter(p => !p.archivedAt).length === 0 ? (
                    <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">No permits on this project.</CardContent></Card>
                  ) : (
                    <div className="space-y-2">
                      {[...permits].filter(p => !p.archivedAt).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)).map(p => {
                        const days = daysLeft(p.expiryDate);
                        return (
                          <ListRow
                            key={p.id}
                            className={statusStyle(days)}
                            content={<>
                              <p className="font-semibold text-sm truncate">{p.type}</p>
                              <p className="text-xs opacity-70 truncate">{p.description}{p.responsibleName ? ` · ${p.responsibleName}` : ""}</p>
                            </>}
                            actions={<>
                              <div className="text-left sm:text-right">
                                <p className="text-xs font-semibold">{permitLabel(days)}</p>
                                <p className="text-xs opacity-70">{fmtDate(p.expiryDate)}</p>
                              </div>
                              {p.documentUrl && (
                                <button
                                  type="button"
                                  onClick={() => window.open(p.documentUrl!.replace(/^\/uploads\//, "/api/uploads/"), "_blank", "noopener,noreferrer")}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-background text-xs font-medium text-foreground hover:bg-muted transition-colors"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />Open
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setSharingDoc({ type: "permit", id: p.id, name: `${p.type} – ${p.description}`, version: null, fileUrl: p.documentUrl ?? "" })}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-background text-xs font-medium text-foreground hover:bg-muted transition-colors"
                                title="Share permit"
                              >
                                <Share2 className="w-3.5 h-3.5" />Share
                              </button>
                            </>}
                          />
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* Document Status */}
                <section id="section-docstatus" className="scroll-mt-24">
                  <div className="flex items-center gap-2 mb-4">
                    <FileText className="w-5 h-5 text-primary" />
                    <h3 className="font-bold text-lg">Document Status</h3>
                    <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{documents?.length ?? 0}</span>
                  </div>
                  {(!documents || documents.length === 0) ? (
                    <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">No documents uploaded yet.</CardContent></Card>
                  ) : (
                    <div className="space-y-2">
                      {[...documents].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(doc => {
                        const isSuperseded = doc.status === "superseded";
                        const pending = doc.distributionSummary?.pending ?? 0;
                        return (
                          <ListRow
                            key={doc.id}
                            className={isSuperseded ? "bg-muted/30 border-border opacity-60" : pending > 0 ? "bg-yellow-50 border-yellow-200" : "bg-emerald-50 border-emerald-200"}
                            content={<div className="flex items-center gap-3 min-w-0">
                              <FileText className="w-4 h-4 shrink-0 text-muted-foreground" />
                              <div className="min-w-0">
                                <p className={`font-semibold text-sm truncate ${isSuperseded ? "line-through text-muted-foreground" : ""}`}>{doc.name}</p>
                                <p className="text-xs text-muted-foreground capitalize">{doc.type.replace("_", " ")} · {docRev(doc)}</p>
                              </div>
                            </div>}
                            actions={<>
                              <div className="text-left sm:text-right">
                                {isSuperseded
                                  ? <Badge variant="secondary" className="text-[10px]">Superseded</Badge>
                                  : pending > 0
                                  ? <Badge className="text-[10px] bg-yellow-100 text-yellow-700 border-yellow-200">{pending} pending sign-off</Badge>
                                  : <Badge variant="success" className="text-[10px]">All signed off</Badge>
                                }
                                {cadBadgeLabel(doc.fileUrl, doc.name) && <span className="ml-1 font-mono bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 px-1.5 py-0.5 rounded text-[10px] font-bold">{cadBadgeLabel(doc.fileUrl, doc.name)}</span>}
                                <p className="text-xs text-muted-foreground mt-0.5">{formatDate(doc.createdAt)}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => openDocument(doc.fileUrl, doc.name)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-background text-xs font-medium text-foreground hover:bg-muted transition-colors"
                                title={cadBadgeLabel(doc.fileUrl, doc.name) ? "Download document" : "Open document"}
                              >
                                {cadBadgeLabel(doc.fileUrl, doc.name) ? <><Download className="w-3.5 h-3.5" />Download</> : <><ExternalLink className="w-3.5 h-3.5" />Open</>}
                              </button>
                              <button
                                type="button"
                                onClick={() => setSharingDoc({ type: "document", id: doc.id, name: doc.name, version: doc.version, fileUrl: doc.fileUrl })}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-background text-xs font-medium text-foreground hover:bg-muted transition-colors"
                              >
                                <Share2 className="w-3.5 h-3.5" />Share
                              </button>
                            </>}
                          />
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* Invoices */}
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <Receipt className="w-5 h-5 text-primary" />
                    <h3 className="font-bold text-lg">Invoices</h3>
                    <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{projectInvoices.length}</span>
                  </div>

                  {projectInvoices.length > 0 && (
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <Link href={`/invoices?project=${projectId}&status=inbound`} className="group block px-4 py-3 rounded-xl border bg-emerald-50 border-emerald-200 transition-shadow hover:ring-2 hover:ring-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">
                        <div className="flex items-center gap-1.5 mb-0.5"><ArrowDownCircle className="w-4 h-4 text-emerald-600" /><p className="text-xs font-medium text-emerald-700 flex items-center gap-1">Due to You <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-70 transition-opacity" /></p></div>
                        <p className="text-xl font-extrabold text-emerald-700">GBP {unpaidInbound.toLocaleString("en-GB", { minimumFractionDigits: 2 })}</p>
                      </Link>
                      <Link href={`/invoices?project=${projectId}&status=outbound`} className="group block px-4 py-3 rounded-xl border bg-rose-50 border-rose-200 transition-shadow hover:ring-2 hover:ring-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300">
                        <div className="flex items-center gap-1.5 mb-0.5"><ArrowUpCircle className="w-4 h-4 text-rose-600" /><p className="text-xs font-medium text-rose-700 flex items-center gap-1">You Owe <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-70 transition-opacity" /></p></div>
                        <p className="text-xl font-extrabold text-rose-700">GBP {unpaidOutbound.toLocaleString("en-GB", { minimumFractionDigits: 2 })}</p>
                      </Link>
                    </div>
                  )}

                  {projectInvoices.length === 0 ? (
                    <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
                      No invoices linked to this project yet. Add invoices from the <a href="/invoices" className="text-primary hover:underline font-medium">Invoices page</a> and assign them here.
                    </CardContent></Card>
                  ) : (
                    <div className="space-y-2">
                      {[...projectInvoices].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map(inv => {
                        const days = daysLeft(inv.dueDate);
                        const paid = inv.status === "paid";
                        return (
                          <div key={inv.id} className={`flex flex-col gap-3 px-4 py-3 rounded-xl border ${statusStyle(days, paid)}`}>
                            {/* Invoice info row */}
                            <div className="flex items-center justify-between gap-4">
                              <div className="flex items-center gap-3 min-w-0">
                                {inv.direction === "inbound"
                                  ? <ArrowDownCircle className="w-4 h-4 shrink-0 text-emerald-600" />
                                  : <ArrowUpCircle className="w-4 h-4 shrink-0 text-rose-600" />
                                }
                                <div className="min-w-0">
                                  <p className="font-semibold text-sm truncate">{inv.counterpartyName}</p>
                                  <p className="text-xs opacity-70 truncate">{inv.description}{inv.reference ? ` · ${inv.reference}` : ""}</p>
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="font-bold text-sm">{fmtAmt(inv.currency, inv.amount)}</p>
                                <p className="text-xs opacity-70">{paid ? "Paid" : statusLabel(days)} · {fmtDate(inv.dueDate)}</p>
                              </div>
                            </div>
                            {/* Pill action buttons */}
                            <div className="flex flex-wrap gap-2">
                              {inv.attachmentUrl && (
                                <button
                                  type="button"
                                  onClick={() => window.open(invoiceFullUrl(inv.attachmentUrl!), "_blank", "noopener,noreferrer")}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-background text-sm font-medium text-foreground hover:bg-muted transition-colors"
                                >
                                  <Eye className="w-3.5 h-3.5" />Open
                                </button>
                              )}
                              {inv.attachmentUrl && (
                                <button
                                  type="button"
                                  onClick={() => setSharingInvoice(inv)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-background text-sm font-medium text-foreground hover:bg-muted transition-colors"
                                  title="Share invoice"
                                >
                                  <Share2 className="w-3.5 h-3.5" />Share
                                </button>
                              )}
                              {paid && caps.canManageInvoices && (
                                <button
                                  type="button"
                                  onClick={() => markInvoiceUnpaid(inv.id)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-background text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
                                >
                                  <Clock className="w-3.5 h-3.5" />Mark Unpaid
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

              </div>
            );
          })()}
        </TabsContent>
    </>
  );
}
