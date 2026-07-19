import { useState, useEffect, useRef, useCallback } from "react";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ShareModal } from "@/components/share-modal";
import {
  ShieldAlert, ShieldX, FileSignature, Search,
  CheckCircle2, Upload, FileText, AlertTriangle, Loader2, Calendar,
  ExternalLink, Share2, Archive, ChevronDown, ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCapabilities } from "@/hooks/use-capabilities";

type InsuranceItem = { subcontractorId: string; subcontractorName: string; insuranceType: string; expiryDate: string; status: string; certificateUrl?: string | null };
type ArchivedInsuranceItem = { id: string; subcontractorId: string; subcontractorName: string; insuranceType: string; expiryDate: string; certificateUrl?: string | null; archivedAt: string };
type CertItem = { id: string; personId: string; personName: string; certName: string; expiryDate: string; status: string; documentUrl?: string | null };
type ArchivedCertItem = { id: string; personId: string; personName: string; certName: string; expiryDate: string; documentUrl?: string | null; archivedAt: string };
type PermitItem = { permitId: string; projectId: string; projectName: string; permitType: string; expiryDate: string; status: string; documentUrl?: string | null };
type ArchivedPermitItem = { id: string; projectId: string; projectName: string; permitType: string; expiryDate: string; documentUrl?: string | null; archivedAt: string };
type ArchivedDocItem = { id: string; name: string; type: string; version: number; fileUrl: string; projectId: string; projectName: string; createdAt: string };
type AckItem = { documentId: string; documentName: string; projectId: string; projectName: string; pendingCount: number; fileUrl?: string | null };
type Sub = { id: string; companyName: string; contactName: string };
type Project = { id: string; name: string };
type ContactProject = { id: string; name: string };

const DOCUMENT_TYPES = [
  { value: "insurance_certificate", label: "Insurance Certificate" },
  { value: "method_statement",      label: "Method Statement" },
  { value: "risk_assessment",       label: "Risk Assessment" },
  { value: "permit",                label: "Permit to Work" },
  { value: "certificate",           label: "Compliance Certificate" },
  { value: "drawing",               label: "Drawing" },
  { value: "safety",                label: "Safety Document" },
  { value: "general",               label: "Other" },
];

const INSURANCE_SUBTYPES = [
  { value: "public_liability",       label: "Public Liability" },
  { value: "employers_liability",    label: "Employer's Liability" },
  { value: "professional_indemnity", label: "Professional Indemnity" },
  { value: "contractors_all_risk",   label: "Contractor's All Risk" },
  { value: "other",                  label: "Other" },
];

function daysLeft(dateStr: string) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.ceil((new Date(dateStr + "T00:00:00").getTime() - today.getTime()) / 86400000);
}

