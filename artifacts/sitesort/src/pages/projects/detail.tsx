import { useState, useRef, useEffect } from "react";
import { useRoute } from "wouter";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { MapPin, Calendar, Upload, FileText, CheckCircle2, AlertTriangle, ShieldCheck, Eye, EyeOff, Users, Search, X, Phone, Mail, HardHat, UserCheck, Clock, Pencil, Camera, FolderOpen, ChevronDown, ChevronUp, ChevronRight, QrCode, Download, Printer, RefreshCw, ArrowDownCircle, ArrowUpCircle, Receipt, ClipboardCheck, UserPlus, ExternalLink, Share2, MessageCircle, FileDown, Plus, Trash2, Flag, Pin, StickyNote, Send, Loader2, History, Archive } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { ShareModal } from "@/components/share-modal";
import { FileDropZone } from "@/components/ui/file-drop-zone";
import { Textarea } from "@/components/ui/textarea";
import { InsuranceCertZone } from "@/components/ui/insurance-cert-zone";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetProject,
  useListDocuments,
  useListProjectMembers,
  useUploadDocument,
  useUpdateProject,
  useGetMe,
  useGetDocumentAuditLog,
  DocumentType,
  UploadDocumentRequestType,
  UpdateProjectRequestStatus,
} from "@workspace/api-client-react";
import { formatDate, formatBytes, cn } from "@/lib/utils";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useSubscription } from "@/contexts/subscription";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";

