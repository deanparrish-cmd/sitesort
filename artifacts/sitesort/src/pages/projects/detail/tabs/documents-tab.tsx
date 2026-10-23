import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPin, Calendar, Upload, FileText, CheckCircle2, AlertTriangle, ShieldCheck, Eye, EyeOff, Users, Search, X, Phone, Mail, HardHat, UserCheck, Clock, Pencil, Camera, FolderOpen, ChevronDown, ChevronUp, ChevronRight, QrCode, Download, Printer, RefreshCw, ArrowDownCircle, ArrowUpCircle, Receipt, ClipboardCheck, UserPlus, ExternalLink, Share2, MessageCircle, FileDown, Plus, Trash2, Flag, Pin, PinOff, StickyNote, Send, Loader2, History, Archive, Paperclip } from "lucide-react";
import { openDocument, cadBadgeLabel } from "@/lib/documents";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DocumentViewer, type ViewerDoc } from "@/components/document-viewer";
import { useSignOffFlow } from "@/hooks/use-sign-off-flow";
import { SignatureMark } from "@/components/signature-mark";
import {
  useGetProject,
  getGetProjectQueryKey,
  useListDocuments,
  getListDocumentsQueryKey,
  useListProjectMembers,
  getListProjectMembersQueryKey,
  useUploadDocument,
  useUpdateProject,
  useGetMe,
  useGetDocumentAuditLog,
  getGetDocumentAuditLogQueryKey,
  DocumentType,
  UploadDocumentRequestType,
  UpdateProjectRequestStatus,
} from "@workspace/api-client-react";
import { formatDate, formatBytes, cn } from "@/lib/utils";
import { useDetail } from "../context";
import { docRev } from "../use-project-detail";

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  drawing: "Drawing",
  method_statement: "RAMS",
  permit: "Permit",
  safety: "Safety",
  programme: "Construction Programme",
  general: "General",
};

