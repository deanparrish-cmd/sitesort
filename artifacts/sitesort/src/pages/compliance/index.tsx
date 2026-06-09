import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ShieldAlert, ShieldX, FileSignature, Search,
  CheckCircle2, ArrowRight, Upload, FileText, AlertTriangle, Loader2, Calendar,
  ExternalLink, Share2, Mail, MessageCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCapabilities } from "@/hooks/use-capabilities";

type InsuranceItem = { subcontractorId: string; subcontractorName: string; insuranceType: string; expiryDate: string; status: string; certificateUrl?: string | null };
type PermitItem = { permitId: string; projectId: string; projectName: string; permitType: string; expiryDate: string; status: string; documentUrl?: string | null };
type AckItem = { documentId: string; documentName: string; projectId: string; projectName: string; pendingCount: number; fileUrl?: string | null };
type Sub = { id: string; companyName: string; contactName: string };

const INSURANCE_TYPES = [
  { value: "public_liability", label: "Public Liability" },
  { value: "employers_liability", label: "Employer's Liability" },
  { value: "professional_indemnity", label: "Professional Indemnity" },
  { value: "contractors_all_risk", label: "Contractor's All Risk" },
  { value: "other", label: "Other" },
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
  const [permits, setPermits] = useState<PermitItem[]>([]);
  const [acks, setAcks] = useState<AckItem[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // ── drag / upload state ──
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);
  const [uploading, setUploading] = useState(false);
  const [droppedFile, setDroppedFile] = useState<{ url: string; name: string } | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignSubId, setAssignSubId] = useState("");
  const [assignType, setAssignType] = useState("public_liability");
  const [assignExpiry, setAssignExpiry] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignSuccess, setAssignSuccess] = useState(false);
  const [rowHoverId, setRowHoverId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadCompliance = useCallback(() => {
    const token = localStorage.getItem("sitesort_token");
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    fetch("/api/compliance", { headers })
      .then(r => r.ok ? r.json() : { expiringInsurance: [], expiringPermits: [], pendingAcknowledgments: [] })
      .then(d => { setInsurance(d.expiringInsurance ?? []); setPermits(d.expiringPermits ?? []); setAcks(d.pendingAcknowledgments ?? []); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadCompliance();
    const token = localStorage.getItem("sitesort_token");
    fetch("/api/subcontractors", { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.ok ? r.json() : [])
      .then(setSubs);
  }, [loadCompliance]);

  const [highlightUpload, setHighlightUpload] = useState(false);

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
      setAssignSubId(prefilledSubId ?? "");
      setAssignType("public_liability");
      setAssignExpiry("");
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
    if (!droppedFile || !assignSubId || !assignExpiry) {
      setAssignError("Please select a subcontractor and set an expiry date.");
      return;
    }
    setAssigning(true);
    setAssignError(null);
    try {
      const token = localStorage.getItem("sitesort_token");
      const res = await fetch(`/api/subcontractors/${assignSubId}/insurance`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ type: assignType, certificateUrl: droppedFile.url, expiryDate: assignExpiry }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message ?? "Save failed"); }
      setAssignSuccess(true);
      setTimeout(() => {
        setAssignOpen(false);
        setDroppedFile(null);
        setAssignSuccess(false);
        loadCompliance();
      }, 1200);
    } catch (e: any) {
      setAssignError(e.message ?? "Failed to save. Please try again.");
    } finally {
      setAssigning(false);
    }
  };

  const q = search.toLowerCase();
  const filteredIns = insurance.filter(i => !q || i.subcontractorName.toLowerCase().includes(q) || i.insuranceType.toLowerCase().includes(q));
  const filteredPermits = permits.filter(p => !q || p.projectName.toLowerCase().includes(q) || p.permitType.toLowerCase().includes(q));
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

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold">Compliance Centre</h1>
          <p className="text-muted-foreground">Expiring insurance, permits and pending sign-offs across all projects.</p>
        </div>
        {!loading && (
          <span className={cn("text-sm font-semibold px-3 py-1.5 rounded-full border",
            totalIssues === 0 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-orange-50 text-orange-700 border-orange-200"
          )}>
            {totalIssues === 0 ? "✓ All clear" : `${totalIssues} item${totalIssues !== 1 ? "s" : ""} need attention`}
          </span>
        )}
      </div>

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
          <section>
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
                                  className="text-xs text-primary hover:underline flex items-center gap-0.5"
                                  title="Open certificate"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                </button>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button className="flex items-center gap-1 px-1.5 py-1 rounded text-muted-foreground hover:text-primary transition-colors text-xs" title="Share certificate">
                                      <Share2 className="w-3 h-3" />
                                      Share
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-44">
                                    <DropdownMenuItem
                                      className="gap-2 cursor-pointer"
                                      onClick={() => {
                                        const norm = ins.certificateUrl!.replace(/^\/uploads\//, "/api/uploads/"); const url = norm.startsWith("http") ? norm : `${window.location.origin}${norm}`;
                                        const subject = encodeURIComponent(`Insurance Certificate – ${ins.subcontractorName}`);
                                        const body = encodeURIComponent(`Hi,\n\nPlease find the ${ins.insuranceType.replace(/_/g, " ")} insurance certificate for ${ins.subcontractorName} here:\n\n${url}\n\nExpiry: ${fmtDate(ins.expiryDate)}`);
                                        window.open(`mailto:?subject=${subject}&body=${body}`);
                                      }}
                                    >
                                      <Mail className="w-4 h-4 text-muted-foreground" /> Send via Email
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      className="gap-2 cursor-pointer"
                                      onClick={() => {
                                        const norm = ins.certificateUrl!.replace(/^\/uploads\//, "/api/uploads/"); const url = norm.startsWith("http") ? norm : `${window.location.origin}${norm}`;
                                        const text = encodeURIComponent(`Insurance certificate – ${ins.subcontractorName}\nType: ${ins.insuranceType.replace(/_/g, " ")}\nExpiry: ${fmtDate(ins.expiryDate)}\n${url}`);
                                        window.open(`https://wa.me/?text=${text}`, "_blank");
                                      }}
                                    >
                                      <MessageCircle className="w-4 h-4 text-green-600" /> Send via WhatsApp
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </>
                            )}
                            {caps.canManageCompliance && (
                              <button
                                onClick={() => uploadFile(new File([], ""), ins.subcontractorId)}
                                className="text-xs text-primary hover:underline flex items-center gap-0.5"
                                title="Upload new certificate"
                              >
                                <Upload className="w-3 h-3" />
                              </button>
                            )}
                            <Link href="/subcontractors" className="text-xs text-muted-foreground hover:text-primary flex items-center gap-0.5">
                              View <ArrowRight className="w-3 h-3" />
                            </Link>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── Expiring Permits ── */}
          <section>
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
                        <p className="font-semibold text-sm">{p.permitType}</p>
                        <p className="text-xs text-muted-foreground">{p.projectName}</p>
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
                              className="flex items-center gap-1 px-1.5 py-1 rounded text-primary hover:bg-primary/10 transition-colors text-xs font-medium"
                              title="Open certificate"
                            >
                              <ExternalLink className="w-3 h-3" /> Certificate
                            </button>
                          );
                        })()}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="flex items-center gap-1 px-1.5 py-1 rounded text-muted-foreground hover:text-primary transition-colors text-xs" title="Share permit">
                              <Share2 className="w-3 h-3" />
                              Share
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem
                              className="gap-2 cursor-pointer"
                              onClick={() => {
                                const subject = encodeURIComponent(`Permit Expiry – ${p.permitType}`);
                                const body = encodeURIComponent(`Hi,\n\nPlease note the following permit is expiring soon:\n\nType: ${p.permitType}\nProject: ${p.projectName}\nExpiry: ${fmtDate(p.expiryDate)}\n\nPlease take action in SiteSort.`);
                                window.open(`mailto:?subject=${subject}&body=${body}`);
                              }}
                            >
                              <Mail className="w-4 h-4 text-muted-foreground" /> Send via Email
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="gap-2 cursor-pointer"
                              onClick={() => {
                                const text = encodeURIComponent(`Permit expiry alert:\nType: ${p.permitType}\nProject: ${p.projectName}\nExpiry: ${fmtDate(p.expiryDate)}\nPlease action in SiteSort.`);
                                window.open(`https://wa.me/?text=${text}`, "_blank");
                              }}
                            >
                              <MessageCircle className="w-4 h-4 text-green-600" /> Send via WhatsApp
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Link href={`/projects/${p.projectId}`} className="text-xs text-muted-foreground hover:text-primary flex items-center gap-0.5">
                          View <ArrowRight className="w-3 h-3" />
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── Pending Sign-offs ── */}
          <section>
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
                      <p className="font-semibold text-sm">{a.documentName}</p>
                      <p className="text-xs text-muted-foreground">{a.projectName}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className="text-[10px] bg-blue-100 text-blue-700 border-blue-200">{a.pendingCount} pending</Badge>
                      {a.fileUrl && (
                        <button
                          onClick={() => window.open(a.fileUrl!.replace(/^\/uploads\//, "/api/uploads/"), '_blank', 'noopener,noreferrer')}
                          className="text-xs text-primary hover:underline flex items-center gap-0.5"
                          title="Open document"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="flex items-center gap-1 px-1.5 py-1 rounded text-muted-foreground hover:text-primary transition-colors text-xs" title="Share document">
                            <Share2 className="w-3 h-3" />
                            Share
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem
                            className="gap-2 cursor-pointer"
                            onClick={() => {
                              const norm = a.fileUrl?.replace(/^\/uploads\//, "/api/uploads/") ?? "";
                              const url = norm ? (norm.startsWith("http") ? norm : `${window.location.origin}${norm}`) : "";
                              const subject = encodeURIComponent(`Sign-off Required – ${a.documentName}`);
                              const body = encodeURIComponent(`Hi,\n\nThe document "${a.documentName}" on project "${a.projectName}" requires sign-off from ${a.pendingCount} team member${a.pendingCount !== 1 ? "s" : ""}.\n\n${url ? `Document: ${url}\n\n` : ""}Please sign off in SiteSort.`);
                              window.open(`mailto:?subject=${subject}&body=${body}`);
                            }}
                          >
                            <Mail className="w-4 h-4 text-muted-foreground" /> Send via Email
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="gap-2 cursor-pointer"
                            onClick={() => {
                              const norm = a.fileUrl?.replace(/^\/uploads\//, "/api/uploads/") ?? "";
                              const url = norm ? (norm.startsWith("http") ? norm : `${window.location.origin}${norm}`) : "";
                              const text = encodeURIComponent(`Sign-off needed: "${a.documentName}" on "${a.projectName}" – ${a.pendingCount} pending.${url ? `\n${url}` : ""}`);
                              window.open(`https://wa.me/?text=${text}`, "_blank");
                            }}
                          >
                            <MessageCircle className="w-4 h-4 text-green-600" /> Send via WhatsApp
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Link href={`/projects/${a.projectId}`} className="text-xs text-muted-foreground hover:text-primary flex items-center gap-0.5">
                        View <ArrowRight className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

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
            <p className="font-semibold text-emerald-600">Certificate saved successfully</p>
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
              <label className="text-sm font-medium mb-1.5 block">Subcontractor</label>
              <select
                value={assignSubId}
                onChange={e => setAssignSubId(e.target.value)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Select subcontractor…</option>
                {subs.map(s => (
                  <option key={s.id} value={s.id}>{s.companyName} — {s.contactName}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Insurance Type</label>
              <select
                value={assignType}
                onChange={e => setAssignType(e.target.value)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {INSURANCE_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Expiry Date</label>
              <Input
                type="date"
                value={assignExpiry}
                onChange={e => setAssignExpiry(e.target.value)}
                icon={<Calendar className="w-4 h-4" />}
              />
            </div>

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
              {assigning ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</> : "Save Certificate"}
            </Button>
          </DialogFooter>
        )}
      </Dialog>
    </SidebarLayout>
  );
}