export default function ProjectDetail() {
  const [, params] = useRoute("/projects/:id");
  const projectId = params?.id || "";
  const defaultTab = new URLSearchParams(window.location.search).get("tab") || "documents";

  const { data: project, isLoading: projectLoading } = useGetProject(projectId, { query: { enabled: !!projectId } });
  const { data: documents, refetch: refetchDocs } = useListDocuments(projectId, undefined, { query: { enabled: !!projectId } });
  const { data: members } = useListProjectMembers(projectId, { query: { enabled: !!projectId } });

  type PermitItem = { id: string; type: string; description: string; startDate: string; expiryDate: string; status: string; responsibleName?: string; documentUrl?: string | null; archivedAt?: string | null };
  type InvoiceItem = { id: string; direction: string; counterpartyName: string; description: string; amount: string; currency: string; dueDate: string; status: string; reference?: string | null; attachmentUrl?: string | null };
  type PhotoItem = { id: string; uploadedBy: string; uploaderName: string; photoUrl: string | null; category: string; description: string | null; zone: string | null; referenceNumber: string; takenAt: string; status: string | null; resolvedAt: string | null; latitude?: number | null; longitude?: number | null };
  type MilestoneItem = { id: string; title: string; dueDate: string; completedAt: string | null; order: number };
  type CheckinItem = { id: string; workerName: string; photoUrl: string; checkedInAt: string; lat: number | null; lng: number | null };
  type ReportSummary = { id: string; reportDate: string; generatedAt: string; checkinCount: number; documentEventCount: number; photoCount: number };
  type DailyReportData = {
    subcontractorsOnSite: { id: string; workerName: string; checkedInAt: string; photoUrl: string | null }[];
    documentActivity: {
      uploaded: { documentId: string; name: string; type: string; version: number; uploaderName: string; at: string }[];
      amended: { documentId: string; name: string; type: string; version: number; uploaderName: string; at: string }[];
      viewed: { documentId: string; documentName: string; userName: string; at: string }[];
      signedOff: { documentId: string; documentName: string; documentVersion: number; userName: string; userRole: string; signedOffWithPin: boolean; at: string }[];
    };
    sitePhotos: { id: string; referenceNumber: string; category: string; description: string | null; zone: string | null; uploaderName: string; photoUrl: string | null; takenAt: string }[];
    siteManagerNotes: { id: string; authorName: string; body: string; source: string; at: string }[];
  };
  type ReportDetail = ReportSummary & { projectId: string; projectName: string; data: DailyReportData };
  type DailyNote = { id: string; body: string; source: string; noteDate: string; authorName: string; createdAt: string };

  const PERMIT_TYPES = ["CSCS Check", "IPAF Certificate", "Hot Works", "Working at Heights", "Scaffolding Inspection", "Confined Space Entry", "Excavation", "Electrical Isolation", "Demolition", "Asbestos", "Method Statement", "Other"];

  const [permits, setPermits] = useState<PermitItem[]>([]);
  const [permitAddOpen, setPermitAddOpen] = useState(false);
  const [showSupersededPermits, setShowSupersededPermits] = useState(false);
  const [newPermitType, setNewPermitType] = useState("Hot Works");
  const [newPermitDesc, setNewPermitDesc] = useState("");
  const [newPermitResponsibleId, setNewPermitResponsibleId] = useState("");
  const [newPermitStart, setNewPermitStart] = useState("");
  const [newPermitExpiry, setNewPermitExpiry] = useState("");
  const [newPermitCertUrl, setNewPermitCertUrl] = useState<string | null>(null);
  const [newPermitSubmitting, setNewPermitSubmitting] = useState(false);
  const [newPermitError, setNewPermitError] = useState<string | null>(null);

  type ShareLog = { id: string; entityType: string; entityId: string; entityName: string; method: string; recipientInfo: string | null; sentByName: string; createdAt: string };
  const [projectShareLog, setProjectShareLog] = useState<ShareLog[]>([]);
  const [projectShareLogLoading, setProjectShareLogLoading] = useState(false);
  const loadProjectShareLog = async () => {
    setProjectShareLogLoading(true);
    const token = localStorage.getItem("sitesort_token");
    const res = await fetch(`/api/share-logs?projectId=${projectId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.ok) setProjectShareLog(await res.json());
    setProjectShareLogLoading(false);
  };

  const [projectInvoices, setProjectInvoices] = useState<InvoiceItem[]>([]);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [milestones, setMilestones] = useState<MilestoneItem[]>([]);
  const [checkins, setCheckins] = useState<CheckinItem[]>([]);
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [openReport, setOpenReport] = useState<ReportDetail | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [milestoneTitle, setMilestoneTitle] = useState("");
  const [milestoneDue, setMilestoneDue] = useState("");
  const [milestoneAdding, setMilestoneAdding] = useState(false);
  const [photoUploadUrl, setPhotoUploadUrl] = useState<string | null>(null);
  const [photoTag, setPhotoTag] = useState<string>("snag");
  const [photoNote, setPhotoNote] = useState("");
  const [photoZone, setPhotoZone] = useState("");
  const [photoSubmitting, setPhotoSubmitting] = useState(false);
  const [photoFormKey, setPhotoFormKey] = useState(0);
  const [viewingPhoto, setViewingPhoto] = useState<PhotoItem | null>(null);
  const [issueSearch, setIssueSearch] = useState("");
  const [issueStatusFilter, setIssueStatusFilter] = useState<"all" | "open" | "in_progress" | "resolved">("all");
  const [todayNotes, setTodayNotes] = useState<DailyNote[]>([]);
  const [noteBody, setNoteBody] = useState("");
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [ovPhotoOpen, setOvPhotoOpen] = useState(false);
  const [ovPhotoUrl, setOvPhotoUrl] = useState<string | null>(null);
  const [ovPhotoNote, setOvPhotoNote] = useState("");
  const [ovPhotoKey, setOvPhotoKey] = useState(0);
  const [ovPhotoSubmitting, setOvPhotoSubmitting] = useState(false);

  const authHeaders = () => {
    const t = localStorage.getItem("sitesort_token");
    return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" } as Record<string, string>;
  };

  const invoiceFullUrl = (attachmentUrl: string) => {
    const normalised = attachmentUrl.replace(/^\/uploads\//, "/api/uploads/");
    return normalised.startsWith("http") ? normalised : `${window.location.origin}${normalised}`;
  };
  const shareInvoiceEmail = (inv: InvoiceItem) => {
    const url = invoiceFullUrl(inv.attachmentUrl!);
    const subject = encodeURIComponent(`Invoice – ${inv.counterpartyName}`);
    const body = encodeURIComponent(
      `Hi,\n\nPlease find the invoice document attached below:\n\n${url}\n\nRef: ${inv.reference ?? "N/A"} | Amount: ${inv.currency} ${Number(inv.amount).toFixed(2)}\n\nRegards`
    );
    window.open(`mailto:?subject=${subject}&body=${body}`);
  };
  const shareInvoiceWhatsApp = (inv: InvoiceItem) => {
    const url = invoiceFullUrl(inv.attachmentUrl!);
    const text = encodeURIComponent(
      `Invoice document – ${inv.counterpartyName}\nRef: ${inv.reference ?? "N/A"} | ${inv.currency} ${Number(inv.amount).toFixed(2)}\n${url}`
    );
    window.open(`https://wa.me/?text=${text}`, "_blank");
  };
  const updatePhotoStatus = async (photoId: string, status: string) => {
    const res = await fetch(`/api/photos/${photoId}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ status }),
    });
    if (!res.ok) { toast({ title: "Couldn't update status", variant: "destructive" }); return; }
    const updated: PhotoItem = await res.json();
    setPhotos(prev => prev.map(p => p.id === photoId ? updated : p));
    setViewingPhoto(prev => prev?.id === photoId ? updated : prev);
  };

  const markInvoiceUnpaid = async (id: string) => {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    const res = await fetch(`/api/invoices/${id}`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ status: "pending", projectId: null }) });
    if (!res.ok) { toast({ title: "Couldn't update invoice", description: "Please try again.", variant: "destructive" }); return; }
    setProjectInvoices(prev => prev.filter(inv => inv.id !== id));
    toast({ title: "Moved back to Invoices", description: "This invoice is now unpaid and back on the main Invoices page." });
  };

  const fetchMilestones = () => {
    fetch(`/api/projects/${projectId}/milestones`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : []).then(setMilestones);
  };

  const fetchPhotos = () => {
    fetch(`/api/projects/${projectId}/photos`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then((list: PhotoItem[]) => {
        setPhotos(list);
        const photoParam = new URLSearchParams(window.location.search).get("photo");
        if (photoParam) {
          const match = list.find(p => p.id === photoParam);
          if (match) {
            setViewingPhoto(match);
            window.history.replaceState({}, "", window.location.pathname + "?tab=issues");
          }
        }
      });
  };

  const fetchReports = () => {
    fetch(`/api/projects/${projectId}/daily-reports`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : []).then(setReports);
  };

  const fetchTodayNotes = () => {
    fetch(`/api/projects/${projectId}/daily-notes`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : []).then(setTodayNotes);
  };

  const submitDailyNote = async (body: string) => {
    const text = body.trim();
    if (!text) return;
    setNoteSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/daily-notes`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ body: text, source: "text" }),
      });
      if (!res.ok) throw new Error("Failed to save note");
      toast({ title: "Daily report saved", description: "Added to today's site report." });
      setNoteBody("");
      fetchTodayNotes();
    } catch {
      toast({ title: "Could not save", description: "Please try again.", variant: "destructive" });
    } finally {
      setNoteSubmitting(false);
    }
  };

  const openReportDetail = async (id: string) => {
    setReportLoading(true);
    try {
      const r = await fetch(`/api/daily-reports/${id}`, { headers: authHeaders() });
      if (r.ok) setOpenReport(await r.json());
    } finally {
      setReportLoading(false);
    }
  };

  const submitSnagPhoto = async () => {
    if (!photoUploadUrl) return;
    setPhotoSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/photos`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ photoUrl: photoUploadUrl, category: photoTag, description: photoNote.trim() || null, zone: photoZone.trim() || null }),
      });
      if (!res.ok) throw new Error("Failed to log photo");
      toast({ title: "Photo logged", description: "Added to today's site activity." });
      setPhotoUploadUrl(null);
      setPhotoNote("");
      setPhotoZone("");
      setPhotoTag("snag");
      setPhotoFormKey(k => k + 1);
      fetchPhotos();
    } catch {
      toast({ title: "Could not log photo", description: "Please try again.", variant: "destructive" });
    } finally {
      setPhotoSubmitting(false);
    }
  };

  const submitOverviewPhoto = async () => {
    if (!ovPhotoUrl) return;
    setOvPhotoSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/photos`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ photoUrl: ovPhotoUrl, category: "general", description: ovPhotoNote.trim() || null, zone: null }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Photo logged", description: "Added to the photo log." });
      setOvPhotoUrl(null);
      setOvPhotoNote("");
      setOvPhotoKey(k => k + 1);
      setOvPhotoOpen(false);
      fetchPhotos();
    } catch {
      toast({ title: "Could not log photo", description: "Please try again.", variant: "destructive" });
    } finally {
      setOvPhotoSubmitting(false);
    }
  };

  useEffect(() => {
    if (!projectId) return;
    const token = localStorage.getItem("sitesort_token");
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    Promise.all([
      fetch(`/api/projects/${projectId}/permits`, { headers }).then(r => r.ok ? r.json() : []),
      fetch(`/api/projects/${projectId}/invoices`, { headers }).then(r => r.ok ? r.json() : []),
      fetch(`/api/projects/${projectId}/photos`, { headers }).then(r => r.ok ? r.json() : []),
      fetch(`/api/projects/${projectId}/milestones`, { headers }).then(r => r.ok ? r.json() : []),
      fetch(`/api/projects/${projectId}/checkins`, { headers }).then(r => r.ok ? r.json() : []),
      fetch(`/api/projects/${projectId}/daily-reports`, { headers }).then(r => r.ok ? r.json() : []),
      fetch(`/api/projects/${projectId}/daily-notes`, { headers }).then(r => r.ok ? r.json() : []),
      fetch(`/api/projects/${projectId}/qr-pins`, { headers }).then(r => r.ok ? r.json() : []),
      fetch(`/api/projects/${projectId}/qr-codes`, { headers }).then(r => r.ok ? r.json() : []),
    ]).then(([p, inv, ph, ms, ci, rep, notes, pins, qrCodes]) => {
      setPermits(p); setProjectInvoices(inv); setPhotos(ph); setMilestones(ms); setCheckins(ci); setReports(rep); setTodayNotes(notes);
      if (Array.isArray(pins)) setQrPins(pins);
      if (Array.isArray(qrCodes) && qrCodes.length > 0) {
        const qr = qrCodes.find((q: any) => q.category === "site_board") ?? qrCodes[0];
        setSiteBoardUrl(qr.siteUrl);
      }
    });
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    const rid = new URLSearchParams(window.location.search).get("report");
    if (rid) openReportDetail(rid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const { isCancelled } = useSubscription();
  const { toast } = useToast();
  const uploadMutation = useUploadDocument();
  const updateMutation = useUpdateProject();
  const queryClient = useQueryClient();
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  type EditDocModal = { id: string; name: string; status: string; version: number };
  const [editDocModal, setEditDocModal] = useState<EditDocModal | null>(null);
  const [editDocSaving, setEditDocSaving] = useState(false);
  const [editDocStatus, setEditDocStatus] = useState("current");
  const [editDocVersion, setEditDocVersion] = useState(1);
  const [editError, setEditError] = useState<string | null>(null);

  const { data: me } = useGetMe();
  const caps = useCapabilities();
  const hasPin = !!(me as { hasPin?: boolean } | undefined)?.hasPin;
  const PIN_REQUIRED_TYPES = ["drawing", "method_statement", "safety"];
  type SignOffDoc = { id: string; name: string; type: string };
  const [signOffDoc, setSignOffDoc] = useState<SignOffDoc | null>(null);
  const [signOffPin, setSignOffPin] = useState("");
  const [signOffSubmitting, setSignOffSubmitting] = useState(false);
  const [signOffError, setSignOffError] = useState<string | null>(null);
  const [setPinMode, setSetPinMode] = useState(false);
  const [setPinPassword, setSetPinPassword] = useState("");
  const [setPinValue, setSetPinValue] = useState("");
  const signOffNeedsPin = !!signOffDoc && PIN_REQUIRED_TYPES.includes(signOffDoc.type);
  const onlyDigits = (v: string) => v.replace(/\D/g, "").slice(0, 4);

  // Immutable acknowledgment audit trail — admins & project managers only.
  const myRole = (me as { role?: string } | undefined)?.role;
  const canViewAudit = myRole === "admin" || myRole === "project_manager";
  const [auditDoc, setAuditDoc] = useState<{ id: string; name: string } | null>(null);
  const { data: auditEntries, isLoading: auditLoading } = useGetDocumentAuditLog(
    auditDoc?.id ?? "",
    { query: { enabled: !!auditDoc && canViewAudit } },
  );

  const openSignOff = (doc: SignOffDoc) => {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    setSignOffError(null);
    setSignOffPin("");
    setSetPinPassword("");
    setSetPinValue("");
    setSetPinMode(PIN_REQUIRED_TYPES.includes(doc.type) && !hasPin);
    setSignOffDoc(doc);
  };

  const closeSignOff = () => {
    setSignOffDoc(null);
    setSignOffError(null);
    setSignOffPin("");
    setSetPinPassword("");
    setSetPinValue("");
    setSetPinMode(false);
  };

  const submitSignOff = async () => {
    if (!signOffDoc) return;
    const needsPin = PIN_REQUIRED_TYPES.includes(signOffDoc.type);
    setSignOffError(null);

    let pinToUse: string | undefined;
    if (needsPin) {
      if (setPinMode) {
        if (!setPinPassword) { setSignOffError("Enter your account password to set a PIN."); return; }
        if (!/^\d{4}$/.test(setPinValue)) { setSignOffError("PIN must be exactly 4 digits."); return; }
        pinToUse = setPinValue;
      } else {
        if (!/^\d{4}$/.test(signOffPin)) { setSignOffError("Enter your 4-digit PIN."); return; }
        pinToUse = signOffPin;
      }
    }

    setSignOffSubmitting(true);
    try {
      if (needsPin && setPinMode) {
        const pinRes = await fetch("/api/auth/pin", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ currentPassword: setPinPassword, pin: setPinValue }),
        });
        const pinData = await pinRes.json().catch(() => ({}));
        if (!pinRes.ok) { setSignOffError(pinData.message ?? "Could not set your PIN."); setSignOffSubmitting(false); return; }
        await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      }

      const res = await fetch(`/api/documents/${signOffDoc.id}/acknowledge`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(pinToUse ? { pin: pinToUse } : {}),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        toast({ title: "Signed off", description: `You signed off "${signOffDoc.name}".` });
        await refetchDocs();
        closeSignOff();
        return;
      }

      if (res.status === 429) {
        setSignOffError(data.message ?? "Too many incorrect attempts. Please try again later.");
      } else if (data.error === "pin_not_set") {
        setSetPinMode(true);
        setSignOffError("Set a sign-off PIN to continue.");
      } else if (typeof data.attemptsRemaining === "number") {
        setSignOffError(`Incorrect PIN. ${data.attemptsRemaining} attempt${data.attemptsRemaining === 1 ? "" : "s"} remaining.`);
        setSignOffPin("");
      } else {
        setSignOffError(data.message ?? "Could not sign off this document.");
      }
    } catch {
      setSignOffError("Network error. Please try again.");
    } finally {
      setSignOffSubmitting(false);
    }
  };

  const { register, handleSubmit, reset, watch, setValue } = useForm<Record<string, any>>({ defaultValues: { type: "drawing" } });
  const { register: editRegister, handleSubmit: editHandleSubmit, reset: editReset } = useForm();
  
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const toggleFolder = (trade: string) => setOpenFolders(prev => ({ ...prev, [trade]: !prev[trade] }));
  const isFolderOpen = (trade: string, defaultOpen = true) => trade in openFolders ? openFolders[trade] : defaultOpen;

  const [addingTrade, setAddingTrade] = useState(false);
  const [newTradeName, setNewTradeName] = useState("");

  const submitAddTrade = async () => {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    if (!newTradeName.trim()) return;
    const token = localStorage.getItem("sitesort_token");
    await fetch(`/api/projects/${projectId}/trades`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ trade: newTradeName.trim() }),
    });
    await queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}`] });
    setNewTradeName("");
    setAddingTrade(false);
  };

  const [editingPhoneId, setEditingPhoneId] = useState<string | null>(null);
  const [phoneInput, setPhoneInput] = useState("");

  const savePhone = async (memberId: string) => {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    const token = localStorage.getItem("sitesort_token");
    await fetch(`/api/projects/${projectId}/members/${memberId}/contact`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ phone: phoneInput }),
    });
    await queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/members`] });
    setEditingPhoneId(null);
  };

  const submitNewPermit = async () => {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    if (!newPermitDesc.trim() || !newPermitResponsibleId || !newPermitStart || !newPermitExpiry) {
      setNewPermitError("Please fill in all required fields."); return;
    }
    setNewPermitSubmitting(true); setNewPermitError(null);
    try {
      const token = localStorage.getItem("sitesort_token");
      const res = await fetch(`/api/projects/${projectId}/permits`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ type: newPermitType, description: newPermitDesc.trim(), responsibleUserId: newPermitResponsibleId, startDate: newPermitStart, expiryDate: newPermitExpiry, documentUrl: newPermitCertUrl ?? undefined }),
      });
      if (!res.ok) throw new Error("Failed to create permit");
      const newP = await res.json();
      setPermits(prev => [...prev, { id: newP.id, type: newP.type, description: newP.description, startDate: newP.startDate, expiryDate: newP.expiryDate, status: newP.status, responsibleName: newP.responsibleUserName, documentUrl: newP.documentUrl ?? null }]);
      setPermitAddOpen(false); setNewPermitType("Hot Works"); setNewPermitDesc(""); setNewPermitResponsibleId(""); setNewPermitStart(""); setNewPermitExpiry(""); setNewPermitCertUrl(null); setNewPermitError(null);
    } catch {
      setNewPermitError("Failed to save permit. Please try again.");
    } finally {
      setNewPermitSubmitting(false);
    }
  };

  const deletePermit = async (permitId: string) => {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    const token = localStorage.getItem("sitesort_token");
    await fetch(`/api/permits/${permitId}`, { method: "DELETE", headers: token ? { Authorization: `Bearer ${token}` } : {} });
    setPermits(prev => prev.filter(p => p.id !== permitId));
  };

  const [selectedDocType, setSelectedDocType] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");

  const [siteBoardUrl, setSiteBoardUrl] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<{ token: string; siteUrl: string } | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrFetched, setQrFetched] = useState(false);
  const qrSvgRef = useRef<HTMLDivElement>(null);
  const [qrPins, setQrPins] = useState<{ id: string; itemType: string; itemId: string }[]>([]);
  const isPinned = (itemType: string, itemId: string) => qrPins.some(p => p.itemType === itemType && p.itemId === itemId);
  const togglePin = async (itemType: string, itemId: string) => {
    const h = authHeaders();
    const pinned = isPinned(itemType, itemId);
    if (pinned) {
      await fetch(`/api/projects/${projectId}/qr-pins`, { method: "DELETE", headers: h, body: JSON.stringify({ itemType, itemId }) });
      setQrPins(prev => prev.filter(p => !(p.itemType === itemType && p.itemId === itemId)));
    } else {
      const res = await fetch(`/api/projects/${projectId}/qr-pins`, { method: "POST", headers: h, body: JSON.stringify({ itemType, itemId }) });
      const data = await res.json().catch(() => ({}));
      if (data.id) setQrPins(prev => [...prev, data]);
    }
  };

  const loadQr = async () => {
    setQrLoading(true);
    try {
      const token = localStorage.getItem("sitesort_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
      const buildUrl = (t: string) => `${window.location.origin}${BASE}/site/${t}`;

      const existing = await fetch(`/api/projects/${projectId}/qr-codes`, { headers }).then(r => r.json());
      if (Array.isArray(existing) && existing.length > 0) {
        const qr = existing.find((q: any) => q.category === "site_board") ?? existing[0];
        setQrCode({ token: qr.token, siteUrl: buildUrl(qr.token) });
        setSiteBoardUrl(buildUrl(qr.token));
        setQrFetched(true);
        return;
      }

      const res = await fetch(`/api/projects/${projectId}/qr-codes`, {
        method: "POST", headers,
        body: JSON.stringify({ categories: ["site_board"] }),
      });
      const created = await res.json();
      if (Array.isArray(created) && created.length > 0) {
        const qr = created[0];
        setQrCode({ token: qr.token, siteUrl: buildUrl(qr.token) });
      }
    } catch (e) { console.error(e); }
    finally { setQrLoading(false); setQrFetched(true); }
  };

  const downloadQr = () => {
    if (!qrSvgRef.current || !project) return;
    const svg = qrSvgRef.current.querySelector("svg");
    if (!svg) return;
    const blob = new Blob([svg.outerHTML], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name.replace(/\s+/g, "-")}-site-board-qr.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const printQr = () => {
    if (!qrCode || !qrSvgRef.current || !project) return;
    const svg = qrSvgRef.current.querySelector("svg");
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`<html><head><title>${project.name} — Site Board QR</title>
      <style>body{font-family:system-ui,sans-serif;margin:0;padding:40px;text-align:center;background:white}
      h2{font-size:24px;font-weight:800;margin-bottom:4px;color:#1f2937}
      p{color:#6b7280;font-size:14px;margin:4px 0}
      .url{font-size:11px;color:#9ca3af;word-break:break-all;margin-top:12px}
      .badge{display:inline-block;background:#fff7ed;color:#c2410c;border:1px solid #fed7aa;border-radius:9999px;padding:4px 12px;font-size:12px;font-weight:600;margin-bottom:20px}
      svg{margin:20px auto;display:block}</style></head><body>
      <span class="badge">SiteSort — Site Board</span>
      <h2>${project.name}</h2><p>${project.address}</p>
      ${svg?.outerHTML ?? ""}
      <p class="url">Scan to view site information: ${qrCode.siteUrl}</p>
      </body></html>`);
    win.document.close(); win.print();
  };
  const [scheduleTarget, setScheduleTarget] = useState<any | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const [fromDirOpen, setFromDirOpen] = useState(false);
  const [dirSubs, setDirSubs] = useState<any[]>([]);
  const [dirSubsLoading, setDirSubsLoading] = useState(false);
  const [dirSearch, setDirSearch] = useState("");
  const [linkingSubId, setLinkingSubId] = useState<string | null>(null);

  const openFromDirectory = async () => {
    setFromDirOpen(true);
    setDirSearch("");
    setDirSubsLoading(true);
    const token = localStorage.getItem("sitesort_token");
    const res = await fetch("/api/subcontractors", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (res.ok) setDirSubs(await res.json());
    setDirSubsLoading(false);
  };

  const linkSubcontractor = async (subId: string) => {
    setLinkingSubId(subId);
    const token = localStorage.getItem("sitesort_token");
    const res = await fetch(`/api/projects/${projectId}/members/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ subcontractorId: subId }),
    });
    if (res.ok) {
      await queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/members`] });
      await queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}`] });
    }
    setLinkingSubId(null);
  };
  type SharingDoc = { type: string; id: string; name: string; version: number | null; fileUrl: string; additionalInfo?: string };
  const [sharingDoc, setSharingDoc] = useState<SharingDoc | null>(null);

  // Sub notes dialog (project Team tab)
  type SubNote = { id: string; body: string; authorName: string; projectId: string | null; projectName: string | null; createdAt: string };
  const [subNotesTarget, setSubNotesTarget] = useState<{ id: string; name: string } | null>(null);
  const [subNotesList, setSubNotesList] = useState<SubNote[]>([]);
  const [subNotesLoading, setSubNotesLoading] = useState(false);
  const [subNoteDraft, setSubNoteDraft] = useState("");
  const [subNoteScope, setSubNoteScope] = useState<"general" | "project">("general");
  const [subNoteSubmitting, setSubNoteSubmitting] = useState(false);

  async function openSubNotes(memberId: string, memberName: string) {
    setSubNotesTarget({ id: memberId, name: memberName });
    setSubNotesList([]);
    setSubNotesLoading(true);
    const token = localStorage.getItem("sitesort_token");
    const res = await fetch(`/api/subcontractors/${memberId}/notes?projectId=${projectId}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (res.ok) setSubNotesList(await res.json());
    setSubNotesLoading(false);
  }

  async function submitSubNote() {
    if (!subNotesTarget || !subNoteDraft.trim()) return;
    setSubNoteSubmitting(true);
    const token = localStorage.getItem("sitesort_token");
    const res = await fetch(`/api/subcontractors/${subNotesTarget.id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ body: subNoteDraft.trim(), projectId: subNoteScope === "project" ? projectId : null }),
    });
    if (res.ok) {
      const created: SubNote = await res.json();
      setSubNotesList(prev => [created, ...prev]);
      setSubNoteDraft("");
    }
    setSubNoteSubmitting(false);
  }

  const { register: schedRegister, handleSubmit: schedHandleSubmit, reset: schedReset, setValue: schedSetValue, watch: schedWatch } = useForm();

  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const openSchedule = (member: any) => {
    setScheduleTarget(member);
    setScheduleError(null);
    schedReset({
      scheduledDays: member.scheduledDays ?? [],
      siteStartTime: member.siteStartTime ?? "",
      siteEndTime: member.siteEndTime ?? "",
    });
  };

  const onScheduleSubmit = async (data: any) => {
    setScheduleError(null);
    try {
      const token = localStorage.getItem("sitesort_token");
      const res = await fetch(`/api/projects/${projectId}/members/${scheduleTarget.id}/schedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          scheduledDays: data.scheduledDays ?? [],
          siteStartTime: data.siteStartTime || null,
          siteEndTime: data.siteEndTime || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to save schedule");
      await queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/members`] });
      setScheduleTarget(null);
    } catch (e: any) {
      setScheduleError(e?.message ?? "Failed to save schedule");
    }
  };

  const watchedType = watch("type") ?? "drawing";
  const supersedableDocs = (documents ?? []).filter(d => d.status === "current" && d.type === watchedType);

  const onUpload = async (data: any) => {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    try {
      await uploadMutation.mutateAsync({
        projectId,
        data: {
          name: data.name,
          type: data.type as UploadDocumentRequestType,
          fileUrl: data.fileUrl,
          fileSize: data.fileSize,
          requiresAcknowledgment: data.requiresAcknowledgment,
          ...(data.supersededDocumentId ? { supersededDocumentId: data.supersededDocumentId } : {}),
        } as any
      });
      setIsUploadOpen(false);
      reset();
      refetchDocs();
    } catch (e) {
      console.error(e);
    }
  };

  const openDocEdit = (doc: { id: string; name: string; status: string; version: number }) => {
    setEditDocStatus(doc.status);
    setEditDocVersion(doc.version);
    setEditDocModal(doc);
  };

  const saveDocEdit = async () => {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    if (!editDocModal) return;
    setEditDocSaving(true);
    try {
      const token = localStorage.getItem("sitesort_token");
      await fetch(`/api/documents/${editDocModal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ status: editDocStatus, version: editDocVersion }),
      });
      setEditDocModal(null);
      refetchDocs();
    } catch (e) {
      console.error(e);
    } finally {
      setEditDocSaving(false);
    }
  };

  const openEdit = () => {
    editReset({
      name: project?.name ?? "",
      address: project?.address ?? "",
      status: project?.status ?? "active",
      targetEndDate: project?.targetEndDate ?? "",
    });
    setEditError(null);
    setIsEditOpen(true);
  };

  const onEditSubmit = async (data: any) => {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    setEditError(null);
    try {
      await updateMutation.mutateAsync({
        projectId,
        data: {
          name: data.name,
          address: data.address,
          status: data.status as UpdateProjectRequestStatus,
          targetEndDate: data.targetEndDate || undefined,
        },
      });
      await queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}`] });
      await queryClient.invalidateQueries({ queryKey: ['/api/projects'] });
      setIsEditOpen(false);
    } catch (e: any) {
      setEditError(e?.message ?? "Failed to save changes.");
    }
  };

  const generateReport = () => {
    if (!project) return;
    const now = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" } as Intl.DateTimeFormatOptions);
    const fmtD = (s?: string | null) => s ? new Date(s.slice(0, 10) + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
    const fmtAmt = (currency: string, amount: string) => `${currency} ${Number(amount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const daysLeft = (s: string) => Math.ceil((new Date(s + "T00:00:00").getTime() - today.getTime()) / 86400000);

    const allMembersArr: any[] = (members as any[]) ?? [];
    const projectTrades: string[] = (project as any)?.trades ?? [];
    const memberTrades = allMembersArr.flatMap((m: any) => m.trades?.length ? m.trades : []);
    const hasStaff = allMembersArr.some((m: any) => !m.trades?.length);
    const allTrades = Array.from(new Set([...projectTrades, ...memberTrades, ...(hasStaff ? ["Site Staff"] : [])])).sort((a, b) => a === "Site Staff" ? 1 : b === "Site Staff" ? -1 : a.localeCompare(b));

    const teamRows = allTrades.map(trade => {
      const tradeMembers = allMembersArr.filter((m: any) => trade === "Site Staff" ? !m.trades?.length : m.trades?.includes(trade));
      if (!tradeMembers.length) return "";
      return `<tr class="trade-header"><td colspan="4">${trade}</td></tr>${tradeMembers.map((m: any) => `<tr><td>${m.name}</td><td class="capitalize">${m.role.replace("_", " ")}</td><td>${m.email ?? "—"}</td><td>${m.phone ?? "—"}</td></tr>`).join("")}`;
    }).join("");

    const permitsRows = [...permits].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)).map(p => {
      const d = daysLeft(p.expiryDate);
      const statusLabel = d < 0 ? "Expired" : d <= 7 ? `Expires in ${d}d` : `Active (${d}d)`;
      const cls = d < 0 ? "red" : d <= 7 ? "orange" : "";
      return `<tr><td>${p.type}</td><td>${p.description}</td><td>${fmtD(p.expiryDate)}</td><td class="${cls}">${statusLabel}</td><td>${p.responsibleName ?? "—"}</td></tr>`;
    }).join("");

    const docsRows = [...(documents ?? [])].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(doc => {
      const pending = doc.distributionSummary?.pending ?? 0;
      const signOff = doc.status === "superseded" ? "Superseded" : pending > 0 ? `${pending} pending` : "All signed off";
      return `<tr${doc.status === "superseded" ? ' class="superseded"' : ""}><td>${doc.name}</td><td class="capitalize">${doc.type.replace("_", " ")}</td><td>v${doc.version}</td><td>${doc.status === "superseded" ? "Superseded" : "Current"}</td><td>${signOff}</td><td>${fmtD(String(doc.createdAt))}</td></tr>`;
    }).join("");

    const unpaidIn = projectInvoices.filter(i => i.direction === "inbound" && i.status !== "paid").reduce((s, i) => s + Number(i.amount), 0);
    const unpaidOut = projectInvoices.filter(i => i.direction === "outbound" && i.status !== "paid").reduce((s, i) => s + Number(i.amount), 0);
    const invRows = [...projectInvoices].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map(inv => {
      const d = daysLeft(inv.dueDate); const paid = inv.status === "paid";
      const statusLabel = paid ? "Paid" : d < 0 ? "Overdue" : `Due in ${d}d`;
      const cls = paid ? "green" : d < 0 ? "red" : d <= 7 ? "orange" : "";
      return `<tr><td>${inv.direction === "inbound" ? "↓ Inbound" : "↑ Outbound"}</td><td>${inv.counterpartyName}</td><td>${inv.description}</td><td>${inv.reference ?? "—"}</td><td>${fmtAmt(inv.currency, inv.amount)}</td><td>${fmtD(inv.dueDate)}</td><td class="${cls}">${statusLabel}</td></tr>`;
    }).join("");

    const photoCounts = photos.reduce((acc, p) => { acc[p.category] = (acc[p.category] ?? 0) + 1; return acc; }, {} as Record<string, number>);
    const photoSummary = Object.entries(photoCounts).map(([cat, n]) => `${n} ${cat.replace("_", " ")}`).join(", ");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>${project.name} — Project Report</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:11px;color:#1a1a1a;background:white;padding:0}
.page{max-width:900px;margin:0 auto;padding:32px}
.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;padding-bottom:14px;border-bottom:2px solid #e5e7eb}
.logo{font-size:20px;font-weight:800;color:#ea6c0a;letter-spacing:-0.5px}
.report-label{font-size:10px;color:#6b7280}
.hero{margin-bottom:24px;padding:18px;background:#fff7ed;border-left:4px solid #ea6c0a;border-radius:4px}
.hero h1{font-size:22px;font-weight:800;color:#1f2937;margin-bottom:2px}
.hero .address{color:#6b7280;font-size:12px;margin-bottom:14px}
.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.meta-item label{display:block;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#9ca3af;margin-bottom:2px}
.meta-item span{font-size:14px;font-weight:700;color:#1f2937}
.prog{height:5px;background:#e5e7eb;border-radius:99px;overflow:hidden;margin-top:4px}
.prog-fill{height:100%;background:#ea6c0a;border-radius:99px}
section{margin-bottom:24px}
section h2{font-size:12px;font-weight:700;color:#ea6c0a;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid #f3f4f6}
.count{background:#f3f4f6;color:#6b7280;font-size:9px;font-weight:700;padding:1px 6px;border-radius:99px;margin-left:6px}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#9ca3af;padding:5px 8px;border-bottom:1px solid #e5e7eb;background:#f9fafb}
td{padding:5px 8px;border-bottom:1px solid #f3f4f6;vertical-align:top}
tr:last-child td{border-bottom:none}
.trade-header td{background:#f3f4f6;font-size:9px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.5px;padding:3px 8px}
.superseded td{opacity:0.5}
.red{color:#dc2626;font-weight:700}
.orange{color:#ea580c;font-weight:700}
.green{color:#16a34a;font-weight:700}
.badge{display:inline-block;font-size:9px;font-weight:700;padding:2px 7px;border-radius:99px}
.badge-active{background:#dcfce7;color:#15803d}
.badge-hold{background:#fef9c3;color:#a16207}
.summary-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}
.summary-box{padding:10px 14px;border-radius:6px;border:1px solid}
.summary-box.green-box{background:#f0fdf4;border-color:#bbf7d0}
.summary-box.red-box{background:#fff1f2;border-color:#fecdd3}
.summary-box label{display:block;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#9ca3af;margin-bottom:3px}
.summary-box.green-box span{font-size:16px;font-weight:800;color:#15803d}
.summary-box.red-box span{font-size:16px;font-weight:800;color:#be123c}
.photo-box{background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:10px 14px;font-size:12px;color:#374151}
.empty{color:#9ca3af;font-style:italic;padding:8px}
.footer{margin-top:28px;padding-top:10px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;color:#9ca3af;font-size:9px}
.capitalize{text-transform:capitalize}
@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}.page{max-width:100%;padding:16px}section{page-break-inside:avoid}}
</style></head><body><div class="page">
<div class="header"><span class="logo">SiteSort</span><span class="report-label">Project Report · Generated ${now}</span></div>
<div class="hero">
  <h1>${project.name}</h1>
  <p class="address">${project.address}</p>
  <div class="meta">
    <div class="meta-item"><label>Status</label><span><span class="badge ${project.status === "active" ? "badge-active" : "badge-hold"}">${project.status.toUpperCase()}</span></span></div>
    <div class="meta-item"><label>Started</label><span>${fmtD(project.startDate)}</span></div>
    <div class="meta-item"><label>Target End</label><span>${project.targetEndDate ? fmtD(project.targetEndDate) : "—"}</span></div>
    <div class="meta-item"><label>Progress</label><span>${project.progressPercent}%</span><div class="prog"><div class="prog-fill" style="width:${project.progressPercent}%"></div></div></div>
  </div>
</div>
<section>
  <h2>Team<span class="count">${allMembersArr.length}</span></h2>
  ${allMembersArr.length ? `<table><thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Phone</th></tr></thead><tbody>${teamRows}</tbody></table>` : `<p class="empty">No team members added yet.</p>`}
</section>
<section>
  <h2>Permits<span class="count">${permits.length}</span></h2>
  ${permits.length ? `<table><thead><tr><th>Type</th><th>Description</th><th>Expiry</th><th>Status</th><th>Responsible</th></tr></thead><tbody>${permitsRows}</tbody></table>` : `<p class="empty">No permits on this project.</p>`}
</section>
<section>
  <h2>Documents<span class="count">${(documents ?? []).length}</span></h2>
  ${(documents ?? []).length ? `<table><thead><tr><th>Name</th><th>Category</th><th>Version</th><th>Status</th><th>Sign-offs</th><th>Uploaded</th></tr></thead><tbody>${docsRows}</tbody></table>` : `<p class="empty">No documents uploaded yet.</p>`}
</section>
<section>
  <h2>Finances<span class="count">${projectInvoices.length}</span></h2>
  ${projectInvoices.length ? `<div class="summary-grid"><div class="summary-box green-box"><label>Due to You (unpaid)</label><span>GBP ${unpaidIn.toLocaleString("en-GB", { minimumFractionDigits: 2 })}</span></div><div class="summary-box red-box"><label>You Owe (unpaid)</label><span>GBP ${unpaidOut.toLocaleString("en-GB", { minimumFractionDigits: 2 })}</span></div></div><table><thead><tr><th>Type</th><th>Counterparty</th><th>Description</th><th>Ref</th><th>Amount</th><th>Due</th><th>Status</th></tr></thead><tbody>${invRows}</tbody></table>` : `<p class="empty">No invoices linked to this project.</p>`}
</section>
<section>
  <h2>Photo Log<span class="count">${photos.length}</span></h2>
  ${photos.length ? `<div class="photo-box"><strong>${photos.length}</strong> photo${photos.length !== 1 ? "s" : ""} logged${photoSummary ? ` — ${photoSummary}` : ""}</div>` : `<p class="empty">No photos logged yet.</p>`}
</section>
<div class="footer"><span>${project.name} · SiteSort</span><span>Generated ${now}</span></div>
</div></body></html>`;

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  };

  if (projectLoading) return <SidebarLayout><div className="animate-pulse h-32 bg-muted rounded-xl"></div></SidebarLayout>;
  if (!project) return <SidebarLayout>Project not found</SidebarLayout>;

  return (
    <SidebarLayout>
      {/* Project Header */}
      <div className="bg-card border rounded-2xl p-6 md:p-8 shadow-sm mb-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
        <div className="relative z-10">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl md:text-4xl font-display font-extrabold text-primary">{project.name}</h1>
                <Badge variant={project.status === 'active' ? 'success' : 'secondary'} className="text-sm">
                  {project.status.toUpperCase()}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground min-w-0">
                <span className="flex items-center gap-1 min-w-0"><MapPin className="w-4 h-4 shrink-0"/><span className="truncate">{project.address}</span></span>
                <span className="flex items-center gap-1 whitespace-nowrap shrink-0"><Calendar className="w-4 h-4"/> Started {formatDate(project.startDate)}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={generateReport}>
                <FileDown className="w-4 h-4 mr-2" /> Export Report
              </Button>
              {caps.canManageProjects && (
                <Button variant="outline" onClick={openEdit}>Edit Details</Button>
              )}
            </div>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 pt-6 border-t border-border/50">
            <div>
              <p className="text-sm text-muted-foreground font-medium mb-1">Progress</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-success" style={{ width: `${project.progressPercent}%` }}></div>
                </div>
                <span className="font-bold">{project.progressPercent}%</span>
              </div>
            </div>
            <div>
              <p className="text-sm text-muted-foreground font-medium mb-1">Team Size</p>
              <p className="font-bold text-lg">{project.memberCount}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground font-medium mb-1">Target End</p>
              <p className="font-bold text-lg">{formatDate(project.targetEndDate)}</p>
            </div>
          </div>
        </div>
      </div>

      <Tabs defaultValue={defaultTab}>
        <TabsList className="mb-6 w-full h-auto flex flex-wrap justify-start gap-1.5 bg-muted p-1.5 rounded-xl">
          {/* Group 1: Project management */}
          {[
            { value: "overview", label: "Overview" },
            { value: "progress", label: "Progress" },
            { value: "team", label: "Team" },
            { value: "qr", label: "Site Board" },
            { value: "documents", label: "Documents" },
            { value: "permits", label: "Compliance" },
          ].map(tab => (
            <TabsTrigger key={tab.value} value={tab.value} className="flex-1 sm:flex-none justify-center rounded-lg py-2 px-3 sm:px-4 text-sm whitespace-nowrap">
              {tab.label}
            </TabsTrigger>
          ))}
          {/* Divider */}
          <div className="w-px self-stretch bg-border/60 mx-0.5 my-0.5" />
          {/* Group 2: Site activity */}
          {[
            { value: "finances", label: "Finances & Expiry" },
            { value: "checkins", label: `Check-ins${checkins.length > 0 ? ` (${checkins.length})` : ""}` },
            ...(caps.isInternal ? [{ value: "reports", label: "Daily Reports" }] : []),
            (() => { const open = photos.filter(p => (p.category === "snag" || p.category === "safety_concern") && (!p.status || p.status === "open")).length; return { value: "issues", label: open > 0 ? `Site Issues (${open})` : "Site Issues" }; })(),
          ].map(tab => (
            <TabsTrigger key={tab.value} value={tab.value} className="flex-1 sm:flex-none justify-center rounded-lg py-2 px-3 sm:px-4 text-sm whitespace-nowrap">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview">
          <div className="space-y-6">
            {(caps.canLogPhoto || caps.canUploadDocument) && (
              <Card>
                <CardContent className="pt-5 space-y-3">
                  <h3 className="font-semibold text-sm text-foreground">Post an update</h3>
                  <Textarea
                    value={noteBody}
                    onChange={e => setNoteBody(e.target.value)}
                    placeholder="Write a site update…"
                    rows={3}
                  />
                  {ovPhotoOpen && (
                    <div className="space-y-2">
                      <FileDropZone
                        key={ovPhotoKey}
                        accept=".jpg,.jpeg,.png,.webp"
                        onUploaded={f => setOvPhotoUrl(f.url)}
                        onCleared={() => setOvPhotoUrl(null)}
                      />
                      <Input
                        value={ovPhotoNote}
                        onChange={e => setOvPhotoNote(e.target.value)}
                        placeholder="Caption (optional)"
                      />
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex gap-2">
                      {caps.canUploadDocument && (
                        <button
                          type="button"
                          onClick={() => setIsUploadOpen(true)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-background text-muted-foreground text-xs font-medium hover:text-foreground hover:bg-muted transition-colors"
                        >
                          <FileText className="w-3.5 h-3.5" /> Document
                        </button>
                      )}
                      {caps.canLogPhoto && (
                        <button
                          type="button"
                          onClick={() => setOvPhotoOpen(o => !o)}
                          className={cn(
                            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors",
                            ovPhotoOpen
                              ? "border-primary/25 bg-primary/5 text-primary hover:bg-primary/15"
                              : "border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted"
                          )}
                        >
                          <Camera className="w-3.5 h-3.5" /> Photo
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {ovPhotoOpen && ovPhotoUrl && (
                        <Button size="sm" variant="outline" onClick={submitOverviewPhoto} isLoading={ovPhotoSubmitting}>
                          Log photo
                        </Button>
                      )}
                      {caps.canLogPhoto && (
                        <Button size="sm" onClick={() => submitDailyNote(noteBody)} disabled={!noteBody.trim() || noteSubmitting}>
                          {noteSubmitting ? "Saving…" : "Save update"}
                        </Button>
                      )}
                    </div>
                  </div>
                  {todayNotes.length > 0 && (
                    <div className="border-t pt-3 space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground">Posted today</p>
                      {todayNotes.map(n => (
                        <div key={n.id} className="rounded-lg border bg-muted/30 p-3">
                          <p className="text-sm text-foreground whitespace-pre-wrap">{n.body}</p>
                          <p className="text-[10px] text-muted-foreground mt-1">{n.authorName} · {formatDate(n.createdAt)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
            <div className="grid md:grid-cols-2 gap-6">
              <Card>
                <CardContent className="pt-6">
                  <h3 className="font-bold text-lg mb-4">Recent Activity</h3>
                  <div className="space-y-4">
                    {project.recentActivity?.map(act => (
                      <div key={act.id} className="flex gap-3 text-sm">
                        <div className="w-2 h-2 mt-1.5 rounded-full bg-primary shrink-0"></div>
                        <div>
                          <p className="font-medium text-foreground">{act.description}</p>
                          <p className="text-muted-foreground text-xs">{formatDate(act.createdAt)} by {act.userName || 'System'}</p>
                        </div>
                      </div>
                    ))}
                    {(!project.recentActivity || project.recentActivity.length === 0) && (
                      <p className="text-muted-foreground">No recent activity.</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="progress">
          {(() => {
            const total = milestones.length;
            const done = milestones.filter(m => m.completedAt).length;
            const pct = total === 0 ? 0 : Math.round((done / total) * 100);

            // Gantt helpers
            const start = project.startDate ? new Date(project.startDate) : null;
            const end = project.targetEndDate ? new Date(project.targetEndDate) : null;
            const spanDays = start && end ? Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000)) : null;
            const positionPct = (dateStr: string) => {
              if (!start || !spanDays) return null;
              const d = new Date(dateStr);
              const offset = Math.round((d.getTime() - start.getTime()) / 86400000);
              return Math.min(100, Math.max(0, Math.round((offset / spanDays) * 100)));
            };
            const todayPct = start && spanDays ? positionPct(new Date().toISOString().slice(0, 10)) : null;

            return (
              <div className="space-y-6">
                {/* Progress summary */}
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-bold text-lg">Overall Progress</h3>
                      <span className="text-3xl font-bold text-primary">{pct}%</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-4 overflow-hidden">
                      <div
                        className="h-4 rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-sm text-muted-foreground mt-2">
                      {done} of {total} milestone{total !== 1 ? "s" : ""} completed
                    </p>
                  </CardContent>
                </Card>

                {/* Milestones checklist */}
                <Card>
                  <CardContent className="pt-6">
                    <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                      <Flag className="w-5 h-5 text-primary" /> Milestones
                    </h3>

                    <div className="space-y-2 mb-4">
                      {milestones.length === 0 && (
                        <p className="text-muted-foreground text-sm">No milestones yet. Add one below.</p>
                      )}
                      {milestones.map(m => (
                        <div key={m.id} className={cn("flex items-center gap-3 p-3 rounded-lg border transition-colors", m.completedAt ? "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800" : "bg-card border-border")}>
                          <button
                            disabled={!caps.canManageProjects}
                            onClick={async () => {
                              if (!caps.canManageProjects) return;
                              if (isCancelled) { toast({ title: "Subscription required", variant: "destructive" }); return; }
                              await fetch(`/api/projects/${projectId}/milestones/${m.id}`, {
                                method: "PATCH", headers: authHeaders(),
                                body: JSON.stringify({ completed: !m.completedAt }),
                              });
                              fetchMilestones();
                            }}
                            className={cn("w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors", m.completedAt ? "border-green-500 bg-green-500 text-white" : "border-muted-foreground hover:border-primary", !caps.canManageProjects && "cursor-default opacity-60")}
                          >
                            {m.completedAt && <CheckCircle2 className="w-4 h-4" />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <p className={cn("font-medium text-sm", m.completedAt && "line-through text-muted-foreground")}>{m.title}</p>
                            <p className="text-xs text-muted-foreground">Due {new Date(m.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                          </div>
                          {!isCancelled && caps.canManageProjects && (
                            <button onClick={async () => {
                              await fetch(`/api/projects/${projectId}/milestones/${m.id}`, { method: "DELETE", headers: authHeaders() });
                              fetchMilestones();
                            }} className="text-muted-foreground hover:text-destructive transition-colors shrink-0">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>

                    {!isCancelled && caps.canManageProjects && (
                      <div className="flex gap-2 pt-2 border-t">
                        <Input
                          placeholder="Milestone title"
                          value={milestoneTitle}
                          onChange={e => setMilestoneTitle(e.target.value)}
                          className="flex-1"
                          onKeyDown={e => e.key === "Enter" && !milestoneAdding && document.getElementById("ms-add-btn")?.click()}
                        />
                        <Input
                          type="date"
                          value={milestoneDue}
                          onChange={e => setMilestoneDue(e.target.value)}
                          className="w-40"
                        />
                        <Button
                          id="ms-add-btn"
                          size="sm"
                          disabled={!milestoneTitle.trim() || !milestoneDue || milestoneAdding}
                          onClick={async () => {
                            setMilestoneAdding(true);
                            await fetch(`/api/projects/${projectId}/milestones`, {
                              method: "POST", headers: authHeaders(),
                              body: JSON.stringify({ title: milestoneTitle.trim(), dueDate: milestoneDue }),
                            });
                            setMilestoneTitle(""); setMilestoneDue("");
                            fetchMilestones();
                            setMilestoneAdding(false);
                          }}
                        >
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Gantt timeline */}
                {start && end && (
                  <Card>
                    <CardContent className="pt-6">
                      <h3 className="font-bold text-lg mb-4">Timeline</h3>
                      <div className="relative">
                        {/* Date labels */}
                        <div className="flex justify-between text-xs text-muted-foreground mb-2">
                          <span>{start.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                          <span>{end.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                        </div>
                        {/* Track */}
                        <div className="relative h-8 bg-muted rounded-full overflow-visible mb-6">
                          {/* Filled portion */}
                          <div className="absolute inset-y-0 left-0 bg-primary/20 rounded-full" style={{ width: `${pct}%` }} />
                          {/* Today marker */}
                          {todayPct !== null && todayPct >= 0 && todayPct <= 100 && (
                            <div className="absolute top-[-4px] bottom-[-4px] w-0.5 bg-orange-500 z-10" style={{ left: `${todayPct}%` }}>
                              <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] text-orange-500 font-semibold whitespace-nowrap">Today</div>
                            </div>
                          )}
                          {/* Milestone markers */}
                          {milestones.map(m => {
                            const pos = positionPct(m.dueDate);
                            if (pos === null) return null;
                            return (
                              <div
                                key={m.id}
                                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-20"
                                style={{ left: `${pos}%` }}
                                title={`${m.title} — ${new Date(m.dueDate).toLocaleDateString("en-GB")}`}
                              >
                                <div className={cn(
                                  "w-4 h-4 rotate-45 border-2 transition-colors",
                                  m.completedAt ? "bg-green-500 border-green-600" : "bg-background border-primary"
                                )} />
                              </div>
                            );
                          })}
                        </div>
                        {/* Legend */}
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                          {milestones.map(m => {
                            const pos = positionPct(m.dueDate);
                            if (pos === null) return null;
                            return (
                              <div key={m.id} className="flex items-center gap-1 text-xs">
                                <div className={cn("w-2.5 h-2.5 rotate-45 border", m.completedAt ? "bg-green-500 border-green-600" : "bg-background border-primary")} />
                                <span className={cn(m.completedAt ? "text-green-600 line-through" : "text-foreground")}>{m.title}</span>
                              </div>
                            );
                          })}
                          {todayPct !== null && <div className="flex items-center gap-1 text-xs"><div className="w-0.5 h-3 bg-orange-500" /><span className="text-orange-500">Today</span></div>}
                        </div>
                        {milestones.length === 0 && (
                          <p className="text-sm text-muted-foreground text-center mt-2">Add milestones above to see them on the timeline.</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}
                {!start && (
                  <p className="text-sm text-muted-foreground">Set a project start date and target end date to see the Gantt timeline.</p>
                )}
              </div>
            );
          })()}
        </TabsContent>

        <TabsContent value="documents">
          <div className="flex flex-col gap-3 mb-6">
            <div className="flex gap-3 items-center">
              <div className="relative flex-1 max-w-sm">
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
                <Button variant="accent" onClick={() => setIsUploadOpen(true)}>
                  <Upload className="w-4 h-4 mr-2" /> Upload Document
                </Button>
              )}
            </div>
            <div className="flex gap-2 flex-wrap items-center">
              <Button
                variant={selectedDocType === 'all' ? 'default' : 'secondary'}
                size="sm" onClick={() => setSelectedDocType('all')}
              >All Types</Button>
              {Object.values(DocumentType).map(type => (
                <Button
                  key={type}
                  variant={selectedDocType === type ? 'default' : 'secondary'}
                  size="sm"
                  onClick={() => setSelectedDocType(type)}
                  className="capitalize"
                >
                  {type.replace('_', ' ')}s
                </Button>
              ))}
              <div className="w-px h-6 bg-border mx-1" />
              {(['all', 'current', 'superseded'] as const).map(s => (
                <Button
                  key={s}
                  variant={selectedStatus === s ? 'default' : 'secondary'}
                  size="sm"
                  onClick={() => setSelectedStatus(s)}
                  className="capitalize"
                >{s === 'all' ? 'All Statuses' : s}</Button>
              ))}
            </div>
          </div>

          <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
            {/* Mobile card list */}
            <div className="block lg:hidden divide-y">
              {(documents ?? []).filter(d =>
                (selectedDocType === 'all' || d.type === selectedDocType) &&
                (selectedStatus === 'all' || d.status === selectedStatus) &&
                (searchQuery === '' || d.name.toLowerCase().includes(searchQuery.toLowerCase()))
              ).map(doc => {
                const isSuperseded = doc.status === 'superseded';
                return (
                  <div key={doc.id} className={cn("px-4 py-4", isSuperseded && "opacity-70 bg-muted/20")}>
                    <div className="flex items-start gap-3 mb-2">
                      <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0", isSuperseded ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")}>
                        <FileText className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn("font-bold text-sm leading-tight", isSuperseded && "line-through text-muted-foreground")}>{doc.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{formatBytes(doc.fileSize)} · By {doc.uploaderName}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mb-2.5">
                      <span className="font-mono bg-muted px-2 py-0.5 rounded text-xs font-bold">v{doc.version}</span>
                      {isSuperseded
                        ? <Badge variant="destructive" className="text-[10px]"><AlertTriangle className="w-3 h-3 mr-1"/>SUPERSEDED</Badge>
                        : <Badge variant="success" className="text-[10px]">CURRENT</Badge>
                      }
                      <span className="text-xs text-muted-foreground capitalize">{doc.type.replace('_', ' ')}</span>
                      <span className="text-xs text-muted-foreground">· {formatDate(doc.createdAt)}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs mb-3">
                      <span className="flex items-center gap-1 text-success"><CheckCircle2 className="w-3.5 h-3.5"/> {doc.distributionSummary.acknowledged} ack</span>
                      <span className="flex items-center gap-1 text-primary"><Eye className="w-3.5 h-3.5"/> {doc.distributionSummary.viewed} viewed</span>
                      <span className="flex items-center gap-1 text-muted-foreground"><EyeOff className="w-3.5 h-3.5"/> {doc.distributionSummary.pending} pending</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {!isSuperseded && (doc.myDistributionStatus === "pending" || doc.myDistributionStatus === "viewed") && (
                        <button
                          onClick={() => openSignOff({ id: doc.id, name: doc.name, type: doc.type })}
                          className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-xs font-semibold"
                        >
                          <ClipboardCheck className="w-3 h-3" />Sign off
                        </button>
                      )}
                      {doc.myDistributionStatus === "acknowledged" && (
                        <span className="flex items-center gap-1 text-xs text-success font-semibold"><CheckCircle2 className="w-3 h-3" />Signed off</span>
                      )}
                      <button
                        onClick={() => window.open(doc.fileUrl.replace(/^\/uploads\//, "/api/uploads/"), '_blank', 'noopener,noreferrer')}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/25 bg-primary/5 text-primary text-xs font-medium hover:bg-primary/15 transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />Open
                      </button>
                      {canViewAudit && (
                        <button onClick={() => setAuditDoc({ id: doc.id, name: doc.name })}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-background text-muted-foreground text-xs font-medium hover:text-foreground hover:bg-muted transition-colors">
                          <Clock className="w-3 h-3" />History
                        </button>
                      )}
                      <button onClick={() => openDocEdit(doc)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-background text-muted-foreground text-xs font-medium hover:text-foreground hover:bg-muted transition-colors">
                        <Pencil className="w-3 h-3" />Edit
                      </button>
                      <button onClick={() => setSharingDoc({ type: "document", id: doc.id, name: doc.name, version: doc.version, fileUrl: doc.fileUrl })}
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
            {/* Desktop table */}
            <div className="hidden lg:block">
            <table className="w-full text-sm text-left">
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
                      <td className="px-6 py-4 capitalize">{doc.type.replace('_', ' ')}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-mono bg-muted px-2 py-0.5 rounded text-xs font-bold">v{doc.version}</span>
                          {isSuperseded ? (
                            <Badge variant="destructive" className="text-[10px]"><AlertTriangle className="w-3 h-3 mr-1"/> SUPERSEDED</Badge>
                          ) : (
                            <Badge variant="success" className="text-[10px]">CURRENT</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-4 text-xs">
                          <div className="flex items-center gap-1 text-success"><CheckCircle2 className="w-4 h-4"/> {doc.distributionSummary.acknowledged}</div>
                          <div className="flex items-center gap-1 text-primary"><Eye className="w-4 h-4"/> {doc.distributionSummary.viewed}</div>
                          <div className="flex items-center gap-1 text-muted-foreground"><EyeOff className="w-4 h-4"/> {doc.distributionSummary.pending}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground">
                        {formatDate(doc.createdAt)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1">
                          {!isSuperseded && (doc.myDistributionStatus === "pending" || doc.myDistributionStatus === "viewed") && (
                            <button
                              onClick={() => openSignOff({ id: doc.id, name: doc.name, type: doc.type })}
                              className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-xs font-semibold"
                              title="Sign off this document"
                            >
                              <ClipboardCheck className="w-3.5 h-3.5" />
                              Sign off
                            </button>
                          )}
                          {doc.myDistributionStatus === "acknowledged" && (
                            <span className="flex items-center gap-1 text-xs text-success font-semibold" title="You signed this off">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Signed off
                            </span>
                          )}
                          <button
                            onClick={() => window.open(doc.fileUrl.replace(/^\/uploads\//, "/api/uploads/"), '_blank', 'noopener,noreferrer')}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/25 bg-primary/5 text-primary text-xs font-medium hover:bg-primary/15 transition-colors"
                            title="Open document"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Open
                          </button>
                          {canViewAudit && (
                            <button
                              onClick={() => setAuditDoc({ id: doc.id, name: doc.name })}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-background text-muted-foreground text-xs font-medium hover:text-foreground hover:bg-muted transition-colors"
                              title="View sign-off audit history"
                            >
                              <Clock className="w-3.5 h-3.5" />
                              History
                            </button>
                          )}
                          {caps.canUploadDocument && (
                            <button
                              onClick={() => openDocEdit(doc)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-background text-muted-foreground text-xs font-medium hover:text-foreground hover:bg-muted transition-colors"
                              title="Edit status / version"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              Edit
                            </button>
                          )}
                          <button
                            onClick={() => setSharingDoc({ type: "document", id: doc.id, name: doc.name, version: doc.version, fileUrl: doc.fileUrl })}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-background text-muted-foreground text-xs font-medium hover:text-foreground hover:bg-muted transition-colors"
                            title="Share"
                          >
                            <Share2 className="w-3.5 h-3.5" /> Share
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

        <TabsContent value="team">
          {caps.canManageTeam && (
            <div className="flex justify-end mb-4">
              <Button variant="outline" size="sm" onClick={openFromDirectory}>
                <UserPlus className="w-4 h-4 mr-2" /> Add from Contacts Directory
              </Button>
            </div>
          )}
          {(!members || members.length === 0) ? (
            <div className="bg-card p-12 rounded-xl border text-center border-dashed border-2">
              <Users className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-50" />
              <h3 className="text-lg font-bold">No team members yet</h3>
              <p className="text-muted-foreground">Add contacts from your directory using the button above.</p>
            </div>
          ) : (() => {
            const allMembers = members as any[];
            const projectTrades: string[] = (project as any)?.trades ?? [];
            const memberTrades = allMembers.flatMap((m: any) => m.trades?.length ? m.trades : []);
            const hasStaff = allMembers.some((m: any) => !m.trades?.length);
            const allTrades = Array.from(new Set([...projectTrades, ...memberTrades, ...(hasStaff ? ["Site Staff"] : [])])).sort((a, b) => a === "Site Staff" ? 1 : b === "Site Staff" ? -1 : a.localeCompare(b)) as string[];
            const membersByTrade = (trade: string) => allMembers.filter((m: any) => trade === "Site Staff" ? !m.trades?.length : m.trades?.includes(trade));

            return (
              <div className="space-y-3">
                {allTrades.map(trade => {
                  const tradeMembers = membersByTrade(trade);
                  const open = isFolderOpen(trade);
                  return (
                    <div key={trade} className="bg-card border rounded-xl overflow-hidden shadow-sm">
                      <button
                        onClick={() => toggleFolder(trade)}
                        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-muted/30 transition-colors text-left"
                      >
                        {open ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                        <FolderOpen className="w-5 h-5 text-orange-500 shrink-0" />
                        <span className="font-bold capitalize flex-1">{trade}</span>
                        <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{tradeMembers.length} {tradeMembers.length === 1 ? "person" : "people"}</span>
                      </button>
                      {open && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 pt-0 border-t">
                          {tradeMembers.map((member: any) => {
                const isSubcontractor = !!member.subcontractorId;
                const complianceBadge = member.complianceStatus === "ok"
                  ? <Badge variant="success" className="text-[10px]"><UserCheck className="w-3 h-3 mr-1"/>Compliant</Badge>
                  : member.complianceStatus === "warning"
                  ? <Badge variant="warning" className="text-[10px]"><AlertTriangle className="w-3 h-3 mr-1"/>Insurance Expiring</Badge>
                  : member.complianceStatus === "hold"
                  ? <Badge variant="destructive" className="text-[10px]"><AlertTriangle className="w-3 h-3 mr-1"/>Site Access Denied</Badge>
                  : null;

                return (
                  <div key={member.id} className="bg-card border rounded-xl p-5 flex flex-col gap-3 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <label className={cn("relative shrink-0", caps.canManageTeam ? "cursor-pointer group" : "cursor-default")} title={caps.canManageTeam ? "Click to upload photo" : undefined}>
                          {caps.canManageTeam && (
                          <input type="file" accept="image/*" className="hidden" onChange={async e => {
                            const file = e.target.files?.[0]; if (!file) return;
                            const token = localStorage.getItem("sitesort_token");
                            const fd = new FormData(); fd.append("file", file);
                            const up = await fetch("/api/upload", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
                            if (!up.ok) return;
                            const { url } = await up.json();
                            await fetch(`/api/projects/${projectId}/members/${member.id}/avatar`, { method: "PATCH", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ avatarUrl: url }) });
                            await queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/members`] });
                          }} />
                          )}
                          <div className={cn("w-14 h-14 rounded-xl flex items-center justify-center shrink-0 overflow-hidden", isSubcontractor ? "bg-orange-500/10" : "bg-primary/10")}>
                            {member.avatarUrl ? (
                              <img src={member.avatarUrl} alt={member.name} className="w-full h-full object-cover" />
                            ) : (
                              <span className={cn("text-lg font-extrabold", isSubcontractor ? "text-orange-500" : "text-primary")}>
                                {member.name.split(" ").map((w: string) => w[0]).slice(0, 2).join("")}
                              </span>
                            )}
                          </div>
                          {caps.canManageTeam && (
                            <div className="absolute inset-0 rounded-xl bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <Camera className="w-4 h-4 text-white" />
                            </div>
                          )}
                        </label>
                        <div>
                          <p className="font-bold text-base leading-tight">{member.name}</p>
                          {isSubcontractor && member.contactName && (
                            <p className="text-xs text-muted-foreground">Contact: {member.contactName}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <div className="flex items-center gap-1">
                          <Badge variant="secondary" className="text-[10px] capitalize">{member.role.replace('_', ' ')}</Badge>
                          {isSubcontractor && (
                            <button
                              onClick={() => openSubNotes(member.subcontractorId, member.name)}
                              className="p-1 rounded-md text-muted-foreground hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors"
                              title="Notes & reminders"
                            >
                              <StickyNote className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="p-1 rounded-md text-muted-foreground hover:text-primary hover:bg-muted transition-colors" title="Share contact">
                                <Share2 className="w-3.5 h-3.5" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuItem
                                className="gap-2 cursor-pointer"
                                onClick={() => {
                                  const subject = encodeURIComponent(`Contact – ${member.name}`);
                                  const body = encodeURIComponent(`Hi,\n\nHere are the contact details for ${member.name}:\n\nRole: ${member.role.replace(/_/g, " ")}${member.trades?.length ? `\nTrades: ${member.trades.join(", ")}` : ""}\nEmail: ${member.email ?? "N/A"}${member.phone ? `\nPhone: ${member.phone}` : ""}`);
                                  window.open(`mailto:?subject=${subject}&body=${body}`);
                                }}
                              >
                                <Mail className="w-4 h-4 text-muted-foreground" /> Send via Email
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="gap-2 cursor-pointer"
                                onClick={() => {
                                  const text = encodeURIComponent(`${member.name} (${member.role.replace(/_/g, " ")})${member.trades?.length ? `\nTrades: ${member.trades.join(", ")}` : ""}\nEmail: ${member.email ?? "N/A"}${member.phone ? `\nPhone: ${member.phone}` : ""}`);
                                  window.open(`https://wa.me/?text=${text}`, "_blank");
                                }}
                              >
                                <MessageCircle className="w-4 h-4 text-green-600" /> Send via WhatsApp
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        {complianceBadge}
                      </div>
                    </div>

                    {member.trades?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {member.trades.map((trade: string) => (
                          <span key={trade} className="inline-flex items-center gap-1 px-2.5 py-1 bg-orange-500/10 text-orange-600 text-xs font-semibold rounded-full capitalize">
                            <HardHat className="w-3 h-3" />{trade}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-col gap-1.5 pt-1 border-t border-border/50">
                      {member.email && (
                        <a href={`mailto:${member.email}`} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors">
                          <Mail className="w-4 h-4 shrink-0" />
                          <span className="truncate">{member.email}</span>
                        </a>
                      )}
                      <div className="flex items-center gap-2">
                        <Phone className="w-4 h-4 shrink-0 text-muted-foreground" />
                        {editingPhoneId === member.id ? (
                          <div className="flex items-center gap-1 flex-1">
                            <input
                              autoFocus
                              value={phoneInput}
                              onChange={e => setPhoneInput(e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter") savePhone(member.id); if (e.key === "Escape") setEditingPhoneId(null); }}
                              placeholder="+44 7700 000000"
                              className="flex-1 text-sm bg-muted rounded px-2 py-0.5 outline-none focus:ring-2 focus:ring-primary/30 min-w-0"
                            />
                            <button onClick={() => savePhone(member.id)} className="text-success hover:text-success/80 shrink-0"><CheckCircle2 className="w-4 h-4" /></button>
                            <button onClick={() => setEditingPhoneId(null)} className="text-muted-foreground hover:text-destructive shrink-0"><X className="w-4 h-4" /></button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 flex-1 min-w-0 group/phone">
                            {member.phone ? (
                              <a href={`tel:${member.phone}`} className="text-sm text-muted-foreground hover:text-primary transition-colors truncate">{member.phone}</a>
                            ) : (
                              <span className="text-sm text-muted-foreground italic">Add phone number</span>
                            )}
                            {caps.canManageTeam && (
                              <button
                                onClick={() => { setEditingPhoneId(member.id); setPhoneInput(member.phone ?? ""); }}
                                className="ml-1 opacity-0 group-hover/phone:opacity-100 transition-opacity text-muted-foreground hover:text-primary shrink-0"
                              ><Pencil className="w-3 h-3" /></button>
                            )}
                          </div>
                        )}
                      </div>
                      {!member.email && !member.phone && editingPhoneId !== member.id && (
                        <p className="text-xs text-muted-foreground italic">No email on file</p>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-border/50">
                      <div className="flex-1">
                        {(member.scheduledDays?.length > 0 || member.siteStartTime) ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            {member.scheduledDays?.length > 0 && (
                              <div className="flex gap-1 flex-wrap">
                                {[...member.scheduledDays].sort((a: string, b: string) => DAYS.indexOf(a) - DAYS.indexOf(b)).map((d: string) => (
                                  <span key={d} className="px-1.5 py-0.5 bg-primary/10 text-primary text-[10px] font-bold rounded">{d}</span>
                                ))}
                              </div>
                            )}
                            {member.siteStartTime && member.siteEndTime && (
                              <span className="text-xs text-muted-foreground">{member.siteStartTime.slice(0,5)}–{member.siteEndTime.slice(0,5)}</span>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground italic">No site schedule set</p>
                        )}
                      </div>
                      {caps.canManageTeam && (
                        <button
                          onClick={() => openSchedule(member)}
                          className="ml-2 p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-primary transition-colors shrink-0"
                          title="Edit schedule"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {isSubcontractor && (
                      <InsuranceCertZone
                        memberId={member.id}
                        projectId={projectId}
                        existingCertUrl={member.pliCertUrl ?? null}
                        existingExpiryDate={member.pliExpiryDate ?? null}
                        onSaved={() => queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/members`] })}
                      />
                    )}
                      </div>
                    );
                  })}
                        </div>
                      )}
                    </div>
                  );
                })}
                {caps.canManageProjects && (addingTrade ? (
                  <div className="flex items-center gap-2 px-2">
                    <input
                      autoFocus
                      value={newTradeName}
                      onChange={e => setNewTradeName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") submitAddTrade(); if (e.key === "Escape") { setAddingTrade(false); setNewTradeName(""); } }}
                      placeholder="e.g. Electrical, Roofing…"
                      className="flex-1 text-sm bg-muted rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-primary/30 border border-input"
                    />
                    <Button size="sm" variant="accent" onClick={submitAddTrade}>Add</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setAddingTrade(false); setNewTradeName(""); }}>Cancel</Button>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingTrade(true)}
                    className="flex items-center gap-2 px-4 py-3 w-full text-sm font-semibold text-muted-foreground hover:text-primary border-2 border-dashed border-muted hover:border-primary/40 rounded-xl transition-colors"
                  >
                    <FolderOpen className="w-4 h-4" />+ Add Trade Folder
                  </button>
                ))}
              </div>
            );
          })()}
        </TabsContent>



        <TabsContent value="issues">
          {(() => {
            const ISSUE_CATEGORY_LABEL: Record<string, string> = { snag: "Snag", safety_concern: "Safety Concern" };
            const ISSUE_CATEGORY_COLOUR: Record<string, string> = {
              snag: "bg-orange-50 border-orange-200 text-orange-700",
              safety_concern: "bg-red-50 border-red-200 text-red-700",
            };
            const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
              open:        { label: "Open",        cls: "bg-amber-50 border-amber-200 text-amber-700" },
              in_progress: { label: "In Progress", cls: "bg-blue-50 border-blue-200 text-blue-700" },
              resolved:    { label: "Resolved",    cls: "bg-emerald-50 border-emerald-200 text-emerald-700" },
            };
            const issuePhotos = photos.filter(p => p.category === "snag" || p.category === "safety_concern");
            const openCount = issuePhotos.filter(p => !p.status || p.status === "open").length;
            const inProgressCount = issuePhotos.filter(p => p.status === "in_progress").length;
            const resolvedCount = issuePhotos.filter(p => p.status === "resolved").length;
            const filtered = issuePhotos.filter(p => {
              const matchStatus = issueStatusFilter === "all" || (p.status ?? "open") === issueStatusFilter;
              const matchSearch = !issueSearch || (p.description ?? "").toLowerCase().includes(issueSearch.toLowerCase()) || (p.zone ?? "").toLowerCase().includes(issueSearch.toLowerCase()) || p.referenceNumber.toLowerCase().includes(issueSearch.toLowerCase());
              return matchStatus && matchSearch;
            });
            const ISSUE_TAG_OPTIONS = [
              { value: "snag", label: "Snag" },
              { value: "safety_concern", label: "Safety Concern" },
              { value: "work_completed", label: "Work Completed" },
            ];
            const ISSUE_TAG_COLOURS: Record<string, string> = {
              snag: "bg-orange-50 border-orange-200 text-orange-700",
              safety_concern: "bg-red-50 border-red-200 text-red-700",
              work_completed: "bg-teal-50 border-teal-200 text-teal-700",
            };
            return (
              <div>
                <div className="flex items-center gap-2 mb-5">
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                  <h3 className="font-bold text-lg">Site Issues</h3>
                  <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{issuePhotos.length}</span>
                </div>
                {/* Log new issue */}
                {caps.canLogPhoto && (
                  <Card className="mb-5">
                    <CardContent className="pt-6 space-y-4">
                      <div>
                        <h4 className="font-semibold text-sm mb-1">Log a site issue</h4>
                        <p className="text-xs text-muted-foreground">Tag the issue type, attach a photo, and add a description.</p>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Type</label>
                        <div className="flex flex-wrap gap-2">
                          {ISSUE_TAG_OPTIONS.map(opt => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => setPhotoTag(opt.value)}
                              className={cn(
                                "text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors",
                                photoTag === opt.value
                                  ? (ISSUE_TAG_COLOURS[opt.value] ?? "bg-primary/10 border-primary text-primary")
                                  : "bg-background border-border text-muted-foreground hover:border-primary/40"
                              )}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <FileDropZone
                        key={photoFormKey}
                        accept=".jpg,.jpeg,.png,.webp"
                        onUploaded={f => setPhotoUploadUrl(f.url)}
                        onCleared={() => setPhotoUploadUrl(null)}
                      />
                      <div className="grid sm:grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Description (optional)</label>
                          <Textarea value={photoNote} onChange={e => setPhotoNote(e.target.value)} placeholder="What does this photo show?" rows={2} />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Zone / location (optional)</label>
                          <Input value={photoZone} onChange={e => setPhotoZone(e.target.value)} placeholder="e.g. Level 2, East wing" />
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <Button onClick={submitSnagPhoto} disabled={!photoUploadUrl || photoSubmitting}>
                          {photoSubmitting ? "Logging…" : "Log issue"}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
                {/* Stats */}
                <div className="grid grid-cols-3 gap-3 mb-5">
                  <Card className="p-3 border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900 text-center">
                    <p className="text-xl font-extrabold text-amber-700">{openCount}</p>
                    <p className="text-xs text-amber-700 mt-0.5">Open</p>
                  </Card>
                  <Card className="p-3 border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-900 text-center">
                    <p className="text-xl font-extrabold text-blue-700">{inProgressCount}</p>
                    <p className="text-xs text-blue-700 mt-0.5">In Progress</p>
                  </Card>
                  <Card className="p-3 border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-900 text-center">
                    <p className="text-xl font-extrabold text-emerald-700">{resolvedCount}</p>
                    <p className="text-xs text-emerald-700 mt-0.5">Resolved</p>
                  </Card>
                </div>
                {/* Filters */}
                <div className="flex flex-col sm:flex-row gap-3 mb-5">
                  <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    <Input placeholder="Search issues…" className="pl-9" value={issueSearch} onChange={e => setIssueSearch(e.target.value)} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(["all", "open", "in_progress", "resolved"] as const).map(f => (
                      <button key={f} onClick={() => setIssueStatusFilter(f)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${issueStatusFilter === f ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:border-primary/40"}`}>
                        {f === "all" ? "All" : f === "in_progress" ? "In Progress" : f.charAt(0).toUpperCase() + f.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                {/* List */}
                <Card className="overflow-hidden">
                  {issuePhotos.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                      <AlertTriangle className="w-10 h-10 text-muted-foreground/30 mb-3" />
                      <p className="font-semibold text-muted-foreground">No site issues logged</p>
                      <p className="text-sm text-muted-foreground/70 mt-1">Use the form above to log snags, safety concerns, and completed work.</p>
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                      <p className="font-semibold text-muted-foreground">No issues match your filters.</p>
                    </div>
                  ) : (
                    <div className="divide-y">
                      {filtered.map(issue => {
                        const photoUrl = issue.photoUrl?.replace(/^\/uploads\//, "/api/uploads/") ?? null;
                        const statusInfo = STATUS_BADGE[issue.status ?? "open"] ?? STATUS_BADGE.open;
                        return (
                          <div key={issue.id} onClick={() => setViewingPhoto(issue)} className="flex gap-4 p-4 hover:bg-muted/20 transition-colors cursor-pointer">
                            <div className="w-20 h-16 rounded-lg overflow-hidden bg-muted shrink-0">
                              {photoUrl ? (
                                <img src={photoUrl} alt={issue.description ?? issue.category} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center"><Camera className="w-5 h-5 text-muted-foreground/40" /></div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap mb-1">
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${ISSUE_CATEGORY_COLOUR[issue.category] ?? ""}`}>{ISSUE_CATEGORY_LABEL[issue.category] ?? issue.category}</span>
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${statusInfo.cls}`}>{statusInfo.label}</span>
                                <span className="text-[10px] font-mono text-muted-foreground">{issue.referenceNumber}</span>
                              </div>
                              {issue.description && <p className="text-sm font-medium truncate">{issue.description}</p>}
                              <div className="flex items-center gap-3 mt-1 flex-wrap">
                                {issue.zone && <span className="text-xs text-muted-foreground flex items-center gap-1 truncate max-w-[120px]"><MapPin className="w-3 h-3 shrink-0" />{issue.zone}</span>}
                                <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(issue.takenAt)} · {issue.uploaderName}</span>
                              </div>
                            </div>
                            {caps.canManageProjects && (
                              <div className="shrink-0 flex items-center" onClick={e => e.stopPropagation()}>
                                {issue.status !== "resolved" ? (
                                  <button onClick={() => updatePhotoStatus(issue.id, "resolved")} title="Mark resolved" className="p-1.5 rounded-lg text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50 transition-colors">
                                    <CheckCircle2 className="w-4 h-4" />
                                  </button>
                                ) : (
                                  <button onClick={() => updatePhotoStatus(issue.id, "open")} title="Re-open" className="p-1.5 rounded-lg text-emerald-600 hover:text-muted-foreground hover:bg-muted transition-colors">
                                    <CheckCircle2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              </div>
            );
          })()}
        </TabsContent>

        {caps.isInternal && (
          <TabsContent value="reports">
            <div className="flex items-center gap-2 mb-2">
              <ClipboardCheck className="w-5 h-5 text-primary" />
              <h3 className="font-bold text-lg">Daily Site Reports</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-6">Auto-generated each evening (~18:00). Each report collates the day's subcontractor check-ins, document activity and tagged site photos.</p>
            {reports.length === 0 ? (
              <Card><CardContent className="py-12 text-center text-muted-foreground text-sm">
                No daily reports yet. The first one will appear after today's site activity is collated this evening.
              </CardContent></Card>
            ) : (
              <div className="space-y-2">
                {[...reports].sort((a, b) => b.reportDate.localeCompare(a.reportDate)).map(rep => (
                  <Card
                    key={rep.id}
                    onClick={() => openReportDetail(rep.id)}
                    className="flex items-center gap-4 px-4 py-4 cursor-pointer transition-colors hover:bg-muted/50"
                  >
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{formatDate(rep.reportDate)}</p>
                      <p className="text-xs text-muted-foreground">
                        {rep.checkinCount} check-in{rep.checkinCount === 1 ? "" : "s"} · {rep.documentEventCount} document update{rep.documentEventCount === 1 ? "" : "s"} · {rep.photoCount} site photo{rep.photoCount === 1 ? "" : "s"}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        )}

        <TabsContent value="permits">
          {(() => {
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const daysLeft = (dateStr: string) => Math.ceil((new Date(dateStr + "T00:00:00").getTime() - today.getTime()) / 86400000);
            const fmtDate = (s: string) => new Date(s + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

            const livePermits = [...permits].filter(p => !p.archivedAt);
            const supersededPermits = [...permits].filter(p => !!p.archivedAt).sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
            const active = livePermits.filter(p => { const d = daysLeft(p.expiryDate); return d > 30; }).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
            const expiring = livePermits.filter(p => { const d = daysLeft(p.expiryDate); return d >= 0 && d <= 30; }).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
            const expired = livePermits.filter(p => daysLeft(p.expiryDate) < 0).sort((a, b) => b.expiryDate.localeCompare(a.expiryDate));

            const permitRow = (p: PermitItem, accent: string) => {
              const days = daysLeft(p.expiryDate);
              const statusLabel = days < 0 ? "Expired" : days === 0 ? "Expires today" : days <= 7 ? `${days}d left` : days <= 30 ? `${days}d left` : "Active";
              return (
                <div key={p.id} className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 py-3 rounded-xl border ${accent}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{p.type}</p>
                      <Badge className={`text-[10px] border ${days < 0 ? "bg-red-100 text-red-700 border-red-200" : days <= 7 ? "bg-orange-100 text-orange-700 border-orange-200" : days <= 30 ? "bg-yellow-100 text-yellow-700 border-yellow-200" : "bg-emerald-100 text-emerald-700 border-emerald-200"}`}>{statusLabel}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{p.description}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{fmtDate(p.startDate)} – {fmtDate(p.expiryDate)}{p.responsibleName ? ` · ${p.responsibleName}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
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
                {/* Header */}
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold">Project Compliance</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">Permits, certifications and insurance for this project.</p>
                  </div>
                  <div className="flex items-center gap-2">
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
                  </div>
                </div>

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
                      <section>
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

                {/* Compliance Documents */}
                {(() => {
                  const complianceDocs = (documents ?? []).filter(d => ["permit", "safety", "method_statement"].includes(d.type));
                  return (
                    <section>
                      <div className="flex items-center justify-between gap-4 mb-3">
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-primary" />
                          <h3 className="font-bold text-sm uppercase tracking-wide text-muted-foreground">Compliance Documents</h3>
                          <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{complianceDocs.length}</span>
                        </div>
                      </div>
                      {complianceDocs.length === 0 ? (
                        <div
                          className="border-2 border-dashed rounded-xl p-8 text-center hover:border-primary/40 hover:bg-primary/5 transition-colors"
                          onClick={() => caps.canUploadDocument && (setValue("type", "permit"), setIsUploadOpen(true))}
                          style={{ cursor: caps.canUploadDocument ? "pointer" : "default" }}
                        >
                          <Upload className="w-8 h-8 mx-auto text-muted-foreground/30 mb-2" />
                          <p className="font-semibold text-muted-foreground">No compliance documents yet.</p>
                          <p className="text-sm text-muted-foreground mt-1">Upload permits, method statements, and safety documents here.</p>
                          {caps.canUploadDocument && (
                            <Button variant="outline" size="sm" className="mt-4" onClick={e => { e.stopPropagation(); setValue("type", "permit"); setIsUploadOpen(true); }}>
                              <Upload className="w-3.5 h-3.5 mr-1.5" /> Upload Document
                            </Button>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {complianceDocs.map(doc => {
                            const norm = doc.fileUrl.replace(/^\/uploads\//, "/api/uploads/");
                            const docUrl = norm.startsWith("http") ? norm : `${window.location.origin}${norm}`;
                            const isSuperseded = doc.status === "superseded";
                            return (
                              <div key={doc.id} className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 py-3 rounded-xl border ${isSuperseded ? "opacity-60 bg-muted/20" : "bg-card"}`}>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <FileText className="w-4 h-4 text-primary shrink-0" />
                                    <p className={`font-semibold text-sm truncate ${isSuperseded ? "line-through text-muted-foreground" : ""}`}>{doc.name}</p>
                                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground capitalize">{doc.type.replace(/_/g, " ")}</span>
                                    <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded">v{doc.version}</span>
                                    {isSuperseded && <span className="text-[10px] font-semibold text-destructive bg-red-100 px-1.5 py-0.5 rounded">Superseded</span>}
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-0.5 ml-6">{formatDate(doc.createdAt)} · {doc.uploaderName}</p>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    onClick={() => window.open(docUrl, "_blank", "noopener,noreferrer")}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/25 bg-primary/5 text-primary text-xs font-medium hover:bg-primary/15 transition-colors"
                                    title="Open document"
                                  >
                                    <ExternalLink className="w-3.5 h-3.5" /> Open
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
                          })}
                          {caps.canUploadDocument && (
                            <button
                              onClick={() => { setValue("type", "permit"); setIsUploadOpen(true); }}
                              className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed rounded-xl text-sm text-muted-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-colors"
                            >
                              <Upload className="w-4 h-4" /> Upload another document
                            </button>
                          )}
                        </div>
                      )}
                    </section>
                  );
                })()}

                {/* Team Insurance */}
                {members && (members as any[]).length > 0 && (
                  <section>
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
                  <div className="flex items-center justify-between gap-4 mb-3">
                    <div className="flex items-center gap-2">
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
                          <div key={p.id} className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border ${statusStyle(days)}`}>
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-sm truncate">{p.type}</p>
                              <p className="text-xs opacity-70 truncate">{p.description}{p.responsibleName ? ` · ${p.responsibleName}` : ""}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <div className="text-right">
                                <p className="text-xs font-semibold">{statusLabel(days)}</p>
                                <p className="text-xs opacity-70">{fmtDate(p.expiryDate)}</p>
                              </div>
                              {p.documentUrl && (
                                <button
                                  onClick={() => window.open(p.documentUrl!.replace(/^\/uploads\//, "/api/uploads/"), "_blank", "noopener,noreferrer")}
                                  title="Open certificate"
                                  className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-white/50 transition-colors"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-white/50 transition-colors" title="Share permit">
                                    <Share2 className="w-3.5 h-3.5" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-44">
                                  {p.documentUrl && (
                                    <DropdownMenuItem className="gap-2 cursor-pointer" onClick={() => window.open(p.documentUrl!.replace(/^\/uploads\//, "/api/uploads/"), "_blank", "noopener,noreferrer")}>
                                      <ExternalLink className="w-4 h-4 text-muted-foreground" /> Open Certificate
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuItem className="gap-2 cursor-pointer" onClick={() => {
                                    const subject = encodeURIComponent(`Permit – ${p.type}`);
                                    const body = encodeURIComponent(`Permit details:\n\nType: ${p.type}\nDescription: ${p.description}\nExpiry: ${fmtDate(p.expiryDate)} (${statusLabel(days)})${p.responsibleName ? `\nResponsible: ${p.responsibleName}` : ""}${p.documentUrl ? `\nCertificate: ${p.documentUrl.replace(/^\/uploads\//, "/api/uploads/")}` : ""}\nProject: ${project?.name ?? ""}`);
                                    window.open(`mailto:?subject=${subject}&body=${body}`);
                                  }}>
                                    <Mail className="w-4 h-4 text-muted-foreground" /> Send via Email
                                  </DropdownMenuItem>
                                  <DropdownMenuItem className="gap-2 cursor-pointer" onClick={() => {
                                    const text = encodeURIComponent(`Permit – ${p.type}\nExpiry: ${fmtDate(p.expiryDate)} (${statusLabel(days)})\n${p.description}${p.responsibleName ? `\nResponsible: ${p.responsibleName}` : ""}${p.documentUrl ? `\nCertificate: ${p.documentUrl.replace(/^\/uploads\//, "/api/uploads/")}` : ""}`);
                                    window.open(`https://wa.me/?text=${text}`, "_blank");
                                  }}>
                                    <MessageCircle className="w-4 h-4 text-green-600" /> Send via WhatsApp
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* Document Status */}
                <section>
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
                          <div key={doc.id} className={`flex items-center justify-between gap-4 px-4 py-3 rounded-xl border ${isSuperseded ? "bg-muted/30 border-border opacity-60" : pending > 0 ? "bg-yellow-50 border-yellow-200" : "bg-emerald-50 border-emerald-200"}`}>
                            <div className="flex items-center gap-3 min-w-0">
                              <FileText className="w-4 h-4 shrink-0 text-muted-foreground" />
                              <div className="min-w-0">
                                <p className={`font-semibold text-sm truncate ${isSuperseded ? "line-through text-muted-foreground" : ""}`}>{doc.name}</p>
                                <p className="text-xs text-muted-foreground capitalize">{doc.type.replace("_", " ")} · v{doc.version}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <div className="text-right">
                                {isSuperseded
                                  ? <Badge variant="secondary" className="text-[10px]">Superseded</Badge>
                                  : pending > 0
                                  ? <Badge className="text-[10px] bg-yellow-100 text-yellow-700 border-yellow-200">{pending} pending sign-off</Badge>
                                  : <Badge variant="success" className="text-[10px]">All signed off</Badge>
                                }
                                <p className="text-xs text-muted-foreground mt-0.5">{formatDate(doc.createdAt)}</p>
                              </div>
                              <button
                                onClick={() => window.open(doc.fileUrl.replace(/^\/uploads\//, "/api/uploads/"), "_blank", "noopener,noreferrer")}
                                title="Open document"
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-white/50 transition-colors"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setSharingDoc({ type: "document", id: doc.id, name: doc.name, version: doc.version, fileUrl: doc.fileUrl })}
                                title="Share document"
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-white/50 transition-colors"
                              >
                                <Share2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
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
                      <div className="px-4 py-3 rounded-xl border bg-emerald-50 border-emerald-200">
                        <div className="flex items-center gap-1.5 mb-0.5"><ArrowDownCircle className="w-4 h-4 text-emerald-600" /><p className="text-xs font-medium text-emerald-700">Due to You</p></div>
                        <p className="text-xl font-extrabold text-emerald-700">GBP {unpaidInbound.toLocaleString("en-GB", { minimumFractionDigits: 2 })}</p>
                      </div>
                      <div className="px-4 py-3 rounded-xl border bg-rose-50 border-rose-200">
                        <div className="flex items-center gap-1.5 mb-0.5"><ArrowUpCircle className="w-4 h-4 text-rose-600" /><p className="text-xs font-medium text-rose-700">You Owe</p></div>
                        <p className="text-xl font-extrabold text-rose-700">GBP {unpaidOutbound.toLocaleString("en-GB", { minimumFractionDigits: 2 })}</p>
                      </div>
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
                          <div key={inv.id} className={`flex items-center justify-between gap-4 px-4 py-3 rounded-xl border ${statusStyle(days, paid)}`}>
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
                            <div className="flex items-center gap-3 shrink-0">
                              <div className="text-right">
                                <p className="font-bold text-sm">{fmtAmt(inv.currency, inv.amount)}</p>
                                <p className="text-xs opacity-70">{paid ? "Paid" : statusLabel(days)} · {fmtDate(inv.dueDate)}</p>
                              </div>
                              <div className="flex items-center gap-1">
                                {inv.attachmentUrl && (
                                  <>
                                    <button
                                      onClick={() => window.open(invoiceFullUrl(inv.attachmentUrl!), "_blank", "noopener,noreferrer")}
                                      title="View invoice"
                                      className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
                                    >
                                      <Eye className="w-4 h-4" />
                                    </button>
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <button title="Share invoice" className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-muted transition-colors">
                                          <Share2 className="w-4 h-4" />
                                        </button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end" className="w-44">
                                        <DropdownMenuItem onClick={() => shareInvoiceEmail(inv)} className="gap-2 cursor-pointer">
                                          <Mail className="w-4 h-4 text-muted-foreground" /> Send via Email
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => shareInvoiceWhatsApp(inv)} className="gap-2 cursor-pointer">
                                          <MessageCircle className="w-4 h-4 text-green-600" /> Send via WhatsApp
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </>
                                )}
                                {paid && caps.canManageInvoices && (
                                  <button
                                    onClick={() => markInvoiceUnpaid(inv.id)}
                                    title="Mark unpaid and move back to Invoices"
                                    className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
                                  >
                                    <Clock className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
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

        <TabsContent value="qr">
          <div className="max-w-xl mx-auto py-4">
            <div className="text-center mb-8">
              <QrCode className="w-10 h-10 text-primary mx-auto mb-3" />
              <h2 className="text-xl font-bold">Site Board QR Code</h2>
              <p className="text-muted-foreground text-sm mt-1">
                Print this QR code and post it on site. Workers can scan it to view live project information, permits, and documents — no login required.
              </p>
            </div>

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
                                <p className="text-xs text-muted-foreground">{doc.type} · v{doc.version}</p>
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

        <TabsContent value="checkins">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold">Site Check-Ins</h2>
              <p className="text-muted-foreground text-sm mt-0.5">Workers who checked in on site via the QR code board.</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {siteBoardUrl && (
                <a
                  href={siteBoardUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-muted transition-colors text-sm font-medium"
                >
                  <QrCode className="w-3.5 h-3.5 text-primary" /> View Site Board
                </a>
              )}
              <span className="text-sm text-muted-foreground">{checkins.length} {checkins.length === 1 ? "check-in" : "check-ins"}</span>
            </div>
          </div>

          {checkins.length === 0 ? (
            <Card className="p-12 text-center border-dashed border-2">
              <p className="text-muted-foreground font-medium">No check-ins yet.</p>
              <p className="text-muted-foreground text-sm mt-1">Workers can check in by scanning the site board QR code.</p>
            </Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {checkins.map(ci => {
                const photoSrc = ci.photoUrl.startsWith("/uploads/") ? ci.photoUrl.replace("/uploads/", "/api/uploads/") : ci.photoUrl;
                const dt = new Date(ci.checkedInAt);
                const dateStr = dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
                const timeStr = dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
                return (
                  <div key={ci.id} className="rounded-xl overflow-hidden border bg-card shadow-sm">
                    <div className="aspect-square bg-muted relative cursor-pointer" onClick={() => window.open(photoSrc, '_blank', 'noopener,noreferrer')}>
                      <img src={photoSrc} alt={ci.workerName} className="w-full h-full object-cover" />
                    </div>
                    <div className="p-3">
                      <p className="font-semibold text-sm truncate">{ci.workerName}</p>
                      <p className="text-muted-foreground text-xs mt-0.5">{dateStr}</p>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <p className="text-muted-foreground text-xs">{timeStr}</p>
                        <button
                          onClick={() => setSharingDoc({ type: "photo", id: ci.id, name: `Check-in: ${ci.workerName}`, version: null, fileUrl: photoSrc })}
                          className="p-1 rounded-md text-muted-foreground hover:text-primary hover:bg-muted transition-colors shrink-0"
                          title="Share check-in"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!openReport || reportLoading} onOpenChange={v => { if (!v) setOpenReport(null); }}>
        <DialogHeader>
          <DialogTitle>{openReport ? `Daily site report — ${formatDate(openReport.reportDate)}` : "Loading report…"}</DialogTitle>
        </DialogHeader>
        {reportLoading && !openReport ? (
          <div className="py-10 flex justify-center"><RefreshCw className="w-6 h-6 text-muted-foreground animate-spin" /></div>
        ) : openReport ? (() => {
          const d = openReport.data;
          const REPORT_CATEGORY_LABELS: Record<string, string> = {
            general: "General", progress: "Progress", snag: "Snag", safety_concern: "Safety Concern",
            mistake: "Mistake", work_completed: "Work completed",
          };
          const totalEvents = openReport.checkinCount + openReport.documentEventCount + openReport.photoCount;
          const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
          return (
            <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-1">
              <p className="text-xs text-muted-foreground">{openReport.projectName} · generated {formatDate(openReport.generatedAt)}</p>
              {totalEvents === 0 && (
                <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">No site activity was recorded on this day.</CardContent></Card>
              )}

              {d.subcontractorsOnSite.length > 0 && (
                <div>
                  <h4 className="flex items-center gap-2 font-semibold text-sm mb-2"><Users className="w-4 h-4 text-primary" />Contacts on site ({d.subcontractorsOnSite.length})</h4>
                  <div className="space-y-1.5">
                    {d.subcontractorsOnSite.map(c => (
                      <div key={c.id} className="flex items-center justify-between text-sm border rounded-lg px-3 py-2">
                        <span className="font-medium">{c.workerName}</span>
                        <span className="text-xs text-muted-foreground">checked in {time(c.checkedInAt)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {openReport.documentEventCount > 0 && (
                <div>
                  <h4 className="flex items-center gap-2 font-semibold text-sm mb-2"><FileText className="w-4 h-4 text-primary" />Document activity ({openReport.documentEventCount})</h4>
                  <div className="space-y-1.5">
                    {d.documentActivity.uploaded.map(e => (
                      <div key={`u-${e.documentId}-${e.at}`} className="flex items-center gap-2 text-sm border rounded-lg px-3 py-2">
                        <Upload className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span className="flex-1 min-w-0 truncate"><span className="font-medium">{e.name}</span> uploaded by {e.uploaderName}</span>
                        <span className="text-xs text-muted-foreground shrink-0">{time(e.at)}</span>
                      </div>
                    ))}
                    {d.documentActivity.amended.map(e => (
                      <div key={`a-${e.documentId}-${e.at}`} className="flex items-center gap-2 text-sm border rounded-lg px-3 py-2">
                        <Pencil className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        <span className="flex-1 min-w-0 truncate"><span className="font-medium">{e.name}</span> amended (v{e.version}) by {e.uploaderName}</span>
                        <span className="text-xs text-muted-foreground shrink-0">{time(e.at)}</span>
                      </div>
                    ))}
                    {d.documentActivity.signedOff.map(e => (
                      <div key={`s-${e.documentId}-${e.at}`} className="flex items-center gap-2 text-sm border rounded-lg px-3 py-2">
                        <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" />
                        <span className="flex-1 min-w-0 truncate"><span className="font-medium">{e.documentName}</span> signed off by {e.userName}</span>
                        <span className="text-xs text-muted-foreground shrink-0">{time(e.at)}</span>
                      </div>
                    ))}
                    {d.documentActivity.viewed.map(e => (
                      <div key={`v-${e.documentId}-${e.at}`} className="flex items-center gap-2 text-sm border rounded-lg px-3 py-2">
                        <Eye className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="flex-1 min-w-0 truncate"><span className="font-medium">{e.documentName}</span> viewed by {e.userName}</span>
                        <span className="text-xs text-muted-foreground shrink-0">{time(e.at)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {d.sitePhotos.length > 0 && (
                <div>
                  <h4 className="flex items-center gap-2 font-semibold text-sm mb-2"><Camera className="w-4 h-4 text-primary" />Site photos ({d.sitePhotos.length})</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {d.sitePhotos.map(p => (
                      <div key={p.id} className="rounded-lg border overflow-hidden">
                        {p.photoUrl ? (
                          <a href={p.photoUrl} target="_blank" rel="noopener noreferrer">
                            <img src={p.photoUrl} alt={p.description ?? p.category} className="w-full h-28 object-cover" />
                          </a>
                        ) : (
                          <div className="w-full h-28 bg-muted flex items-center justify-center"><Camera className="w-6 h-6 text-muted-foreground" /></div>
                        )}
                        <div className="p-2 space-y-1">
                          <span className="text-[10px] font-bold">{REPORT_CATEGORY_LABELS[p.category] ?? p.category}</span>
                          {p.description && <p className="text-[11px] text-foreground line-clamp-2">{p.description}</p>}
                          <p className="text-[10px] text-muted-foreground">{time(p.takenAt)} · {p.uploaderName}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {d.siteManagerNotes.length > 0 && (
                <div>
                  <h4 className="flex items-center gap-2 font-semibold text-sm mb-2"><ClipboardCheck className="w-4 h-4 text-primary" />Site reports ({d.siteManagerNotes.length})</h4>
                  <div className="space-y-2">
                    {d.siteManagerNotes.map(n => (
                      <div key={n.id} className="rounded-lg border bg-muted/30 p-3">
                        <p className="text-[13px] text-foreground whitespace-pre-wrap">{n.body}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">{time(n.at)} · {n.authorName}{n.source === "voice" ? " · spoken" : ""}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })() : null}
      </Dialog>

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
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEditDocModal(null)}>Cancel</Button>
              <Button variant="accent" onClick={saveDocEdit} isLoading={editDocSaving}>Save</Button>
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
                {signOffNeedsPin && setPinMode ? "Set PIN & sign off" : "Sign off"}
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
                        <p className="font-semibold text-sm">{entry.userName}</p>
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
                  <option key={d.id} value={d.id}>{d.name} (v{d.version})</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">The selected document will be moved to the Superseded tab.</p>
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
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setIsUploadOpen(false)}>Cancel</Button>
            <Button type="submit" variant="accent" isLoading={uploadMutation.isPending}>Upload</Button>
          </DialogFooter>
        </form>
      </Dialog>

      <Dialog open={isEditOpen} onOpenChange={v => { setIsEditOpen(v); if (!v) setEditError(null); }}>
        <DialogHeader>
          <DialogTitle>Edit Project Details</DialogTitle>
        </DialogHeader>
        {editError && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
            {editError}
          </div>
        )}
        <form onSubmit={editHandleSubmit(onEditSubmit)} className="space-y-4">
          <div>
            <label className="text-sm font-semibold mb-1 block">Project Name</label>
            <Input {...editRegister("name", { required: true })} placeholder="e.g. Riverside Apartments" />
          </div>
          <div>
            <label className="text-sm font-semibold mb-1 block">Site Address</label>
            <Input {...editRegister("address", { required: true })} placeholder="123 River Road, London" icon={<MapPin className="w-4 h-4" />} />
          </div>
          <div>
            <label className="text-sm font-semibold mb-1 block">Status</label>
            <select {...editRegister("status")} className="flex h-11 w-full rounded-lg border-2 border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary">
              <option value="active">Active</option>
              <option value="on_hold">On Hold</option>
              <option value="complete">Complete</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-semibold mb-1 block">Target End Date</label>
            <Input type="date" {...editRegister("targetEndDate")} icon={<Calendar className="w-4 h-4" />} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setIsEditOpen(false)}>Cancel</Button>
            <Button type="submit" variant="accent" isLoading={updateMutation.isPending}>Save Changes</Button>
          </DialogFooter>
        </form>
      </Dialog>

      <Dialog open={fromDirOpen} onOpenChange={v => { if (!v) setFromDirOpen(false); }}>
        <DialogHeader>
          <DialogTitle>Add from Contacts Directory</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search by company or contact name…"
              className="pl-9"
              value={dirSearch}
              onChange={e => setDirSearch(e.target.value)}
            />
          </div>
          {dirSubsLoading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-muted rounded-lg animate-pulse" />)}
            </div>
          ) : (() => {
            const q = dirSearch.toLowerCase();
            const filtered = dirSubs.filter(s =>
              !q || s.companyName.toLowerCase().includes(q) || s.contactName.toLowerCase().includes(q)
            );
            return filtered.length === 0 ? (
              <p className="text-center text-muted-foreground text-sm py-8">
                {dirSubs.length === 0 ? "No subcontractors in your directory yet." : "No results match your search."}
              </p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {filtered.map((sub: any) => {
                  const alreadyAdded = (members as any[])?.some((m: any) => m.subcontractorId === sub.id);
                  return (
                    <div key={sub.id} className={cn(
                      "flex items-center justify-between gap-3 px-4 py-3 rounded-lg border transition-colors",
                      alreadyAdded ? "opacity-50 bg-muted/50" : "hover:bg-muted/30"
                    )}>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{sub.companyName}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {sub.contactName}{sub.trades?.length ? ` · ${sub.trades.join(", ")}` : ""}
                        </p>
                      </div>
                      {alreadyAdded ? (
                        <span className="text-xs text-muted-foreground shrink-0 font-medium">Already on project</span>
                      ) : (
                        <Button
                          size="sm"
                          variant="accent"
                          disabled={linkingSubId === sub.id}
                          onClick={() => linkSubcontractor(sub.id)}
                        >
                          {linkingSubId === sub.id ? "Adding…" : "Add"}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setFromDirOpen(false)}>Done</Button>
        </DialogFooter>
      </Dialog>

      <ShareModal
        open={!!sharingDoc}
        onClose={() => setSharingDoc(null)}
        entityType={sharingDoc?.type ?? "document"}
        entityId={sharingDoc?.id ?? ""}
        entityName={sharingDoc?.name ?? ""}
        fileUrl={sharingDoc?.fileUrl}
        projectId={projectId}
        version={sharingDoc?.version ?? null}
        additionalInfo={sharingDoc?.additionalInfo}
      />

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
          <div className="grid grid-cols-2 gap-4">
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

      {/* Add Permit Dialog */}
      <Dialog open={permitAddOpen} onOpenChange={v => { if (!v) { setPermitAddOpen(false); setNewPermitCertUrl(null); setNewPermitError(null); } }}>
        <DialogHeader>
          <DialogTitle>Add Permit / Certification</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <label className="text-sm font-semibold mb-1.5 block">Type</label>
            <select
              value={newPermitType}
              onChange={e => setNewPermitType(e.target.value)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {PERMIT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-semibold mb-1.5 block">Description / Reference</label>
            <Input
              placeholder="e.g. Hot works on roof — contractor Jones Ltd"
              value={newPermitDesc}
              onChange={e => setNewPermitDesc(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm font-semibold mb-1.5 block">Responsible Person</label>
            <select
              value={newPermitResponsibleId}
              onChange={e => setNewPermitResponsibleId(e.target.value)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select person…</option>
              {(members as any[] ?? []).filter((m: any) => !!m.userId).map((m: any) => (
                <option key={m.id} value={m.userId}>{m.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-semibold mb-1.5 block">Start Date</label>
              <Input type="date" value={newPermitStart} onChange={e => setNewPermitStart(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-semibold mb-1.5 block">Expiry Date</label>
              <Input type="date" value={newPermitExpiry} onChange={e => setNewPermitExpiry(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-sm font-semibold mb-1.5 block">Certificate / Document <span className="text-muted-foreground font-normal">(optional)</span></label>
            <FileDropZone
              onUploaded={f => setNewPermitCertUrl(f.url)}
              onCleared={() => setNewPermitCertUrl(null)}
            />
            {newPermitCertUrl && (
              <p className="mt-1.5 text-xs text-emerald-600 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Certificate uploaded
              </p>
            )}
          </div>
          {newPermitError && (
            <p className="flex items-center gap-1.5 text-sm text-destructive"><AlertTriangle className="w-4 h-4 shrink-0" />{newPermitError}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setPermitAddOpen(false)}>Cancel</Button>
          <Button variant="accent" onClick={submitNewPermit} disabled={newPermitSubmitting}>
            {newPermitSubmitting ? "Saving…" : "Save Permit"}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Photo detail overlay */}
      {viewingPhoto && (() => {
        const CATEGORY_LABELS: Record<string, string> = {
          general: "General", progress: "Progress", snag: "Snag", safety_concern: "Safety Concern",
          mistake: "Mistake", work_completed: "Work Completed",
        };
        const CATEGORY_COLOURS: Record<string, string> = {
          general: "bg-blue-50 border-blue-200 text-blue-700",
          progress: "bg-emerald-50 border-emerald-200 text-emerald-700",
          snag: "bg-orange-50 border-orange-200 text-orange-700",
          safety_concern: "bg-red-50 border-red-200 text-red-700",
          mistake: "bg-rose-50 border-rose-200 text-rose-700",
          work_completed: "bg-teal-50 border-teal-200 text-teal-700",
        };
        const isIssue = viewingPhoto.category === "snag" || viewingPhoto.category === "safety_concern";
        const photoUrl = viewingPhoto.photoUrl?.replace(/^\/uploads\//, "/api/uploads/") ?? null;
        return (
          <div className="fixed inset-0 z-50 flex items-stretch justify-center">
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setViewingPhoto(null)} />
            <div className="relative z-10 flex flex-col w-full max-w-4xl m-4 bg-background rounded-2xl shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center gap-3 px-5 py-4 border-b bg-muted/30 flex-shrink-0">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded border shrink-0 ${CATEGORY_COLOURS[viewingPhoto.category] ?? "bg-muted border-border text-muted-foreground"}`}>
                    {CATEGORY_LABELS[viewingPhoto.category] ?? viewingPhoto.category}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground shrink-0">{viewingPhoto.referenceNumber}</span>
                  {viewingPhoto.status === "open" && <span className="text-xs font-bold px-2 py-0.5 rounded border bg-amber-50 border-amber-200 text-amber-700 shrink-0">Open</span>}
                  {viewingPhoto.status === "in_progress" && <span className="text-xs font-bold px-2 py-0.5 rounded border bg-blue-50 border-blue-200 text-blue-700 shrink-0">In Progress</span>}
                  {viewingPhoto.status === "resolved" && <span className="text-xs font-bold px-2 py-0.5 rounded border bg-emerald-50 border-emerald-200 text-emerald-700 shrink-0">Resolved</span>}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {isIssue && caps.canManageProjects && viewingPhoto.status !== "resolved" && (
                    <button
                      onClick={() => updatePhotoStatus(viewingPhoto.id, "resolved")}
                      className="flex items-center gap-1.5 text-xs font-medium px-2 sm:px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /><span className="hidden sm:inline">Mark resolved</span>
                    </button>
                  )}
                  {isIssue && caps.canManageProjects && viewingPhoto.status === "resolved" && (
                    <button
                      onClick={() => updatePhotoStatus(viewingPhoto.id, "open")}
                      className="flex items-center gap-1.5 text-xs font-medium px-2 sm:px-3 py-1.5 rounded-lg border border-border bg-muted text-muted-foreground hover:bg-muted/70 transition-colors"
                    >
                      <Clock className="w-3.5 h-3.5" /><span className="hidden sm:inline">Re-open</span>
                    </button>
                  )}
                  {photoUrl && (
                    <button
                      onClick={() => window.open(photoUrl, "_blank", "noopener,noreferrer")}
                      className="flex items-center gap-1.5 text-xs font-medium px-2 sm:px-3 py-1.5 rounded-lg border bg-background hover:bg-muted transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /><span className="hidden sm:inline">Open</span>
                    </button>
                  )}
                  {photoUrl && (
                    <button
                      onClick={() => {
                        const isIssuePhoto = viewingPhoto.category === "snag" || viewingPhoto.category === "safety_concern";
                        const STATUS_LABEL: Record<string, string> = { open: "Open", in_progress: "In Progress", resolved: "Resolved" };
                        const info = isIssuePhoto ? [
                          `Type: ${viewingPhoto.category === "snag" ? "Snag" : "Safety Concern"}`,
                          `Ref: ${viewingPhoto.referenceNumber}`,
                          viewingPhoto.description ? `Description: ${viewingPhoto.description}` : null,
                          viewingPhoto.zone ? `Zone: ${viewingPhoto.zone}` : null,
                          `Project: ${project.name}`,
                          `Status: ${STATUS_LABEL[viewingPhoto.status ?? "open"] ?? "Open"}`,
                          `Logged: ${formatDate(viewingPhoto.takenAt)} by ${viewingPhoto.uploaderName}`,
                          (viewingPhoto.latitude && viewingPhoto.longitude) ? `GPS: ${Number(viewingPhoto.latitude).toFixed(5)}, ${Number(viewingPhoto.longitude).toFixed(5)}` : null,
                        ].filter(Boolean).join("\n") : undefined;
                        setSharingDoc({ type: "photo", id: viewingPhoto.id, name: `Photo ${viewingPhoto.referenceNumber}`, version: null, fileUrl: viewingPhoto.photoUrl!, additionalInfo: info });
                      }}
                      className="flex items-center gap-1.5 text-xs font-medium px-2 sm:px-3 py-1.5 rounded-lg border bg-background hover:bg-muted transition-colors"
                    >
                      <Share2 className="w-3.5 h-3.5" /><span className="hidden sm:inline">Share</span>
                    </button>
                  )}
                  <button onClick={() => setViewingPhoto(null)} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="flex flex-col sm:flex-row flex-1 min-h-0 overflow-hidden">
                {/* Details sidebar */}
                <div className="sm:w-64 flex-shrink-0 border-b sm:border-b-0 sm:border-r p-5 overflow-y-auto space-y-4">
                  {viewingPhoto.description && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Description</p>
                      <p className="text-sm">{viewingPhoto.description}</p>
                    </div>
                  )}
                  {viewingPhoto.zone && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Zone / Location</p>
                      <p className="text-sm flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-muted-foreground" />{viewingPhoto.zone}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Logged</p>
                    <p className="text-sm">{formatDate(viewingPhoto.takenAt)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">by {viewingPhoto.uploaderName}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Project</p>
                    <p className="text-sm font-medium">{project.name}</p>
                  </div>
                  {viewingPhoto.latitude != null && viewingPhoto.longitude != null && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">GPS</p>
                      <p className="text-xs font-mono text-muted-foreground">{Number(viewingPhoto.latitude).toFixed(5)}, {Number(viewingPhoto.longitude).toFixed(5)}</p>
                      <a
                        href={`https://www.google.com/maps?q=${viewingPhoto.latitude},${viewingPhoto.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline mt-0.5 inline-flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />View on map
                      </a>
                    </div>
                  )}
                  {viewingPhoto.resolvedAt && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Resolved</p>
                      <p className="text-sm">{formatDate(viewingPhoto.resolvedAt)}</p>
                    </div>
                  )}
                  {isIssue && caps.canManageProjects && (
                    <div className="pt-2 space-y-1.5">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Update Status</p>
                      {(["open", "in_progress", "resolved"] as const).map(s => (
                        <button
                          key={s}
                          onClick={() => updatePhotoStatus(viewingPhoto.id, s)}
                          className={cn(
                            "w-full text-left text-xs font-medium px-3 py-2 rounded-lg border transition-colors",
                            viewingPhoto.status === s
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border hover:bg-muted text-muted-foreground"
                          )}
                        >
                          {s === "open" ? "Open" : s === "in_progress" ? "In Progress" : "Resolved"}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Photo */}
                <div className="flex-1 min-h-0 overflow-auto bg-muted/20 flex items-center justify-center p-4">
                  {photoUrl ? (
                    <img
                      src={photoUrl}
                      alt={viewingPhoto.description ?? viewingPhoto.category}
                      className="max-w-full max-h-full object-contain rounded-lg shadow-md"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <Camera className="w-12 h-12 opacity-30" />
                      <p className="text-sm">No photo attached</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

    </SidebarLayout>
  );
}