export function DocumentsTab() {
  const {
    documents,
    refetchDocs,
    docsLoading,
    docsError,
    docsFetching,
    members,
    setIsUploadOpen,
    openRevHistory,
    caps,
    canViewAudit,
    setAuditDoc,
    openSignOff,
    selectedDocType,
    setSelectedDocType,
    searchQuery,
    setSearchQuery,
    selectedStatus,
    setSelectedStatus,
    setSharingDoc,
    openDocEdit,
    hasPin,
    authHeaders,
    isCancelled,
  } = useDetail();

  // Opening records the open on your own copy: sign-off needs it (Dean,
  // 2026-10-22), so Sign off appears once the list has refreshed.
  // A document waiting for your signature opens in the in-app viewer, which
  // records the open and carries Sign off on the same screen (Dean, 2026-10-23).
  const queryClient = useQueryClient();
  const viewerSignOff = useSignOffFlow({
    hasPin,
    acknowledgeUrl: id => `/api/documents/${id}/acknowledge`,
    setPinUrl: "/api/auth/pin",
    authHeaders,
    onSigned: () => { void refetchDocs(); },
    onPinSet: () => { void queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] }); },
  });
  const [viewing, setViewing] = useState<(ViewerDoc & { pinRequired: boolean }) | null>(null);
  const recordViewerOpen = async () => {
    if (!viewing) return false;
    const r = await fetch(`/api/documents/${viewing.id}/view`, { method: "POST", headers: authHeaders() });
    if (r.ok) void refetchDocs();
    return r.ok;
  };

  const openAndRecord = (doc: { id: string; fileUrl: string; name: string; myDistributionStatus?: string | null; requiresAcknowledgment?: boolean; status?: string; pinRequired?: boolean; revision?: string | null; version?: number }) => {
    const waitingForMe = doc.myDistributionStatus === "pending" || doc.myDistributionStatus === "viewed";
    if (waitingForMe && doc.requiresAcknowledgment && doc.status !== "superseded" && doc.fileUrl && !isCancelled) {
      setViewing({ id: doc.id, name: doc.name, fileUrl: doc.fileUrl, label: doc.revision ? `Rev ${doc.revision}` : doc.version ? `v${doc.version}` : null, pinRequired: doc.pinRequired ?? true });
      return;
    }
    openDocument(doc.fileUrl, doc.name);
    if (doc.myDistributionStatus !== "pending") return;
    const t = localStorage.getItem("sitesort_token");
    void fetch(`/api/documents/${doc.id}/view`, { method: "POST", headers: t ? { Authorization: `Bearer ${t}` } : {} })
      .then(() => refetchDocs()).catch(() => {});
  };

  return (
    <>
        <TabsContent value="documents">
          <div className="flex flex-col gap-3 mb-6">
            <div className="flex flex-col sm:flex-row flex-wrap gap-3 items-stretch sm:items-center">
              <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-56 sm:max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search documents..."
                  className="pl-9 pr-8"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {caps.canUploadDocument && (
                <Button variant="accent" className="w-full sm:w-auto shrink-0" onClick={() => setIsUploadOpen(true)}>
                  <Upload className="w-4 h-4 mr-2" /> Upload Document
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <Button
                variant={selectedDocType === 'all' ? 'default' : 'secondary'}
                size="sm" onClick={() => setSelectedDocType('all')}
                className="shrink-0"
              >All Types</Button>
              {Object.values(DocumentType).map(type => (
                <Button
                  key={type}
                  variant={selectedDocType === type ? 'default' : 'secondary'}
                  size="sm"
                  onClick={() => setSelectedDocType(type)}
                  className="shrink-0 capitalize"
                >
                  {type === "drawing" ? "Drawings" : type === "permit" ? "Permits" : DOCUMENT_TYPE_LABELS[type] ?? type.replaceAll("_", " ")}
                </Button>
              ))}
              <div className="shrink-0 w-px h-6 bg-border mx-1" />
              {(['all', 'current', 'superseded'] as const).map(s => (
                <Button
                  key={s}
                  variant={selectedStatus === s ? 'default' : 'secondary'}
                  size="sm"
                  onClick={() => setSelectedStatus(s)}
                  className="shrink-0 capitalize"
                >{s === 'all' ? 'All Statuses' : s}</Button>
              ))}
            </div>
          </div>

          <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
            {documents === undefined && (docsLoading || (docsFetching && !docsError)) && (
              <div className="px-6 py-12 flex items-center justify-center gap-2 text-muted-foreground" role="status">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading documents...
              </div>
            )}
            {documents === undefined && docsError && !docsFetching && (
              <div className="px-6 py-12 text-center" role="alert">
                <p className="text-sm font-medium">Couldn't load the documents.</p>
                <p className="text-xs text-muted-foreground mt-1">Check your connection and try again.</p>
                <Button variant="secondary" size="sm" className="mt-4" onClick={() => refetchDocs()}>
                  <RefreshCw className="w-4 h-4 mr-2" /> Try again
                </Button>
              </div>
            )}
            {/* Mobile + tablet card list (below 1280px) */}
            <div className="block xl:hidden divide-y">
              {(documents ?? []).filter(d =>
                (selectedDocType === 'all' || d.type === selectedDocType) &&
                (selectedStatus === 'all' || d.status === selectedStatus) &&
                (searchQuery === '' || d.name.toLowerCase().includes(searchQuery.toLowerCase()))
              ).map(doc => {
                const isSuperseded = doc.status === 'superseded';
                const cadBadge = cadBadgeLabel(doc.fileUrl, doc.name);
                return (
                  <div key={doc.id} className={cn("px-4 py-4", isSuperseded && "opacity-70 bg-muted/20")}>
                    <div className="flex items-start gap-3 mb-2">
                      <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0", isSuperseded ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")}>
                        <FileText className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn("font-bold text-sm leading-tight break-words", isSuperseded && "line-through text-muted-foreground")}>{doc.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 break-words">{formatBytes(doc.fileSize)} · By {doc.uploaderName}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mb-2.5">
                      <span className="font-mono bg-muted px-2 py-0.5 rounded text-xs font-bold">{docRev(doc)}</span>
                      {isSuperseded
                        ? <Badge variant="destructive" className="text-[10px]"><AlertTriangle className="w-3 h-3 mr-1"/>SUPERSEDED</Badge>
                        : <Badge variant="success" className="text-[10px]">CURRENT</Badge>
                      }
                      {doc.newRevisionNotShared && (
                        <button type="button" onClick={() => setSharingDoc({ type: "document", id: doc.id, name: doc.name, version: doc.version, fileUrl: doc.fileUrl })}
                          title="The revision this replaced was shared on the Team Portal. This one has reached nobody yet."
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-amber-300 bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800 text-[10px] font-semibold hover:bg-amber-200 transition-colors">
                          <AlertTriangle className="w-3 h-3" />Not shared yet: share
                        </button>
                      )}
                      {cadBadge && <span className="font-mono bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 px-2 py-0.5 rounded text-[10px] font-bold">{cadBadge}</span>}
                      <span className="text-xs text-muted-foreground">{DOCUMENT_TYPE_LABELS[doc.type] ?? doc.type.replaceAll("_", " ")}</span>
                      <span className="text-xs text-muted-foreground">· {formatDate(doc.createdAt)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs mb-3">
                      <span className="flex items-center gap-1 text-success" title="Signed with their PIN"><ShieldCheck className="w-3.5 h-3.5"/> {doc.distributionSummary.signedWithPin ?? 0} with PIN</span>
                      <span className="flex items-center gap-1 text-muted-foreground" title="Acknowledged without a PIN"><CheckCircle2 className="w-3.5 h-3.5"/> {doc.distributionSummary.acknowledged - (doc.distributionSummary.signedWithPin ?? 0)} no PIN</span>
                      <span className="flex items-center gap-1 text-primary"><Eye className="w-3.5 h-3.5"/> {doc.distributionSummary.viewed} viewed</span>
                      <span className="flex items-center gap-1 text-muted-foreground"><EyeOff className="w-3.5 h-3.5"/> {doc.distributionSummary.pending} pending</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {!isSuperseded && (doc.myDistributionStatus === "pending" || doc.myDistributionStatus === "viewed") && (
                        <button
                          onClick={() => doc.myDistributionStatus === "pending" ? openAndRecord(doc) : openSignOff({ id: doc.id, name: doc.name, type: doc.type, pinRequired: doc.pinRequired ?? true })}
                          className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-xs font-semibold"
                        >
                          <ClipboardCheck className="w-3 h-3" />{doc.myDistributionStatus === "pending" ? "Open to sign off" : "Sign off"}
                        </button>
                      )}
                      {doc.myDistributionStatus === "acknowledged" && (
                        <SignatureMark withPin={doc.mySignedOffWithPin} className="text-xs" />
                      )}
                      <button
                        onClick={() => openAndRecord(doc)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/25 bg-primary/5 text-primary text-xs font-medium hover:bg-primary/15 transition-colors"
                      >
                        {cadBadge ? <><Download className="w-3 h-3" />Download</> : <><ExternalLink className="w-3 h-3" />Open</>}
                      </button>
                      {canViewAudit && (
                        <button onClick={() => setAuditDoc({ id: doc.id, name: doc.name })}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-background text-muted-foreground text-xs font-medium hover:text-foreground hover:bg-muted transition-colors">
                          <Clock className="w-3 h-3" />History
                        </button>
                      )}
                      {doc.type === "drawing" && (
                        <button onClick={() => openRevHistory({ id: doc.id, name: doc.name })}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-background text-muted-foreground text-xs font-medium hover:text-foreground hover:bg-muted transition-colors">
                          <History className="w-3 h-3" />Revisions
                        </button>
                      )}
                      <button onClick={() => openDocEdit(doc)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-background text-muted-foreground text-xs font-medium hover:text-foreground hover:bg-muted transition-colors">
                        <Pencil className="w-3 h-3" />Edit
                      </button>
                      <button onClick={() => setSharingDoc({ type: "document", id: doc.id, name: doc.name, version: doc.version, fileUrl: doc.fileUrl })}
                        title="Email, WhatsApp, or distribute a tracked copy to specific people/trades via the Team Portal"
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-background text-muted-foreground text-xs font-medium hover:text-foreground hover:bg-muted transition-colors">
                        <Share2 className="w-3 h-3" />Share
                      </button>
                    </div>
                  </div>
                );
              })}
              {documents !== undefined && (documents ?? []).filter(d =>
                (selectedDocType === 'all' || d.type === selectedDocType) &&
                (selectedStatus === 'all' || d.status === selectedStatus) &&
                (searchQuery === '' || d.name.toLowerCase().includes(searchQuery.toLowerCase()))
              ).length === 0 && (
                <div className="px-6 py-12 text-center text-muted-foreground">
                  {documents.length === 0 ? 'No documents uploaded yet.' : 'No documents match your filters.'}
                </div>
              )}
            </div>
            {/* Desktop table (1280px+) */}
            <div className="hidden xl:block overflow-x-auto">
            <table className="w-full text-sm text-left min-w-[800px]">
              <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b">
                <tr>
                  <th className="px-6 py-4 font-semibold">Document</th>
                  <th className="px-6 py-4 font-semibold">Type</th>
                  <th className="px-6 py-4 font-semibold">Status / Ver</th>
                  <th className="px-6 py-4 font-semibold">Distribution</th>
                  <th className="px-6 py-4 font-semibold">Date</th>
                  <th className="px-6 py-4" />
                </tr>
              </thead>
              <tbody>
                {documents?.filter(d =>
                  (selectedDocType === 'all' || d.type === selectedDocType) &&
                  (selectedStatus === 'all' || d.status === selectedStatus) &&
                  (searchQuery === '' || d.name.toLowerCase().includes(searchQuery.toLowerCase()))
                ).map(doc => {
                  const isSuperseded = doc.status === 'superseded';
                  return (
                    <tr key={doc.id} className={cn("border-b transition-colors", isSuperseded ? "bg-muted/30 opacity-70" : "hover:bg-muted/10")}>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center shrink-0", isSuperseded ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")}>
                            <FileText className="w-5 h-5" />
                          </div>
                          <div>
                            <p className={cn("font-bold text-base", isSuperseded ? "line-through text-muted-foreground" : "text-foreground")}>{doc.name}</p>
                            <p className="text-xs text-muted-foreground">{formatBytes(doc.fileSize)} • By {doc.uploaderName}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">{DOCUMENT_TYPE_LABELS[doc.type] ?? doc.type.replaceAll("_", " ")}</td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono bg-muted px-2 py-0.5 rounded text-xs font-bold">{docRev(doc)}</span>
                          {isSuperseded ? (
                            <Badge variant="destructive" className="text-[10px]"><AlertTriangle className="w-3 h-3 mr-1"/> SUPERSEDED</Badge>
                          ) : (
                            <Badge variant="success" className="text-[10px]">CURRENT</Badge>
                          )}
                          {doc.newRevisionNotShared && (
                            <button type="button" onClick={() => setSharingDoc({ type: "document", id: doc.id, name: doc.name, version: doc.version, fileUrl: doc.fileUrl })}
                              title="The revision this replaced was shared on the Team Portal. This one has reached nobody yet."
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-amber-300 bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800 text-[10px] font-semibold hover:bg-amber-200 transition-colors">
                              <AlertTriangle className="w-3 h-3" />Not shared yet: share
                            </button>
                          )}
                          {cadBadgeLabel(doc.fileUrl, doc.name) && <span className="font-mono bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 px-2 py-0.5 rounded text-[10px] font-bold">{cadBadgeLabel(doc.fileUrl, doc.name)}</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          <div className="flex items-center gap-1 text-success" title="Signed with their PIN"><ShieldCheck className="w-4 h-4"/> {doc.distributionSummary.signedWithPin ?? 0}</div>
                          <div className="flex items-center gap-1 text-muted-foreground" title="Acknowledged without a PIN"><CheckCircle2 className="w-4 h-4"/> {doc.distributionSummary.acknowledged - (doc.distributionSummary.signedWithPin ?? 0)}</div>
                          <div className="flex items-center gap-1 text-primary"><Eye className="w-4 h-4"/> {doc.distributionSummary.viewed}</div>
                          <div className="flex items-center gap-1 text-muted-foreground"><EyeOff className="w-4 h-4"/> {doc.distributionSummary.pending}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground">
                        {formatDate(doc.createdAt)}
                      </td>
                      <td className="px-3 py-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {!isSuperseded && (doc.myDistributionStatus === "pending" || doc.myDistributionStatus === "viewed") && (
                            <button
                              onClick={() => doc.myDistributionStatus === "pending" ? openAndRecord(doc) : openSignOff({ id: doc.id, name: doc.name, type: doc.type, pinRequired: doc.pinRequired ?? true })}
                              className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-xs font-semibold"
                              title={doc.myDistributionStatus === "pending" ? "Open it first: you can sign off once you've opened it" : "Sign off this document"}
                            >
                              <ClipboardCheck className="w-3.5 h-3.5" />
                              {doc.myDistributionStatus === "pending" ? "Open to sign off" : "Sign off"}
                            </button>
                          )}
                          {doc.myDistributionStatus === "acknowledged" && (
                            <SignatureMark withPin={doc.mySignedOffWithPin} iconOnly className="text-xs" />
                          )}
                          <button
                            type="button"
                            onClick={() => openAndRecord(doc)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-primary/25 bg-primary/5 text-primary text-xs font-medium hover:bg-primary/15 transition-colors"
                            title={cadBadgeLabel(doc.fileUrl, doc.name) ? "Download document" : "Open document"}
                          >
                            {cadBadgeLabel(doc.fileUrl, doc.name)
                              ? <><Download className="w-3.5 h-3.5" />Download</>
                              : <><ExternalLink className="w-3.5 h-3.5" />Open</>}
                          </button>
                          {canViewAudit && (
                            <button
                              type="button"
                              onClick={() => setAuditDoc({ id: doc.id, name: doc.name })}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-background text-muted-foreground text-xs font-medium hover:text-foreground hover:bg-muted transition-colors"
                              title="View sign-off audit history"
                            >
                              <Clock className="w-3.5 h-3.5" />History
                            </button>
                          )}
                          {doc.type === "drawing" && (
                            <button
                              type="button"
                              onClick={() => openRevHistory({ id: doc.id, name: doc.name })}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-background text-muted-foreground text-xs font-medium hover:text-foreground hover:bg-muted transition-colors"
                              title="Revision history"
                            >
                              <History className="w-3.5 h-3.5" />Revisions
                            </button>
                          )}
                          {caps.canUploadDocument && (
                            <button
                              type="button"
                              onClick={() => openDocEdit(doc)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-background text-muted-foreground text-xs font-medium hover:text-foreground hover:bg-muted transition-colors"
                              title="Edit status / version"
                            >
                              <Pencil className="w-3.5 h-3.5" />Edit
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setSharingDoc({ type: "document", id: doc.id, name: doc.name, version: doc.version, fileUrl: doc.fileUrl })}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-background text-muted-foreground text-xs font-medium hover:text-foreground hover:bg-muted transition-colors"
                            title="Email, WhatsApp, or distribute a tracked copy to specific people/trades via the Team Portal"
                          >
                            <Share2 className="w-3.5 h-3.5" />Share
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {documents !== undefined && documents.filter(d =>
                  (selectedDocType === 'all' || d.type === selectedDocType) &&
                  (selectedStatus === 'all' || d.status === selectedStatus) &&
                  (searchQuery === '' || d.name.toLowerCase().includes(searchQuery.toLowerCase()))
                ).length === 0 && (
                  <tr><td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                    {documents.length === 0 ? 'No documents uploaded yet.' : 'No documents match your filters.'}
                  </td></tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
        </TabsContent>
        {viewing && (
          <DocumentViewer
            doc={viewing}
            recordOpen={recordViewerOpen}
            signOff={viewerSignOff}
            pinRequired={viewing.pinRequired}
            onClose={() => setViewing(null)}
          />
        )}
    </>
  );
}