function fmtDate(s: string) {
  return new Date(s + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function ExpiryBadge({ days }: { days: number }) {
  if (days < 0) return <Badge variant="destructive" className="text-[10px]">Expired</Badge>;
  if (days <= 7) return <Badge className="text-[10px] bg-orange-100 text-orange-700 border-orange-200">Expires in {days}d</Badge>;
  return <Badge className="text-[10px] bg-yellow-100 text-yellow-700 border-yellow-200">Expires in {days}d</Badge>;
}

export default function CompliancePage() {
  const caps = useCapabilities();
  const [insurance, setInsurance] = useState<InsuranceItem[]>([]);
  const [archivedInsurance, setArchivedInsurance] = useState<ArchivedInsuranceItem[]>([]);
  const [permits, setPermits] = useState<PermitItem[]>([]);
  const [archivedPermits, setArchivedPermits] = useState<ArchivedPermitItem[]>([]);
  const [certifications, setCertifications] = useState<CertItem[]>([]);
  const [archivedCertifications, setArchivedCertifications] = useState<ArchivedCertItem[]>([]);
  const [showArchivedCerts, setShowArchivedCerts] = useState(false);
  const [archivedDocs, setArchivedDocs] = useState<ArchivedDocItem[]>([]);
  const [showArchivedIns, setShowArchivedIns] = useState(false);
  const [showArchivedPermits, setShowArchivedPermits] = useState(false);
  const [showArchivedDocs, setShowArchivedDocs] = useState(false);
  const [acks, setAcks] = useState<AckItem[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // ── drag / upload state ──
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);
  const [uploading, setUploading] = useState(false);
  const [droppedFile, setDroppedFile] = useState<{ url: string; name: string } | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignDocType, setAssignDocType] = useState("insurance_certificate");
  const [assignProjectId, setAssignProjectId] = useState("");
  const [assignSubId, setAssignSubId] = useState("");
  const [assignInsSubType, setAssignInsSubType] = useState("public_liability");
  const [assignExpiry, setAssignExpiry] = useState("");
  const [contactProjects, setContactProjects] = useState<ContactProject[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignSuccess, setAssignSuccess] = useState(false);
  const [rowHoverId, setRowHoverId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  type ShareItem = { entityType: string; entityId: string; entityName: string; fileUrl?: string | null; projectId?: string | null };
  const [shareItem, setShareItem] = useState<ShareItem | null>(null);

  const loadCompliance = useCallback(() => {
    const token = localStorage.getItem("sitesort_token");
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    fetch("/api/compliance", { headers })
      .then(r => r.ok ? r.json() : { expiringInsurance: [], expiringPermits: [], pendingAcknowledgments: [] })
      .then(d => {
        setInsurance(d.expiringInsurance ?? []);
        setArchivedInsurance(d.archivedInsurance ?? []);
        setPermits(d.expiringPermits ?? []);
        setArchivedPermits(d.archivedPermits ?? []);
        setCertifications(d.expiringCertifications ?? []);
        setArchivedCertifications(d.archivedCertifications ?? []);
        setAcks(d.pendingAcknowledgments ?? []);
        setArchivedDocs(d.archivedDocuments ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadCompliance();
    const token = localStorage.getItem("sitesort_token");
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    fetch("/api/subcontractors", { headers }).then(r => r.ok ? r.json() : []).then(setSubs);
    fetch("/api/projects", { headers }).then(r => r.ok ? r.json() : [])
      .then((all: any[]) => setProjects(all.filter(p => p.status === "active").map(p => ({ id: p.id, name: p.name }))));
  }, [loadCompliance]);

  // When contact changes, fetch which projects they're linked to
  useEffect(() => {
    if (!assignSubId || assignDocType !== "insurance_certificate") { setContactProjects([]); return; }
    const token = localStorage.getItem("sitesort_token");
    fetch(`/api/subcontractors/${assignSubId}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.ok ? r.json() : null)
      .then(d => setContactProjects(d?.assignedProjects ?? []));
  }, [assignSubId, assignDocType]);

  const [highlightUpload, setHighlightUpload] = useState(false);
  const [highlightSection, setHighlightSection] = useState<"insurance" | "permits" | "signoffs" | null>(null);

  // ── URL param handling ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("upload") === "1") {
      if (caps.isLoading) return;
      window.history.replaceState({}, "", "/compliance");
      if (caps.canManageCompliance) {
        setHighlightUpload(true);
        setTimeout(() => setHighlightUpload(false), 4000);
      }
    } else if (params.get("q")) {
      const term = params.get("q")!;
      window.history.replaceState({}, "", "/compliance");
      setSearch(term);
    }
  }, [caps.isLoading, caps.canManageCompliance]);

  // Deep-link to a section: ?filter=expiring(&kind=permit|insurance) or ?filter=signoffs.
  // Scrolls the relevant section into view and briefly highlights it.
  useEffect(() => {
    if (loading) return;
    const params = new URLSearchParams(window.location.search);
    const filter = params.get("filter");
    const kind = params.get("kind");
    let target: "insurance" | "permits" | "signoffs" | null = null;
    if (filter === "signoffs") target = "signoffs";
    else if (filter === "expiring") target = kind === "permit" ? "permits" : "insurance";
    if (!target) return;
    window.history.replaceState({}, "", "/compliance");
    setHighlightSection(target);
    setTimeout(() => document.getElementById(`section-${target}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    setTimeout(() => setHighlightSection(null), 2600);
  }, [loading]);

  // ── file upload ──
  const uploadFile = useCallback(async (file: File, prefilledSubId?: string) => {
    setUploading(true);
    try {
      const token = localStorage.getItem("sitesort_token");
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      setDroppedFile({ url: data.url, name: file.name });
      setAssignDocType("insurance_certificate");
      setAssignProjectId("");
      setAssignSubId(prefilledSubId ?? "");
      setAssignInsSubType("public_liability");
      setAssignExpiry("");
      setContactProjects([]);
      setAssignError(null);
      setAssignSuccess(false);
      setAssignOpen(true);
    } catch {
      // silently ignore upload errors — user will see nothing happened
    } finally {
      setUploading(false);
    }
  }, []);

  // ── global drag events (manager-only upload) ──
  useEffect(() => {
    if (!caps.canManageCompliance) return;
    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      dragCounter.current++;
      setIsDragOver(true);
    };
    const onDragLeave = () => {
      dragCounter.current--;
      if (dragCounter.current <= 0) { dragCounter.current = 0; setIsDragOver(false); }
    };
    const onDragOver = (e: DragEvent) => { e.preventDefault(); };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsDragOver(false);
      setRowHoverId(null);
      const file = e.dataTransfer?.files[0];
      if (file) uploadFile(file, rowHoverId ?? undefined);
    };
    const onPaste = (e: ClipboardEvent) => {
      const file = e.clipboardData?.files[0];
      if (file) { e.preventDefault(); uploadFile(file); }
    };
    document.addEventListener("dragenter", onDragEnter);
    document.addEventListener("dragleave", onDragLeave);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("dragenter", onDragEnter);
      document.removeEventListener("dragleave", onDragLeave);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
      document.removeEventListener("paste", onPaste);
    };
  }, [uploadFile, rowHoverId, caps.canManageCompliance]);

  // ── assign uploaded file ──
  const assignFile = async () => {
    if (!droppedFile) return;
    const token = localStorage.getItem("sitesort_token");
    const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };

    if (assignDocType === "insurance_certificate") {
      if (!assignSubId || !assignExpiry) {
        setAssignError("Please select a contact and set an expiry date.");
        return;
      }
      setAssigning(true); setAssignError(null);
      try {
        const res = await fetch(`/api/subcontractors/${assignSubId}/insurance`, {
          method: "POST", headers,
          body: JSON.stringify({ type: assignInsSubType, certificateUrl: droppedFile.url, expiryDate: assignExpiry }),
        });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message ?? "Save failed"); }
        setAssignSuccess(true);
        setTimeout(() => { setAssignOpen(false); setDroppedFile(null); setAssignSuccess(false); loadCompliance(); }, 2000);
      } catch (e: any) {
        setAssignError(e.message ?? "Failed to save. Please try again.");
      } finally { setAssigning(false); }
    } else {
      if (!assignProjectId) {
        setAssignError("Please select a project.");
        return;
      }
      setAssigning(true); setAssignError(null);
      try {
        const res = await fetch(`/api/projects/${assignProjectId}/documents`, {
          method: "POST", headers,
          body: JSON.stringify({ name: droppedFile.name, type: assignDocType, fileUrl: droppedFile.url }),
        });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message ?? "Save failed"); }
        setAssignSuccess(true);
        setTimeout(() => { setAssignOpen(false); setDroppedFile(null); setAssignSuccess(false); loadCompliance(); }, 1500);
      } catch (e: any) {
        setAssignError(e.message ?? "Failed to save. Please try again.");
      } finally { setAssigning(false); }
    }
  };

  const q = search.toLowerCase();
  const filteredIns = insurance.filter(i => !q || i.subcontractorName.toLowerCase().includes(q) || i.insuranceType.toLowerCase().includes(q));
  const filteredPermits = permits.filter(p => !q || p.projectName.toLowerCase().includes(q) || p.permitType.toLowerCase().includes(q));
  const filteredCerts = certifications.filter(c => !q || c.personName.toLowerCase().includes(q) || c.certName.toLowerCase().includes(q));
  const filteredAcks = acks.filter(a => !q || a.documentName.toLowerCase().includes(q) || a.projectName.toLowerCase().includes(q));
  const totalIssues = insurance.length + permits.length + acks.length;

  return (
    <SidebarLayout>
      {/* ── Global drag overlay ── */}
      {isDragOver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="absolute inset-0 bg-primary/10 backdrop-blur-sm" />
          <div className="relative bg-card border-4 border-dashed border-primary rounded-2xl px-16 py-12 text-center shadow-2xl">
            <Upload className="w-16 h-16 text-primary mx-auto mb-4 animate-bounce" />
            <h2 className="text-2xl font-bold text-primary">Drop to upload</h2>
            <p className="text-muted-foreground mt-2">Insurance certificate, permit or compliance document</p>
          </div>
        </div>
      )}

      {/* ── Upload spinner overlay ── */}
      {uploading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm">
          <div className="bg-card border rounded-2xl p-8 flex flex-col items-center gap-4 shadow-xl">
            <Loader2 className="w-10 h-10 text-primary animate-spin" />
            <p className="font-semibold text-muted-foreground">Uploading file…</p>
          </div>
        </div>
      )}

      <PageHeader
        className="mb-6"
        title="Compliance Centre"
        description="Expiring insurance, permits and pending sign-offs across all projects."
        actions={!loading && (
          <span className={cn("text-sm font-semibold px-3 py-1.5 rounded-full border whitespace-nowrap",
            totalIssues === 0 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-orange-50 text-orange-700 border-orange-200"
          )}>
            {totalIssues === 0 ? "✓ All clear" : `${totalIssues} item${totalIssues !== 1 ? "s" : ""} need attention`}
          </span>
        )}
      />

      {/* ── Upload tip banner (manager-only) ── */}
      {caps.canManageCompliance && (
        <div
          className={cn(
            "flex items-center gap-3 p-4 mb-6 border rounded-xl text-sm cursor-pointer transition-all",
            highlightUpload
              ? "bg-primary/15 border-primary shadow-lg shadow-primary/20 animate-pulse ring-2 ring-primary/40"
              : "bg-primary/5 border-primary/20 hover:bg-primary/10"
          )}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className={cn("w-5 h-5 shrink-0", highlightUpload ? "text-primary" : "text-primary")} />
          <p className="text-muted-foreground flex-1">
            {highlightUpload
              ? <span className="font-semibold text-primary">Tap here to select your compliance document</span>
              : <><span className="font-semibold text-foreground">Drag &amp; drop</span> insurance certs or documents from your desktop, email or WhatsApp — or{" "}<span className="text-primary underline font-medium">browse files</span>. Paste (⌘V) also works.</>
            }
          </p>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }}
          />
        </div>
      )}

      {/* ── Search ── */}
      <div className="relative max-w-sm mb-8">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search by name, project or type…"
          className="pl-9"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="space-y-4">{[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)}</div>
      ) : (
        <div className="space-y-8">

          {/* ── Expiring Insurance ── */}
          <section id="section-insurance" className={cn("scroll-mt-24 rounded-xl transition-shadow", highlightSection === "insurance" && "ring-2 ring-primary ring-offset-4")}>
            <div className="flex items-center gap-2 mb-3">
              <ShieldAlert className="w-5 h-5 text-yellow-600" />
              <h2 className="font-bold text-lg">Expiring Insurance</h2>
              <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{filteredIns.length}</span>
            </div>
            {filteredIns.length === 0 ? (
              <Card className="p-8 text-center border-dashed border-2">
                <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500 mb-2" />
                <p className="text-muted-foreground text-sm">{q ? "No results." : "No insurance expiring in the next 30 days."}</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {[...filteredIns].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)).map(ins => {
                  const rowId = ins.subcontractorId;
                  const isHovered = rowHoverId === rowId;
                  const days = daysLeft(ins.expiryDate);
                  return (
                    <div
                      key={`${ins.subcontractorId}-${ins.insuranceType}`}
                      onDragEnter={() => setRowHoverId(rowId)}
                      onDragLeave={() => setRowHoverId(null)}
                      className={cn(
                        "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 px-4 py-3 rounded-xl border transition-all",
                        isHovered
                          ? "border-primary bg-primary/5 scale-[1.01] shadow-md"
                          : days < 0 ? "bg-red-50 border-red-200"
                          : days <= 7 ? "bg-orange-50 border-orange-200"
                          : "bg-yellow-50 border-yellow-200"
                      )}>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate">{ins.subcontractorName}</p>
                        <p className="text-xs text-muted-foreground capitalize">{ins.insuranceType.replace(/_/g, " ")}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {isHovered ? (
                          <span className="text-xs font-semibold text-primary flex items-center gap-1">
                            <Upload className="w-3.5 h-3.5" /> Drop to update certificate
                          </span>
                        ) : (
                          <>
                            <p className="text-xs text-muted-foreground">{fmtDate(ins.expiryDate)}</p>
                            <ExpiryBadge days={days} />
                            {ins.certificateUrl && (
                              <>
                                <button
                                  onClick={() => window.open(ins.certificateUrl!.replace(/^\/uploads\//, "/api/uploads/"), '_blank', 'noopener,noreferrer')}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-800 text-white text-xs font-medium hover:bg-gray-700 transition-colors"
                                  title="Open certificate"
                                >
                                  <ExternalLink className="w-3 h-3" /> Open
                                </button>
                                <button
                                  onClick={() => setShareItem({ entityType: "insurance", entityId: ins.subcontractorId, entityName: `${ins.subcontractorName} – ${ins.insuranceType.replace(/_/g, " ")}`, fileUrl: ins.certificateUrl })}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-800 text-white text-xs font-medium hover:bg-gray-700 transition-colors"
                                  title="Share certificate"
                                >
                                  <Share2 className="w-3 h-3" /> Share
                                </button>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── Archived Insurance ── */}
          {archivedInsurance.length > 0 && (
            <section>
              <button
                onClick={() => setShowArchivedIns(v => !v)}
                className="flex items-center gap-2 mb-3 text-muted-foreground hover:text-foreground transition-colors w-full text-left"
              >
                <Archive className="w-4 h-4" />
                <span className="font-semibold text-sm">Superseded Insurance Certificates</span>
                <span className="text-xs bg-muted px-2 py-0.5 rounded-full">{archivedInsurance.length}</span>
                {showArchivedIns ? <ChevronUp className="w-4 h-4 ml-auto" /> : <ChevronDown className="w-4 h-4 ml-auto" />}
              </button>
              {showArchivedIns && (
                <div className="space-y-2">
                  {[...archivedInsurance].sort((a, b) => b.archivedAt.localeCompare(a.archivedAt)).map(ins => (
                    <div key={ins.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 px-4 py-3 rounded-xl border bg-muted/40 border-border opacity-80">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate">{ins.subcontractorName}</p>
                        <p className="text-xs text-muted-foreground capitalize truncate">{ins.insuranceType.replace(/_/g, " ")} · expired {fmtDate(ins.expiryDate)} · archived {new Date(ins.archivedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                      </div>
                      {ins.certificateUrl && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => window.open(ins.certificateUrl!.replace(/^\/uploads\//, "/api/uploads/"), "_blank", "noopener,noreferrer")}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-800 text-white text-xs font-medium hover:bg-gray-700 transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" /> Open
                          </button>
                          <button
                            onClick={() => setShareItem({ entityType: "insurance", entityId: ins.id, entityName: `${ins.subcontractorName} – ${ins.insuranceType.replace(/_/g, " ")}`, fileUrl: ins.certificateUrl })}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-800 text-white text-xs font-medium hover:bg-gray-700 transition-colors"
                          >
                            <Share2 className="w-3 h-3" /> Share
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* ── Expiring Certifications ── */}
          <section id="section-certifications" className="rounded-xl">
            <div className="flex items-center gap-2 mb-3">
              <ShieldAlert className="w-5 h-5 text-yellow-600" />
              <h2 className="font-bold text-lg">Expiring Certifications</h2>
              <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{filteredCerts.length}</span>
            </div>
            {filteredCerts.length === 0 ? (
              <Card className="p-8 text-center border-dashed border-2">
                <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500 mb-2" />
                <p className="text-muted-foreground text-sm">{q ? "No results." : "No certifications expiring in the next 30 days."}</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {[...filteredCerts].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)).map(c => {
                  const days = daysLeft(c.expiryDate);
                  return (
                    <div key={c.id} className={cn(
                      "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 px-4 py-3 rounded-xl border transition-all",
                      days < 0 ? "bg-red-50 border-red-200" : days <= 7 ? "bg-orange-50 border-orange-200" : "bg-yellow-50 border-yellow-200"
                    )}>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate">{c.personName}</p>
                        <p className="text-xs text-muted-foreground truncate">{c.certName}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs text-muted-foreground">{fmtDate(c.expiryDate)}</p>
                        <ExpiryBadge days={days} />
                        {c.documentUrl && (
                          <>
                            <button
                              onClick={() => window.open(c.documentUrl!.replace(/^\/uploads\//, "/api/uploads/"), '_blank', 'noopener,noreferrer')}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-800 text-white text-xs font-medium hover:bg-gray-700 transition-colors"
                              title="Open document"
                            >
                              <ExternalLink className="w-3 h-3" /> Open
                            </button>
                            <button
                              onClick={() => setShareItem({ entityType: "person_certification", entityId: c.id, entityName: `${c.personName} – ${c.certName}`, fileUrl: c.documentUrl })}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-800 text-white text-xs font-medium hover:bg-gray-700 transition-colors"
                              title="Share"
                            >
                              <Share2 className="w-3 h-3" /> Share
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── Archived Certifications ── */}
          {archivedCertifications.length > 0 && (
            <section>
              <button
                onClick={() => setShowArchivedCerts(v => !v)}
                className="flex items-center gap-2 mb-3 text-muted-foreground hover:text-foreground transition-colors w-full text-left"
              >
                <Archive className="w-4 h-4" />
                <span className="font-semibold text-sm">Superseded Certifications</span>
                <span className="text-xs bg-muted px-2 py-0.5 rounded-full">{archivedCertifications.length}</span>
                {showArchivedCerts ? <ChevronUp className="w-4 h-4 ml-auto" /> : <ChevronDown className="w-4 h-4 ml-auto" />}
              </button>
              {showArchivedCerts && (
                <div className="space-y-2">
                  {[...archivedCertifications].sort((a, b) => b.archivedAt.localeCompare(a.archivedAt)).map(c => (
                    <div key={c.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 px-4 py-3 rounded-xl border bg-muted/40 border-border opacity-80">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate">{c.personName}</p>
                        <p className="text-xs text-muted-foreground truncate">{c.certName} · expired {fmtDate(c.expiryDate)} · archived {new Date(c.archivedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                      </div>
                      {c.documentUrl && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => window.open(c.documentUrl!.replace(/^\/uploads\//, "/api/uploads/"), "_blank", "noopener,noreferrer")}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-800 text-white text-xs font-medium hover:bg-gray-700 transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" /> Open
                          </button>
                          <button
                            onClick={() => setShareItem({ entityType: "person_certification", entityId: c.id, entityName: `${c.personName} – ${c.certName}`, fileUrl: c.documentUrl })}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-800 text-white text-xs font-medium hover:bg-gray-700 transition-colors"
                          >
                            <Share2 className="w-3 h-3" /> Share
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* ── Expiring Permits ── */}
          <section id="section-permits" className={cn("scroll-mt-24 rounded-xl transition-shadow", highlightSection === "permits" && "ring-2 ring-primary ring-offset-4")}>
            <div className="flex items-center gap-2 mb-3">
              <ShieldX className="w-5 h-5 text-orange-600" />
              <h2 className="font-bold text-lg">Expiring Permits</h2>
              <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{filteredPermits.length}</span>
            </div>
            {filteredPermits.length === 0 ? (
              <Card className="p-8 text-center border-dashed border-2">
                <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500 mb-2" />
                <p className="text-muted-foreground text-sm">{q ? "No results." : "No permits expiring in the next 30 days."}</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {[...filteredPermits].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)).map(p => {
                  const days = daysLeft(p.expiryDate);
                  return (
                    <div key={p.permitId}
                      className={cn("flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 px-4 py-3 rounded-xl border",
                        days < 0 ? "bg-red-50 border-red-200" : days <= 7 ? "bg-orange-50 border-orange-200" : "bg-yellow-50 border-yellow-200"
                      )}>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate">{p.permitType}</p>
                        <p className="text-xs text-muted-foreground truncate">{p.projectName}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs text-muted-foreground">{fmtDate(p.expiryDate)}</p>
                        <ExpiryBadge days={days} />
                        {p.documentUrl && (() => {
                          const norm = p.documentUrl!.replace(/^\/uploads\//, "/api/uploads/");
                          const certUrl = norm.startsWith("http") ? norm : `${window.location.origin}${norm}`;
                          return (
                            <button
                              onClick={() => window.open(certUrl, "_blank", "noopener,noreferrer")}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-800 text-white text-xs font-medium hover:bg-gray-700 transition-colors"
                              title="Open certificate"
                            >
                              <ExternalLink className="w-3 h-3" /> Certificate
                            </button>
                          );
                        })()}
                        <button
                          onClick={() => setShareItem({ entityType: "permit", entityId: p.permitId, entityName: `${p.permitType} – ${p.projectName}`, fileUrl: p.documentUrl, projectId: p.projectId })}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-800 text-white text-xs font-medium hover:bg-gray-700 transition-colors"
                          title="Share permit"
                        >
                          <Share2 className="w-3 h-3" /> Share
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── Superseded Permits ── */}
          {archivedPermits.length > 0 && (
            <section>
              <button
                onClick={() => setShowArchivedPermits(v => !v)}
                className="flex items-center gap-2 mb-3 text-muted-foreground hover:text-foreground transition-colors w-full text-left"
              >
                <Archive className="w-4 h-4" />
                <span className="font-semibold text-sm">Superseded Permits</span>
                <span className="text-xs bg-muted px-2 py-0.5 rounded-full">{archivedPermits.length}</span>
                {showArchivedPermits ? <ChevronUp className="w-4 h-4 ml-auto" /> : <ChevronDown className="w-4 h-4 ml-auto" />}
              </button>
              {showArchivedPermits && (
                <div className="space-y-2">
                  {[...archivedPermits].sort((a, b) => b.archivedAt.localeCompare(a.archivedAt)).map(p => (
                    <div key={p.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 px-4 py-3 rounded-xl border bg-muted/40 border-border opacity-80">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate">{p.permitType}</p>
                        <p className="text-xs text-muted-foreground truncate">{p.projectName} · expired {fmtDate(p.expiryDate)} · archived {new Date(p.archivedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                      </div>
                      {p.documentUrl && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { const norm = p.documentUrl!.replace(/^\/uploads\//, "/api/uploads/"); window.open(norm.startsWith("http") ? norm : `${window.location.origin}${norm}`, "_blank", "noopener,noreferrer"); }}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-800 text-white text-xs font-medium hover:bg-gray-700 transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" /> Open
                          </button>
                          <button
                            onClick={() => setShareItem({ entityType: "permit", entityId: p.id, entityName: `${p.permitType} – ${p.projectName}`, fileUrl: p.documentUrl, projectId: p.projectId })}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-800 text-white text-xs font-medium hover:bg-gray-700 transition-colors"
                          >
                            <Share2 className="w-3 h-3" /> Share
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* ── Pending Sign-offs ── */}
          <section id="section-signoffs" className={cn("scroll-mt-24 rounded-xl transition-shadow", highlightSection === "signoffs" && "ring-2 ring-primary ring-offset-4")}>
            <div className="flex items-center gap-2 mb-3">
              <FileSignature className="w-5 h-5 text-primary" />
              <h2 className="font-bold text-lg">Pending Sign-offs</h2>
              <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{filteredAcks.length}</span>
            </div>
            {filteredAcks.length === 0 ? (
              <Card className="p-8 text-center border-dashed border-2">
                <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500 mb-2" />
                <p className="text-muted-foreground text-sm">{q ? "No results." : "No documents awaiting acknowledgment."}</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {filteredAcks.map(a => (
                  <div key={a.documentId} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 px-4 py-3 rounded-xl border bg-blue-50 border-blue-200">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm truncate">{a.documentName}</p>
                      <p className="text-xs text-muted-foreground truncate">{a.projectName}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className="text-[10px] bg-blue-100 text-blue-700 border-blue-200">{a.pendingCount} pending</Badge>
                      {a.fileUrl && (
                        <button
                          onClick={() => window.open(a.fileUrl!.replace(/^\/uploads\//, "/api/uploads/"), '_blank', 'noopener,noreferrer')}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-800 text-white text-xs font-medium hover:bg-gray-700 transition-colors"
                          title="Open document"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Open
                        </button>
                      )}
                      <button
                        onClick={() => setShareItem({ entityType: "document", entityId: a.documentId, entityName: a.documentName, fileUrl: a.fileUrl, projectId: a.projectId })}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-800 text-white text-xs font-medium hover:bg-gray-700 transition-colors"
                        title="Share document"
                      >
                        <Share2 className="w-3 h-3" /> Share
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── Superseded Documents ── */}
          {archivedDocs.length > 0 && (
            <section>
              <button
                onClick={() => setShowArchivedDocs(v => !v)}
                className="flex items-center gap-2 mb-3 text-muted-foreground hover:text-foreground transition-colors w-full text-left"
              >
                <Archive className="w-4 h-4" />
                <span className="font-semibold text-sm">Superseded Documents</span>
                <span className="text-xs bg-muted px-2 py-0.5 rounded-full">{archivedDocs.length}</span>
                {showArchivedDocs ? <ChevronUp className="w-4 h-4 ml-auto" /> : <ChevronDown className="w-4 h-4 ml-auto" />}
              </button>
              {showArchivedDocs && (
                <div className="space-y-2">
                  {[...archivedDocs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(doc => (
                    <div key={doc.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 px-4 py-3 rounded-xl border bg-muted/40 border-border opacity-80">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate">{doc.name}</p>
                        <p className="text-xs text-muted-foreground capitalize truncate">{doc.type.replace(/_/g, " ")} · v{doc.version} · {doc.projectName}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { const norm = doc.fileUrl.replace(/^\/uploads\//, "/api/uploads/"); window.open(norm.startsWith("http") ? norm : `${window.location.origin}${norm}`, "_blank", "noopener,noreferrer"); }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-800 text-white text-xs font-medium hover:bg-gray-700 transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" /> Open
                        </button>
                        <button
                          onClick={() => setShareItem({ entityType: "document", entityId: doc.id, entityName: doc.name, fileUrl: doc.fileUrl, projectId: doc.projectId })}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-800 text-white text-xs font-medium hover:bg-gray-700 transition-colors"
                        >
                          <Share2 className="w-3 h-3" /> Share
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

        </div>
      )}

      {/* ── Assign / file document modal ── */}
      <Dialog open={assignOpen} onOpenChange={open => { if (!open && !assigning) { setAssignOpen(false); setDroppedFile(null); } }}>
        <DialogHeader>
          <DialogTitle>File this document</DialogTitle>
        </DialogHeader>

        {assignSuccess ? (
          <div className="flex flex-col items-center py-8 gap-3">
            <CheckCircle2 className="w-12 h-12 text-emerald-500" />
            <p className="font-semibold text-emerald-600">
              {assignDocType === "insurance_certificate" ? "Insurance certificate saved" : "Document filed to project"}
            </p>
            {assignDocType === "insurance_certificate" && contactProjects.length > 0 && (
              <div className="w-full space-y-1 pt-2">
                <p className="text-xs text-muted-foreground text-center mb-2">This contact is linked to {contactProjects.length} project{contactProjects.length !== 1 ? "s" : ""}:</p>
                {contactProjects.map(p => (
                  <a key={p.id} href={`/projects/${p.id}`} className="flex items-center justify-between px-3 py-2 rounded-lg border bg-muted/40 hover:bg-muted transition-colors text-sm font-medium">
                    {p.name}
                    <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                  </a>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            {droppedFile && (
              <div className="flex items-center gap-3 px-4 py-3 bg-muted/50 rounded-lg border">
                <FileText className="w-5 h-5 text-primary shrink-0" />
                <p className="text-sm font-medium truncate">{droppedFile.name || "Uploaded file"}</p>
              </div>
            )}

            <div>
              <label className="text-sm font-medium mb-1.5 block">Document Type</label>
              <select
                value={assignDocType}
                onChange={e => { setAssignDocType(e.target.value); setAssignSubId(""); setAssignProjectId(""); setContactProjects([]); }}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {DOCUMENT_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            {assignDocType === "insurance_certificate" ? (
              <>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Contact</label>
                  <select
                    value={assignSubId}
                    onChange={e => setAssignSubId(e.target.value)}
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Select contact…</option>
                    {subs.map(s => (
                      <option key={s.id} value={s.id}>{s.companyName} — {s.contactName}</option>
                    ))}
                  </select>
                  {assignSubId && contactProjects.length > 0 && (
                    <div className="mt-2 space-y-1">
                      <p className="text-xs text-muted-foreground">Linked to {contactProjects.length} project{contactProjects.length !== 1 ? "s" : ""}:</p>
                      {contactProjects.map(p => (
                        <div key={p.id} className="flex items-center justify-between px-3 py-1.5 rounded-md bg-muted/50 border text-xs font-medium">
                          {p.name}
                          <a href={`/projects/${p.id}`} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary">
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-sm font-medium mb-1.5 block">Insurance Type</label>
                  <select
                    value={assignInsSubType}
                    onChange={e => setAssignInsSubType(e.target.value)}
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {INSURANCE_SUBTYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium mb-1.5 block">Expiry Date</label>
                  <Input type="date" value={assignExpiry} onChange={e => setAssignExpiry(e.target.value)} icon={<Calendar className="w-4 h-4" />} />
                </div>
              </>
            ) : (
              <div>
                <label className="text-sm font-medium mb-1.5 block">Project</label>
                <select
                  value={assignProjectId}
                  onChange={e => setAssignProjectId(e.target.value)}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select project…</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}

            {assignError && (
              <p className="flex items-center gap-1.5 text-sm text-destructive">
                <AlertTriangle className="w-4 h-4 shrink-0" />{assignError}
              </p>
            )}
          </div>
        )}

        {!assignSuccess && (
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAssignOpen(false); setDroppedFile(null); }}>Cancel</Button>
            <Button variant="accent" onClick={assignFile} disabled={assigning}>
              {assigning ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</> : assignDocType === "insurance_certificate" ? "Save Certificate" : "File Document"}
            </Button>
          </DialogFooter>
        )}
      </Dialog>

      <ShareModal
        open={!!shareItem}
        onClose={() => setShareItem(null)}
        entityType={shareItem?.entityType ?? ""}
        entityId={shareItem?.entityId ?? ""}
        entityName={shareItem?.entityName ?? ""}
        fileUrl={shareItem?.fileUrl}
        projectId={shareItem?.projectId}
      />
    </SidebarLayout>
  );
}
