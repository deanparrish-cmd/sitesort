import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ListRow, Pill } from "@/components/ui/list-row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, Calendar, Upload, FileText, CheckCircle2, AlertTriangle, ShieldCheck, Eye, EyeOff, Users, Search, X, Phone, Mail, HardHat, UserCheck, Clock, Pencil, Camera, FolderOpen, ChevronDown, ChevronUp, ChevronRight, QrCode, Download, Printer, RefreshCw, ArrowDownCircle, ArrowUpCircle, Receipt, ClipboardCheck, UserPlus, ExternalLink, Share2, MessageCircle, FileDown, Plus, Trash2, Flag, Pin, PinOff, StickyNote, Send, Loader2, History, Archive, Paperclip } from "lucide-react";
import { openDocument, cadBadgeLabel } from "@/lib/documents";
import { OverdueBadge } from "@/components/ui/overdue-badge";
import { formatDate, formatBytes, cn } from "@/lib/utils";
import { daysUntilExpiry } from "@/lib/expiry";
import { useDetail } from "../context";
import { docRev, PermitItem } from "../use-project-detail";

export function PermitsTab() {
  const {
    project,
    documents,
    members,
    permits,
    setPermitAddOpen,
    showSupersededPermits,
    setShowSupersededPermits,
    setEditingPermit,
    setEditPermitError,
    projectShareLog,
    projectShareLogLoading,
    loadProjectShareLog,
    setIsUploadOpen,
    caps,
    setValue,
    deletePermit,
    setSharingDoc,
  } = useDetail();

  return (
    <>
        <TabsContent value="permits">
          {(() => {
            const daysLeft = (dateStr: string) => daysUntilExpiry(dateStr);
            const fmtDate = (s: string) => new Date(s + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

            const livePermits = [...permits].filter(p => !p.archivedAt);
            const supersededPermits = [...permits].filter(p => !!p.archivedAt).sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
            const active = livePermits.filter(p => { const d = daysLeft(p.expiryDate); return d > 30; }).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
            const expiring = livePermits.filter(p => { const d = daysLeft(p.expiryDate); return d >= 0 && d <= 30; }).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
            const expired = livePermits.filter(p => daysLeft(p.expiryDate) < 0).sort((a, b) => b.expiryDate.localeCompare(a.expiryDate));
            const overdueCount = livePermits.filter(p => p.overdue).length;

            const permitRow = (p: PermitItem, accent: string) => {
              const days = daysLeft(p.expiryDate);
              const statusLabel = days < 0 ? "Expired" : days === 0 ? "Expires today" : days <= 30 ? `${days}d left` : "Active";
              return (
                <div key={p.id} className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 py-3 rounded-xl border ${accent}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{p.type}</p>
                      <Badge className={`text-[10px] border ${days < 0 ? "bg-red-100 text-red-700 border-red-200" : days <= 7 ? "bg-orange-100 text-orange-700 border-orange-200" : days <= 30 ? "bg-yellow-100 text-yellow-700 border-yellow-200" : "bg-emerald-100 text-emerald-700 border-emerald-200"}`}>{statusLabel}</Badge>
                      {p.overdue && <OverdueBadge />}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{p.description}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{fmtDate(p.startDate)} – {fmtDate(p.expiryDate)}{p.responsibleName ? ` · ${p.responsibleName}` : ""}</p>
                    {p.dueDate && (
                      <p className={`text-xs mt-0.5 flex items-center gap-1 ${p.overdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
                        <Calendar className="w-3 h-3 shrink-0" />Action due {fmtDate(p.dueDate)}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1 shrink-0">
                    {caps.canManageTeam && (
                      <button
                        onClick={() => { setEditingPermit(p); setEditPermitError(null); }}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-background text-muted-foreground text-xs font-medium hover:text-foreground hover:bg-muted transition-colors"
                        title="Edit / reassign permit"
                      >
                        <Pencil className="w-3.5 h-3.5" /> Edit
                      </button>
                    )}
                    {p.documentUrl && (() => {
                      const norm = p.documentUrl.replace(/^\/uploads\//, "/api/uploads/");
                      const certUrl = norm.startsWith("http") ? norm : `${window.location.origin}${norm}`;
                      return (
                        <button
                          onClick={() => window.open(certUrl, "_blank", "noopener,noreferrer")}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/25 bg-primary/5 text-primary text-xs font-medium hover:bg-primary/15 transition-colors"
                          title="Open certificate"
                        >
                          <ExternalLink className="w-3.5 h-3.5" /> Certificate
                        </button>
                      );
                    })()}
                    <button
                      onClick={() => setSharingDoc({ type: "permit", id: p.id, name: `${p.type} – ${p.description}`, version: null, fileUrl: p.documentUrl ?? "" })}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-background text-muted-foreground text-xs font-medium hover:text-foreground hover:bg-muted transition-colors"
                      title="Share"
                    >
                      <Share2 className="w-3.5 h-3.5" /> Share
                    </button>
                    {caps.canManageTeam && (
                      <button
                        onClick={() => { if (confirm(`Delete "${p.type}" permit?`)) deletePermit(p.id); }}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-red-50 transition-colors"
                        title="Delete permit"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            };

            return (
              <div className="space-y-6">
                <PageHeader
                  level="section"
                  title="Health & Safety"
                  badge={overdueCount > 0 && (
                    <Pill className="bg-red-100 text-red-700" icon={<AlertTriangle className="w-3 h-3" />}>{overdueCount} overdue</Pill>
                  )}
                  description="Permits, method statements, safety documents and insurance for this project."
                  actions={<>
                    {caps.canUploadDocument && (
                      <Button variant="outline" size="sm" onClick={() => { setValue("type", "permit"); setIsUploadOpen(true); }}>
                        <Upload className="w-4 h-4 mr-1.5" /> Upload Doc
                      </Button>
                    )}
                    {caps.canManageTeam && (
                      <Button variant="accent" size="sm" onClick={() => setPermitAddOpen(true)}>
                        <Plus className="w-4 h-4 mr-1.5" /> Add Permit
                      </Button>
                    )}
                  </>}
                />

                {/* Permits list */}
                {livePermits.length === 0 && supersededPermits.length === 0 ? (
                  <Card><CardContent className="py-12 text-center border-dashed border-2">
                    <ClipboardCheck className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
                    <p className="font-semibold text-muted-foreground">No permits or certifications added yet.</p>
                    <p className="text-sm text-muted-foreground mt-1">Add CSCS checks, IPAF certificates, hot works permits, and more.</p>
                    {caps.canManageTeam && <Button variant="outline" size="sm" className="mt-4" onClick={() => setPermitAddOpen(true)}><Plus className="w-4 h-4 mr-1.5" />Add Permit</Button>}
                  </CardContent></Card>
                ) : (
                  <div className="space-y-6">
                    {expired.length > 0 && (
                      <section id="section-expired" className="scroll-mt-24">
                        <div className="flex items-center gap-2 mb-3">
                          <AlertTriangle className="w-4 h-4 text-destructive" />
                          <h3 className="font-bold text-sm uppercase tracking-wide text-destructive">Expired</h3>
                          <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{expired.length}</span>
                        </div>
                        <div className="space-y-2">{expired.map(p => permitRow(p, "bg-red-50 border-red-200"))}</div>
                      </section>
                    )}
                    {expiring.length > 0 && (
                      <section>
                        <div className="flex items-center gap-2 mb-3">
                          <Clock className="w-4 h-4 text-orange-600" />
                          <h3 className="font-bold text-sm uppercase tracking-wide text-orange-600">Expiring Soon</h3>
                          <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{expiring.length}</span>
                        </div>
                        <div className="space-y-2">{expiring.map(p => permitRow(p, "bg-orange-50 border-orange-200"))}</div>
                      </section>
                    )}
                    {active.length > 0 && (
                      <section>
                        <div className="flex items-center gap-2 mb-3">
                          <ShieldCheck className="w-4 h-4 text-emerald-600" />
                          <h3 className="font-bold text-sm uppercase tracking-wide text-emerald-600">Active</h3>
                          <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{active.length}</span>
                        </div>
                        <div className="space-y-2">{active.map(p => permitRow(p, "bg-emerald-50 border-emerald-200"))}</div>
                      </section>
                    )}
                    {supersededPermits.length > 0 && (
                      <section>
                        <button
                          onClick={() => setShowSupersededPermits(v => !v)}
                          className="flex items-center gap-2 mb-3 text-muted-foreground hover:text-foreground transition-colors w-full text-left"
                        >
                          <Archive className="w-4 h-4" />
                          <span className="font-bold text-sm uppercase tracking-wide">Superseded</span>
                          <span className="text-xs font-semibold bg-muted px-2 py-0.5 rounded-full">{supersededPermits.length}</span>
                          {showSupersededPermits ? <ChevronUp className="w-4 h-4 ml-auto" /> : <ChevronDown className="w-4 h-4 ml-auto" />}
                        </button>
                        {showSupersededPermits && (
                          <div className="space-y-2">{supersededPermits.map(p => permitRow(p, "bg-muted/30 border-border opacity-70"))}</div>
                        )}
                      </section>
                    )}
                  </div>
                )}

                {/* H&S documents — grouped by type (Method Statements / Permits / Safety) */}
                {(() => {
                  const renderDocRow = (doc: NonNullable<typeof documents>[number]) => {
                    const isSuperseded = doc.status === "superseded";
                    const cadBadge = cadBadgeLabel(doc.fileUrl, doc.name);
                    return (
                      <div key={doc.id} className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 py-3 rounded-xl border ${isSuperseded ? "opacity-60 bg-muted/20" : "bg-card"}`}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <FileText className="w-4 h-4 text-primary shrink-0" />
                            <p className={`font-semibold text-sm min-w-0 break-words ${isSuperseded ? "line-through text-muted-foreground" : ""}`}>{doc.name}</p>
                            <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded">{docRev(doc)}</span>
                            {cadBadge && <span className="font-mono text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 px-1.5 py-0.5 rounded font-bold">{cadBadge}</span>}
                            {isSuperseded && <span className="text-[10px] font-semibold text-destructive bg-red-100 px-1.5 py-0.5 rounded">Superseded</span>}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 ml-6">{formatDate(doc.createdAt)} · {doc.uploaderName}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => openDocument(doc.fileUrl, doc.name)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/25 bg-primary/5 text-primary text-xs font-medium hover:bg-primary/15 transition-colors"
                            title={cadBadge ? "Download document" : "Open document"}
                          >
                            {cadBadge ? <><Download className="w-3.5 h-3.5" /> Download</> : <><ExternalLink className="w-3.5 h-3.5" /> Open</>}
                          </button>
                          <button
                            onClick={() => setSharingDoc({ type: "document", id: doc.id, name: doc.name, version: doc.version, fileUrl: doc.fileUrl })}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-background text-muted-foreground text-xs font-medium hover:text-foreground hover:bg-muted transition-colors"
                            title="Share"
                          >
                            <Share2 className="w-3.5 h-3.5" /> Share
                          </button>
                        </div>
                      </div>
                    );
                  };
                  const docGroups: { key: string; label: string }[] = [
                    { key: "method_statement", label: "Method Statements (RAMS)" },
                    { key: "permit", label: "Permit Documents" },
                    { key: "safety", label: "Safety Documents" },
                  ];
                  return docGroups.map(g => {
                    const docs = (documents ?? []).filter(d => d.type === g.key);
                    return (
                      <section key={g.key}>
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <FileText className="w-4 h-4 text-primary" />
                            <h3 className="font-bold text-sm uppercase tracking-wide text-muted-foreground">{g.label}</h3>
                            <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{docs.length}</span>
                          </div>
                          {caps.canUploadDocument && (
                            <Button variant="ghost" size="sm" onClick={() => { setValue("type", g.key); setIsUploadOpen(true); }}>
                              <Upload className="w-3.5 h-3.5 mr-1.5" /> Upload
                            </Button>
                          )}
                        </div>
                        {docs.length === 0 ? (
                          <p className="text-sm text-muted-foreground px-4 py-3 border border-dashed rounded-xl">No {g.label.toLowerCase()} yet.</p>
                        ) : (
                          <div className="space-y-2">{docs.map(renderDocRow)}</div>
                        )}
                      </section>
                    );
                  });
                })()}

                {/* Team Insurance */}
                {members && (members as any[]).length > 0 && (
                  <section id="section-insurance" className="scroll-mt-24">
                    <div className="flex items-center gap-2 mb-3">
                      <UserCheck className="w-4 h-4 text-primary" />
                      <h3 className="font-bold text-sm uppercase tracking-wide text-muted-foreground">Team Insurance</h3>
                      <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{(members as any[]).length}</span>
                    </div>
                    <div className="space-y-2">
                      {(members as any[]).map((m: any) => (
                        <div key={m.id} className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border ${m.complianceStatus === "hold" ? "bg-red-50 border-red-200" : m.complianceStatus === "warning" ? "bg-orange-50 border-orange-200" : "bg-card border-border"}`}>
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-xs font-extrabold ${m.complianceStatus === "hold" ? "bg-red-100 text-red-700" : m.complianceStatus === "warning" ? "bg-orange-100 text-orange-700" : "bg-primary/10 text-primary"}`}>
                              {m.name.split(" ").map((w: string) => w[0]).slice(0, 2).join("")}
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-sm truncate">{m.name}</p>
                              <p className="text-xs text-muted-foreground capitalize">{m.role.replace(/_/g, " ")}</p>
                            </div>
                          </div>
                          <div className="shrink-0">
                            {m.complianceStatus === "hold"
                              ? <Badge variant="destructive" className="text-[10px]"><AlertTriangle className="w-3 h-3 mr-1" />Site Access Denied</Badge>
                              : m.complianceStatus === "warning"
                              ? <Badge className="text-[10px] bg-orange-100 text-orange-700 border-orange-200"><AlertTriangle className="w-3 h-3 mr-1" />Insurance Expiring</Badge>
                              : m.pliCertUrl
                              ? <Badge variant="success" className="text-[10px]"><ShieldCheck className="w-3 h-3 mr-1" />Insured{m.pliExpiryDate ? ` · ${new Date(m.pliExpiryDate + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}</Badge>
                              : <Badge variant="secondary" className="text-[10px]">No cert on file</Badge>
                            }
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
                {/* Project Share Log */}
                <section>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <History className="w-4 h-4 text-primary" />
                      <h3 className="font-bold text-sm uppercase tracking-wide text-muted-foreground">Share Activity Log</h3>
                      {projectShareLog.length > 0 && <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{projectShareLog.length}</span>}
                    </div>
                    <Button variant="ghost" size="sm" onClick={loadProjectShareLog} disabled={projectShareLogLoading}>
                      {projectShareLogLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                      <span className="ml-1.5">{projectShareLog.length === 0 && !projectShareLogLoading ? "Load" : "Refresh"}</span>
                    </Button>
                  </div>
                  {projectShareLog.length === 0 && !projectShareLogLoading ? (
                    <div className="border-2 border-dashed rounded-xl p-6 text-center">
                      <History className="w-7 h-7 mx-auto text-muted-foreground/30 mb-2" />
                      <p className="text-sm text-muted-foreground">No shares recorded yet. Share a document, permit, or photo to start the log.</p>
                    </div>
                  ) : projectShareLogLoading ? (
                    <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                  ) : (
                    <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                      {projectShareLog.map(entry => (
                        <div key={entry.id} className="flex items-start gap-3 px-3 py-2.5 rounded-lg border bg-card text-sm">
                          <div className={`mt-0.5 shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs ${entry.method === "email" ? "bg-blue-100 text-blue-600" : entry.method === "whatsapp" ? "bg-green-100 text-green-600" : "bg-primary/10 text-primary"}`}>
                            {entry.method === "email" ? <Mail className="w-3 h-3" /> : entry.method === "whatsapp" ? <MessageCircle className="w-3 h-3" /> : <Users className="w-3 h-3" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-[13px] truncate">{entry.entityName}</p>
                            <p className="text-xs text-muted-foreground">
                              {entry.method === "email" ? "Emailed" : entry.method === "whatsapp" ? "WhatsApp" : "Shared with team"}
                              {entry.recipientInfo ? ` → ${entry.recipientInfo}` : ""}
                              {" · "}{entry.sentByName}
                            </p>
                          </div>
                          <p className="shrink-0 text-[10px] text-muted-foreground whitespace-nowrap">{new Date(entry.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} {new Date(entry.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</p>
                        </div>
                      ))}
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
