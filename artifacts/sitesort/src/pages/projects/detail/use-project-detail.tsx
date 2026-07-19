import { useState, useRef, useEffect } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { MapPin, Calendar, Upload, FileText, CheckCircle2, AlertTriangle, ShieldCheck, Eye, EyeOff, Users, Search, X, Phone, Mail, HardHat, UserCheck, Clock, Pencil, Camera, FolderOpen, ChevronDown, ChevronUp, ChevronRight, QrCode, Download, Printer, RefreshCw, ArrowDownCircle, ArrowUpCircle, Receipt, ClipboardCheck, UserPlus, ExternalLink, Share2, MessageCircle, FileDown, Plus, Trash2, Flag, Pin, PinOff, StickyNote, Send, Loader2, History, Archive, Paperclip } from "lucide-react";
import { ShareModal } from "@/components/share-modal";
import { DailyReportDetail, type ManagerReport } from "@/components/daily-report-detail";
import { useQueryClient } from "@tanstack/react-query";
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
import { useCapabilities } from "@/hooks/use-capabilities";
import { useSubscription } from "@/contexts/subscription";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";

// Drawing revision label (F3): drawings show "Rev A/B/C…" (or the architect's
// overridden rev); everything else keeps the numeric "v2" version.
export function docRev(doc: { type: string; version: number; revision?: string | null }): string {
return doc.type === "drawing" && doc.revision ? `Rev ${doc.revision}` : `v${doc.version}`;
}

export type PermitItem = { id: string; type: string; description: string; startDate: string; expiryDate: string; dueDate?: string | null; status: string; responsibleUserId?: string; responsibleName?: string; overdue?: boolean; documentUrl?: string | null; archivedAt?: string | null };
export type InvoiceItem = { id: string; direction: string; counterpartyName: string; description: string; amount: string; currency: string; dueDate: string; status: string; reference?: string | null; attachmentUrl?: string | null };
export type PhotoItem = { id: string; uploadedBy: string; uploaderName: string; photoUrl: string | null; category: string; description: string | null; zone: string | null; referenceNumber: string; takenAt: string; status: string | null; resolvedAt: string | null; latitude?: number | null; longitude?: number | null; assignedToUserId?: string | null; assignedToName?: string | null; dueDate?: string | null; overdue?: boolean; closureReason?: string | null; closureNote?: string | null };
export type MilestoneItem = { id: string; title: string; dueDate: string; completedAt: string | null; order: number };
export type CheckinItem = { id: string; workerName: string; photoUrl: string; checkedInAt: string; lat: number | null; lng: number | null };
export type ReportSummary = { id: string; reportDate: string; generatedAt: string; checkinCount: number; documentEventCount: number; photoCount: number; hasManagerReport?: boolean };
export type DailyReportData = {
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
export type ReportDetail = ReportSummary & { projectId: string; projectName: string; data: DailyReportData; managerReport?: ManagerReport | null; authorName?: string | null; authoredAt?: string | null };
export type DailyNote = { id: string; body: string; source: string; noteDate: string; photoUrl: string | null; authorName: string; createdAt: string };

export const PERMIT_TYPES = ["CSCS Check", "IPAF Certificate", "Hot Works", "Working at Heights", "Scaffolding Inspection", "Confined Space Entry", "Excavation", "Electrical Isolation", "Demolition", "Asbestos", "Method Statement", "Other"];

export type ShareLog = { id: string; entityType: string; entityId: string; entityName: string; method: string; recipientInfo: string | null; sentByName: string; createdAt: string };

export function useProjectDetailState() {
  const [, params] = useRoute("/projects/:id");
  const projectId = params?.id || "";
  const defaultTab = new URLSearchParams(window.location.search).get("tab") || "documents";

  const { data: project, isLoading: projectLoading } = useGetProject(projectId, { query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId) } });
  const { data: documents, refetch: refetchDocs } = useListDocuments(projectId, undefined, { query: { enabled: !!projectId, queryKey: getListDocumentsQueryKey(projectId, undefined) } });
  const { data: members } = useListProjectMembers(projectId, { query: { enabled: !!projectId, queryKey: getListProjectMembersQueryKey(projectId) } });


  const [permits, setPermits] = useState<PermitItem[]>([]);
  const [permitAddOpen, setPermitAddOpen] = useState(false);
  const [showSupersededPermits, setShowSupersededPermits] = useState(false);
  const [newPermitType, setNewPermitType] = useState("Hot Works");
  const [newPermitDesc, setNewPermitDesc] = useState("");
  const [newPermitResponsibleId, setNewPermitResponsibleId] = useState("");
  const [newPermitStart, setNewPermitStart] = useState("");
  const [newPermitExpiry, setNewPermitExpiry] = useState("");
  const [newPermitDue, setNewPermitDue] = useState("");
  const [newPermitCertUrl, setNewPermitCertUrl] = useState<string | null>(null);
  const [newPermitSubmitting, setNewPermitSubmitting] = useState(false);
  const [newPermitError, setNewPermitError] = useState<string | null>(null);
  // Edit / reassign an existing permit (F1 Phase 2). Wires the previously-unused
  // PATCH /api/permits/:id route — reassign the responsible person, set the
  // action due date, or correct the expiry/description.
  const [editingPermit, setEditingPermit] = useState<PermitItem | null>(null);
  const [editPermitSubmitting, setEditPermitSubmitting] = useState(false);
  const [editPermitError, setEditPermitError] = useState<string | null>(null);
  // Map a raw API permit onto PermitItem. The API exposes the assignee as
  // `responsibleUserName`; the UI displays it as `responsibleName`. Centralising
  // this keeps the initial load and the create/edit responses in one shape
  // (a prior bug left `responsibleName` blank on first load).
  const normalizePermit = (x: any): PermitItem => ({
    id: x.id, type: x.type, description: x.description,
    startDate: x.startDate, expiryDate: x.expiryDate, dueDate: x.dueDate ?? null,
    status: x.status, responsibleUserId: x.responsibleUserId,
    responsibleName: x.responsibleUserName ?? x.responsibleName,
    overdue: x.overdue, documentUrl: x.documentUrl ?? null, archivedAt: x.archivedAt ?? null,
  });

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
  const [reportInitialEditing, setReportInitialEditing] = useState(false);
  const [milestoneTitle, setMilestoneTitle] = useState("");
  const [milestoneDue, setMilestoneDue] = useState("");
  const [milestoneAdding, setMilestoneAdding] = useState(false);
  const [photoUploadUrl, setPhotoUploadUrl] = useState<string | null>(null);
  const [photoTag, setPhotoTag] = useState<string>("snag");
  const [photoNote, setPhotoNote] = useState("");
  const [photoZone, setPhotoZone] = useState("");
  const [photoAssignee, setPhotoAssignee] = useState<string>("");
  const [photoDue, setPhotoDue] = useState<string>("");
  const [photoSubmitting, setPhotoSubmitting] = useState(false);
  const [photoFormKey, setPhotoFormKey] = useState(0);
  const [viewingPhoto, setViewingPhoto] = useState<PhotoItem | null>(null);
  const [issueSearch, setIssueSearch] = useState("");
  const [issueStatusFilter, setIssueStatusFilter] = useState<"all" | "new" | "open" | "in_progress" | "pending_confirmation" | "resolved" | "overdue">("all");
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [todayNotes, setTodayNotes] = useState<DailyNote[]>([]);
  const [noteBody, setNoteBody] = useState("");
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [openingNote, setOpeningNote] = useState<DailyNote | null>(null);
  const [sharingNote, setSharingNote] = useState<DailyNote | null>(null);
  const [ovPhotoOpen, setOvPhotoOpen] = useState(false);
  const [ovPhotoUrl, setOvPhotoUrl] = useState<string | null>(null);
  const [ovPhotoNote, setOvPhotoNote] = useState("");
  const [ovPhotoKey, setOvPhotoKey] = useState(0);
  const [ovPhotoSubmitting, setOvPhotoSubmitting] = useState(false);

  const [, navigate] = useLocation();

  /**
   * Switch tabs in-page while keeping the URL shareable (real ?tab=&… query, history push
   * so the back button returns to the previous page). Optionally scrolls to a section anchor.
   */
  const openTab = (tab: string, params?: Record<string, string>, scrollId?: string) => {
    setActiveTab(tab);
    const sp = new URLSearchParams();
    sp.set("tab", tab);
    if (params) for (const [k, v] of Object.entries(params)) sp.set(k, v);
    navigate(`${window.location.pathname}?${sp.toString()}`);
    if (scrollId) {
      setTimeout(() => document.getElementById(scrollId)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    }
  };

  const authHeaders = () => {
    const t = localStorage.getItem("sitesort_token");
    return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" } as Record<string, string>;
  };

  const invoiceFullUrl = (attachmentUrl: string) => {
    const normalised = attachmentUrl.replace(/^\/uploads\//, "/api/uploads/");
    return normalised.startsWith("http") ? normalised : `${window.location.origin}${normalised}`;
  };
  // PATCH a site issue (status and/or assignment). Shared by the status pickers
  // and the assign-to / due-by controls so all updates refresh state the same way.
  const patchPhoto = async (photoId: string, patch: { status?: string; assignedToUserId?: string | null; dueDate?: string | null; closureReason?: string | null; closureNote?: string | null }, errTitle = "Couldn't update issue") => {
    const res = await fetch(`/api/photos/${photoId}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      toast({ title: errTitle, description: body?.message, variant: "destructive" });
      return;
    }
    const updated: PhotoItem = await res.json();
    setPhotos(prev => prev.map(p => p.id === photoId ? updated : p));
    setViewingPhoto(prev => prev?.id === photoId ? updated : prev);
  };

  const updatePhotoStatus = (photoId: string, status: string) => patchPhoto(photoId, { status }, "Couldn't update status");
  // PM confirms an assignee's "pending_confirmation" issue as fully resolved.
  const confirmIssueDone = (photoId: string) => patchPhoto(photoId, { status: "resolved" }, "Couldn't confirm issue");
  // PM-only: close a "new"/"open" issue directly without going through triage,
  // e.g. it was a duplicate report or turned out not to be a real issue.
  // Server-side enforces the PM role gate + requires a non-empty note.
  const closeIssueAsInvalid = (photoId: string, reason: "invalid" | "duplicate", note: string) =>
    patchPhoto(photoId, { status: "resolved", closureReason: reason, closureNote: note }, "Couldn't close issue");

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
            setActiveTab("issues");
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
        body: JSON.stringify({ body: text, source: "text", photoUrl: ovPhotoUrl }),
      });
      if (!res.ok) throw new Error("Failed to save note");
      toast({
        title: "Daily report saved",
        description: ovPhotoUrl ? "Update and photo added to today's site report." : "Added to today's site report.",
      });
      setNoteBody("");
      // Reset the attached-photo state so it isn't re-submitted with the next update.
      setOvPhotoUrl(null);
      setOvPhotoNote("");
      setOvPhotoOpen(false);
      setOvPhotoKey(k => k + 1);
      fetchTodayNotes();
    } catch {
      toast({ title: "Could not save", description: "Please try again.", variant: "destructive" });
    } finally {
      setNoteSubmitting(false);
    }
  };

  const openReportDetail = async (id: string, editing = false) => {
    setReportInitialEditing(editing);
    setReportLoading(true);
    try {
      const r = await fetch(`/api/daily-reports/${id}`, { headers: authHeaders() });
      if (r.ok) setOpenReport(await r.json());
    } finally {
      setReportLoading(false);
    }
  };

  // Open the site-diary editor for today (creating the report row on first save).
  const openTodaysDiary = () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const existing = reports.find(r => r.reportDate === today);
    if (existing) { openReportDetail(existing.id, true); return; }
    setReportInitialEditing(true);
    setOpenReport({
      id: "", projectId, projectName: project?.name ?? "",
      reportDate: today, generatedAt: "", checkinCount: 0, documentEventCount: 0, photoCount: 0,
      data: { subcontractorsOnSite: [], documentActivity: { uploaded: [], amended: [], viewed: [], signedOff: [] }, sitePhotos: [], siteManagerNotes: [] },
      managerReport: null, authorName: null, authoredAt: null,
    });
  };

  const submitSnagPhoto = async () => {
    if (!photoUploadUrl) return;
    setPhotoSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/photos`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ photoUrl: photoUploadUrl, category: photoTag, description: photoNote.trim() || null, zone: photoZone.trim() || null, assignedToUserId: photoAssignee || null, dueDate: photoDue || null }),
      });
      if (!res.ok) throw new Error("Failed to log photo");
      toast({ title: "Photo logged", description: "Added to today's site activity." });
      setPhotoUploadUrl(null);
      setPhotoNote("");
      setPhotoZone("");
      setPhotoTag("snag");
      setPhotoAssignee("");
      setPhotoDue("");
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
      setPermits((Array.isArray(p) ? p : []).map(normalizePermit)); setProjectInvoices(inv); setPhotos(ph); setMilestones(ms); setCheckins(ci); setReports(rep); setTodayNotes(notes);
      if (Array.isArray(pins)) setQrPins(pins);
      if (Array.isArray(qrCodes) && qrCodes.length > 0) {
        const qr = qrCodes.find((q: any) => q.category === "site_board") ?? qrCodes[0];
        const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
        const url = qr.siteUrl ?? `${window.location.origin}${BASE}/site/${qr.token}`;
        // Persist the generated QR so the Site Board tab shows it (not the empty
        // "Generate" state) on reload — the token was already saved server-side.
        setSiteBoardUrl(url);
        setQrCode({ token: qr.token, siteUrl: url });
        setQrFetched(true);
      }
    });
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    const rid = new URLSearchParams(window.location.search).get("report");
    if (rid) openReportDetail(rid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Apply deep-link filters/anchors carried in the URL on first load (shareable links).
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const st = sp.get("issueStatus");
    if (st && ["all", "new", "open", "in_progress", "pending_confirmation", "resolved", "overdue"].includes(st)) {
      setIssueStatusFilter(st as typeof issueStatusFilter);
    }
    const section = sp.get("section");
    if (section) {
      setTimeout(() => document.getElementById(`section-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 350);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { isCancelled } = useSubscription();
  const { toast } = useToast();
  const uploadMutation = useUploadDocument();
  const updateMutation = useUpdateProject();
  const queryClient = useQueryClient();
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [allocateDoc, setAllocateDoc] = useState<{ id: string; name: string } | null>(null);
  const [allocateSelected, setAllocateSelected] = useState<Set<string>>(new Set());
  const [allocateSubmitting, setAllocateSubmitting] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  type EditDocModal = { id: string; name: string; status: string; version: number; type: string; revision?: string | null };
  const [editDocModal, setEditDocModal] = useState<EditDocModal | null>(null);
  const [editDocSaving, setEditDocSaving] = useState(false);
  const [editDocStatus, setEditDocStatus] = useState("current");
  const [editDocVersion, setEditDocVersion] = useState(1);
  const [editDocRevision, setEditDocRevision] = useState("");
  // F3 — drawing revision history (the supersede chain)
  type RevisionItem = { id: string; version: number; revision: string | null; status: string; fileUrl: string; uploaderName: string; createdAt: string };
  const [revHistoryDoc, setRevHistoryDoc] = useState<{ id: string; name: string } | null>(null);
  const [revHistory, setRevHistory] = useState<RevisionItem[]>([]);
  const [revHistoryLoading, setRevHistoryLoading] = useState(false);
  const openRevHistory = async (doc: { id: string; name: string }) => {
    setRevHistoryDoc(doc);
    setRevHistory([]);
    setRevHistoryLoading(true);
    try {
      const res = await fetch(`/api/documents/${doc.id}/revisions`, { headers: authHeaders() });
      if (res.ok) setRevHistory(await res.json());
    } finally {
      setRevHistoryLoading(false);
    }
  };
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
    { query: { enabled: !!auditDoc && canViewAudit, queryKey: getGetDocumentAuditLogQueryKey(auditDoc?.id ?? "") } },
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

  // ── F2: project close-out / handover ─────────────────────────────────────
  type CloseoutChecks = {
    openIssues: { count: number; ok: boolean };
    insurance: { subsWithIssues: number; subsTotal: number; ok: boolean };
    permits: { expiredCount: number; ok: boolean };
    signOffs: { pendingCount: number; ok: boolean };
  };
  type CloseoutRecord = { id: string; signedOffByName: string; signedOffByRole: string; note: string | null; createdAt: string };
  type CloseoutData = { status: string; isComplete: boolean; ready: boolean; checks: CloseoutChecks; closeout: CloseoutRecord | null };
  const [closeout, setCloseout] = useState<CloseoutData | null>(null);
  const [closeoutOpen, setCloseoutOpen] = useState(false);
  const [closeoutPin, setCloseoutPin] = useState("");
  const [closeoutNote, setCloseoutNote] = useState("");
  const [closeoutSetPinMode, setCloseoutSetPinMode] = useState(false);
  const [closeoutSetPinPassword, setCloseoutSetPinPassword] = useState("");
  const [closeoutSetPinValue, setCloseoutSetPinValue] = useState("");
  const [closeoutSubmitting, setCloseoutSubmitting] = useState(false);
  const [closeoutError, setCloseoutError] = useState<string | null>(null);
  const [reopenSubmitting, setReopenSubmitting] = useState(false);

  const loadCloseout = async () => {
    if (!projectId) return;
    const res = await fetch(`/api/projects/${projectId}/closeout`, { headers: authHeaders() });
    if (res.ok) setCloseout(await res.json());
  };

  const openCloseout = () => {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    setCloseoutError(null);
    setCloseoutPin("");
    setCloseoutNote("");
    setCloseoutSetPinMode(!hasPin);
    setCloseoutSetPinPassword("");
    setCloseoutSetPinValue("");
    setCloseoutOpen(true);
  };

  const submitCloseout = async () => {
    setCloseoutError(null);
    let pinToUse: string;
    if (closeoutSetPinMode) {
      if (!closeoutSetPinPassword) { setCloseoutError("Enter your account password to set a PIN."); return; }
      if (!/^\d{4}$/.test(closeoutSetPinValue)) { setCloseoutError("PIN must be exactly 4 digits."); return; }
      pinToUse = closeoutSetPinValue;
    } else {
      if (!/^\d{4}$/.test(closeoutPin)) { setCloseoutError("Enter your 4-digit PIN."); return; }
      pinToUse = closeoutPin;
    }
    setCloseoutSubmitting(true);
    try {
      if (closeoutSetPinMode) {
        const pinRes = await fetch("/api/auth/pin", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ currentPassword: closeoutSetPinPassword, pin: closeoutSetPinValue }),
        });
        const pinData = await pinRes.json().catch(() => ({}));
        if (!pinRes.ok) { setCloseoutError(pinData.message ?? "Could not set your PIN."); setCloseoutSubmitting(false); return; }
        await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      }
      const res = await fetch(`/api/projects/${projectId}/closeout`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ pin: pinToUse, note: closeoutNote || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({ title: "Project closed out", description: "Signed off and marked Complete." });
        setCloseoutOpen(false);
        setCloseoutPin(""); setCloseoutNote(""); setCloseoutSetPinMode(false); setCloseoutSetPinPassword(""); setCloseoutSetPinValue("");
        await queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
        await loadCloseout();
        return;
      }
      if (res.status === 429) {
        setCloseoutError(data.message ?? "Too many incorrect attempts. Please try again later.");
      } else if (data.error === "pin_not_set") {
        setCloseoutSetPinMode(true);
        setCloseoutError("Set a sign-off PIN to continue.");
      } else if (typeof data.attemptsRemaining === "number") {
        setCloseoutError(`Incorrect PIN. ${data.attemptsRemaining} attempt${data.attemptsRemaining === 1 ? "" : "s"} remaining.`);
        setCloseoutPin("");
      } else {
        setCloseoutError(data.message ?? "Could not close out this project.");
      }
    } catch {
      setCloseoutError("Network error. Please try again.");
    } finally {
      setCloseoutSubmitting(false);
    }
  };

  const reopenProject = async () => {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    setReopenSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/closeout/reopen`, { method: "POST", headers: authHeaders() });
      if (res.ok) {
        toast({ title: "Project re-opened", description: "The project is active again." });
        await queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
        await loadCloseout();
      } else {
        toast({ title: "Could not re-open", description: "Please try again.", variant: "destructive" });
      }
    } finally {
      setReopenSubmitting(false);
    }
  };

  useEffect(() => { loadCloseout(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);

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
        body: JSON.stringify({ type: newPermitType, description: newPermitDesc.trim(), responsibleUserId: newPermitResponsibleId, startDate: newPermitStart, expiryDate: newPermitExpiry, dueDate: newPermitDue || undefined, documentUrl: newPermitCertUrl ?? undefined }),
      });
      if (!res.ok) throw new Error("Failed to create permit");
      const newP = await res.json();
      setPermits(prev => [...prev, normalizePermit(newP)]);
      setPermitAddOpen(false); setNewPermitType("Hot Works"); setNewPermitDesc(""); setNewPermitResponsibleId(""); setNewPermitStart(""); setNewPermitExpiry(""); setNewPermitDue(""); setNewPermitCertUrl(null); setNewPermitError(null);
    } catch {
      setNewPermitError("Failed to save permit. Please try again.");
    } finally {
      setNewPermitSubmitting(false);
    }
  };

  // Persist an edit/reassignment of an existing permit via PATCH /api/permits/:id.
  const submitEditPermit = async () => {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    if (!editingPermit) return;
    if (!editingPermit.description?.trim() || !editingPermit.responsibleUserId || !editingPermit.expiryDate) {
      setEditPermitError("Please fill in all required fields."); return;
    }
    setEditPermitSubmitting(true); setEditPermitError(null);
    try {
      const token = localStorage.getItem("sitesort_token");
      const res = await fetch(`/api/permits/${editingPermit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          description: editingPermit.description.trim(),
          responsibleUserId: editingPermit.responsibleUserId,
          expiryDate: editingPermit.expiryDate,
          dueDate: editingPermit.dueDate || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to update permit");
      const updated = normalizePermit(await res.json());
      setPermits(prev => prev.map(p => p.id === updated.id ? updated : p));
      setEditingPermit(null); setEditPermitError(null);
    } catch {
      setEditPermitError("Failed to save changes. Please try again.");
    } finally {
      setEditPermitSubmitting(false);
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
  // Contact / invoice shares route through the one ShareModal (External channels).
  const [sharingContact, setSharingContact] = useState<{ id: string; name: string; text: string } | null>(null);
  const [sharingInvoice, setSharingInvoice] = useState<InvoiceItem | null>(null);

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

  // Sub documents dialog (project Team tab) — F6
  type SubDocItem = { id: string; name: string; type: string; version: number; fileUrl: string; fileSize: number; status: "current" | "superseded"; projectId: string | null; projectName: string | null; uploaderName: string; createdAt: string };
  const SUB_DOC_TYPE_LABELS: Record<string, string> = { terms: "Signed T&Cs", tax_form: "Tax Form (W9/UTR)", certification: "Certification", id_verification: "ID Verification", other: "Other" };
  const [subDocsTarget, setSubDocsTarget] = useState<{ id: string; name: string } | null>(null);
  const [subDocsList, setSubDocsList] = useState<SubDocItem[]>([]);
  const [subDocsLoading, setSubDocsLoading] = useState(false);
  const [subDocScope, setSubDocScope] = useState<"general" | "project">("project");
  const [subDocName, setSubDocName] = useState("");
  const [subDocType, setSubDocType] = useState("terms");
  const [subDocFile, setSubDocFile] = useState<{ url: string; size: number } | null>(null);
  const [subDocSubmitting, setSubDocSubmitting] = useState(false);
  const [subDocFileZoneKey, setSubDocFileZoneKey] = useState(0);

  async function openSubDocs(memberId: string, memberName: string) {
    setSubDocsTarget({ id: memberId, name: memberName });
    setSubDocsList([]);
    setSubDocScope("project");
    setSubDocName("");
    setSubDocType("terms");
    setSubDocFile(null);
    setSubDocFileZoneKey(k => k + 1);
    setSubDocsLoading(true);
    const token = localStorage.getItem("sitesort_token");
    const res = await fetch(`/api/subcontractors/${memberId}/documents?projectId=${projectId}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (res.ok) setSubDocsList(await res.json());
    setSubDocsLoading(false);
  }

  async function submitSubDoc() {
    if (!subDocsTarget || !subDocName.trim() || !subDocFile) return;
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    setSubDocSubmitting(true);
    const token = localStorage.getItem("sitesort_token");
    const res = await fetch(`/api/subcontractors/${subDocsTarget.id}/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        name: subDocName.trim(), type: subDocType, fileUrl: subDocFile.url, fileSize: subDocFile.size,
        projectId: subDocScope === "project" ? projectId : null,
      }),
    });
    if (res.ok) {
      const created: SubDocItem = await res.json();
      setSubDocsList(prev => [
        created,
        ...prev.map(d => (d.name === created.name && d.projectId === created.projectId && d.status === "current") ? { ...d, status: "superseded" as const } : d),
      ]);
      setSubDocName("");
      setSubDocFile(null);
      setSubDocFileZoneKey(k => k + 1);
    } else {
      toast({ title: "Couldn't upload", description: "Please try again.", variant: "destructive" });
    }
    setSubDocSubmitting(false);
  }

  // Remove from project (person, legacy user, or whole subcontractor company)
  type RemoveTarget = { kind: "member" | "company"; id: string; name: string; isPortal: boolean };
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);
  const [removing, setRemoving] = useState(false);

  async function confirmRemove() {
    if (!removeTarget) return;
    setRemoving(true);
    const token = localStorage.getItem("sitesort_token");
    const url = removeTarget.kind === "company"
      ? `/api/projects/${projectId}/members/company/${removeTarget.id}`
      : `/api/projects/${projectId}/members/${removeTarget.id}`;
    const res = await fetch(url, { method: "DELETE", headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (res.ok) {
      toast({ title: "Removed from project", description: `${removeTarget.name} ${removeTarget.kind === "company" ? "and their people were" : "was"} removed from this project.` });
      setRemoveTarget(null);
      await queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/members`] });
    } else {
      const err = await res.json().catch(() => ({}));
      toast({ title: "Couldn't remove", description: err.message ?? "Please try again.", variant: "destructive" });
    }
    setRemoving(false);
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
          ...(data.type === "drawing" && data.revision?.trim() ? { revision: data.revision.trim() } : {}),
        } as any
      });
      setIsUploadOpen(false);
      reset();
      refetchDocs();
    } catch (e) {
      console.error(e);
    }
  };

  const openDocEdit = (doc: { id: string; name: string; status: string; version: number; type: string; revision?: string | null }) => {
    setEditDocStatus(doc.status);
    setEditDocVersion(doc.version);
    setEditDocRevision(doc.revision ?? "");
    setEditDocModal(doc);
  };

  const openAllocate = (doc: { id: string; name: string }) => {
    setAllocateSelected(new Set());
    setAllocateDoc(doc);
  };

  const toggleAllocate = (userId: string) => {
    setAllocateSelected(prev => {
      const next = new Set(prev);
      next.has(userId) ? next.delete(userId) : next.add(userId);
      return next;
    });
  };

  // Allocate (distribute) a document to selected team members. Creates a tracked
  // distribution record per recipient + emails them a tracked open link, so the
  // allocation registers and the view count moves when they open it.
  const submitAllocate = async () => {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    if (!allocateDoc) return;
    const userIds = Array.from(allocateSelected);
    if (userIds.length === 0) return;
    setAllocateSubmitting(true);
    try {
      const token = localStorage.getItem("sitesort_token");
      const res = await fetch(`/api/documents/${allocateDoc.id}/distribute`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ userIds }),
      });
      if (!res.ok) throw new Error("Failed to allocate");
      toast({ title: "Document allocated", description: `Sent to ${userIds.length} recipient${userIds.length === 1 ? "" : "s"}.` });
      setAllocateDoc(null);
      setAllocateSelected(new Set());
      refetchDocs();
    } catch {
      toast({ title: "Couldn't allocate", description: "Please try again.", variant: "destructive" });
    } finally {
      setAllocateSubmitting(false);
    }
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
        body: JSON.stringify({
          status: editDocStatus,
          version: editDocVersion,
          // Only drawings carry a revision; send it (empty clears it back to null).
          ...(editDocModal.type === "drawing" ? { revision: editDocRevision } : {}),
        }),
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

  return {
    params,
    projectId,
    defaultTab,
    project,
    projectLoading,
    documents,
    refetchDocs,
    members,
    permits,
    setPermits,
    permitAddOpen,
    setPermitAddOpen,
    showSupersededPermits,
    setShowSupersededPermits,
    newPermitType,
    setNewPermitType,
    newPermitDesc,
    setNewPermitDesc,
    newPermitResponsibleId,
    setNewPermitResponsibleId,
    newPermitStart,
    setNewPermitStart,
    newPermitExpiry,
    setNewPermitExpiry,
    newPermitDue,
    setNewPermitDue,
    newPermitCertUrl,
    setNewPermitCertUrl,
    newPermitSubmitting,
    setNewPermitSubmitting,
    newPermitError,
    setNewPermitError,
    editingPermit,
    setEditingPermit,
    editPermitSubmitting,
    setEditPermitSubmitting,
    editPermitError,
    setEditPermitError,
    normalizePermit,
    projectShareLog,
    setProjectShareLog,
    projectShareLogLoading,
    setProjectShareLogLoading,
    loadProjectShareLog,
    projectInvoices,
    setProjectInvoices,
    photos,
    setPhotos,
    milestones,
    setMilestones,
    checkins,
    setCheckins,
    reports,
    setReports,
    openReport,
    setOpenReport,
    reportLoading,
    setReportLoading,
    reportInitialEditing,
    setReportInitialEditing,
    milestoneTitle,
    setMilestoneTitle,
    milestoneDue,
    setMilestoneDue,
    milestoneAdding,
    setMilestoneAdding,
    photoUploadUrl,
    setPhotoUploadUrl,
    photoTag,
    setPhotoTag,
    photoNote,
    setPhotoNote,
    photoZone,
    setPhotoZone,
    photoAssignee,
    setPhotoAssignee,
    photoDue,
    setPhotoDue,
    photoSubmitting,
    setPhotoSubmitting,
    photoFormKey,
    setPhotoFormKey,
    viewingPhoto,
    setViewingPhoto,
    issueSearch,
    setIssueSearch,
    issueStatusFilter,
    setIssueStatusFilter,
    activeTab,
    setActiveTab,
    todayNotes,
    setTodayNotes,
    noteBody,
    setNoteBody,
    noteSubmitting,
    setNoteSubmitting,
    openingNote,
    setOpeningNote,
    sharingNote,
    setSharingNote,
    ovPhotoOpen,
    setOvPhotoOpen,
    ovPhotoUrl,
    setOvPhotoUrl,
    ovPhotoNote,
    setOvPhotoNote,
    ovPhotoKey,
    setOvPhotoKey,
    ovPhotoSubmitting,
    setOvPhotoSubmitting,
    navigate,
    openTab,
    authHeaders,
    invoiceFullUrl,
    patchPhoto,
    updatePhotoStatus,
    confirmIssueDone,
    closeIssueAsInvalid,
    markInvoiceUnpaid,
    fetchMilestones,
    fetchPhotos,
    fetchReports,
    fetchTodayNotes,
    submitDailyNote,
    openReportDetail,
    openTodaysDiary,
    submitSnagPhoto,
    submitOverviewPhoto,
    isCancelled,
    toast,
    uploadMutation,
    updateMutation,
    queryClient,
    isUploadOpen,
    setIsUploadOpen,
    allocateDoc,
    setAllocateDoc,
    allocateSelected,
    setAllocateSelected,
    allocateSubmitting,
    setAllocateSubmitting,
    isEditOpen,
    setIsEditOpen,
    editDocModal,
    setEditDocModal,
    editDocSaving,
    setEditDocSaving,
    editDocStatus,
    setEditDocStatus,
    editDocVersion,
    setEditDocVersion,
    editDocRevision,
    setEditDocRevision,
    revHistoryDoc,
    setRevHistoryDoc,
    revHistory,
    setRevHistory,
    revHistoryLoading,
    setRevHistoryLoading,
    openRevHistory,
    editError,
    setEditError,
    me,
    caps,
    hasPin,
    PIN_REQUIRED_TYPES,
    signOffDoc,
    setSignOffDoc,
    signOffPin,
    setSignOffPin,
    signOffSubmitting,
    setSignOffSubmitting,
    signOffError,
    setSignOffError,
    setPinMode,
    setSetPinMode,
    setPinPassword,
    setSetPinPassword,
    setPinValue,
    setSetPinValue,
    signOffNeedsPin,
    onlyDigits,
    myRole,
    canViewAudit,
    auditDoc,
    setAuditDoc,
    auditEntries,
    auditLoading,
    openSignOff,
    closeSignOff,
    submitSignOff,
    closeout,
    setCloseout,
    closeoutOpen,
    setCloseoutOpen,
    closeoutPin,
    setCloseoutPin,
    closeoutNote,
    setCloseoutNote,
    closeoutSetPinMode,
    setCloseoutSetPinMode,
    closeoutSetPinPassword,
    setCloseoutSetPinPassword,
    closeoutSetPinValue,
    setCloseoutSetPinValue,
    closeoutSubmitting,
    setCloseoutSubmitting,
    closeoutError,
    setCloseoutError,
    reopenSubmitting,
    setReopenSubmitting,
    loadCloseout,
    openCloseout,
    submitCloseout,
    reopenProject,
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    editRegister,
    editHandleSubmit,
    editReset,
    openFolders,
    setOpenFolders,
    toggleFolder,
    isFolderOpen,
    addingTrade,
    setAddingTrade,
    newTradeName,
    setNewTradeName,
    submitAddTrade,
    editingPhoneId,
    setEditingPhoneId,
    phoneInput,
    setPhoneInput,
    savePhone,
    submitNewPermit,
    submitEditPermit,
    deletePermit,
    selectedDocType,
    setSelectedDocType,
    searchQuery,
    setSearchQuery,
    selectedStatus,
    setSelectedStatus,
    siteBoardUrl,
    setSiteBoardUrl,
    qrCode,
    setQrCode,
    qrLoading,
    setQrLoading,
    qrFetched,
    setQrFetched,
    qrSvgRef,
    qrPins,
    setQrPins,
    isPinned,
    togglePin,
    loadQr,
    downloadQr,
    printQr,
    scheduleTarget,
    setScheduleTarget,
    scheduleError,
    setScheduleError,
    fromDirOpen,
    setFromDirOpen,
    dirSubs,
    setDirSubs,
    dirSubsLoading,
    setDirSubsLoading,
    dirSearch,
    setDirSearch,
    linkingSubId,
    setLinkingSubId,
    openFromDirectory,
    linkSubcontractor,
    sharingDoc,
    setSharingDoc,
    sharingContact,
    setSharingContact,
    sharingInvoice,
    setSharingInvoice,
    subNotesTarget,
    setSubNotesTarget,
    subNotesList,
    setSubNotesList,
    subNotesLoading,
    setSubNotesLoading,
    subNoteDraft,
    setSubNoteDraft,
    subNoteScope,
    setSubNoteScope,
    subNoteSubmitting,
    setSubNoteSubmitting,
    openSubNotes,
    submitSubNote,
    SUB_DOC_TYPE_LABELS,
    subDocsTarget,
    setSubDocsTarget,
    subDocsList,
    setSubDocsList,
    subDocsLoading,
    setSubDocsLoading,
    subDocScope,
    setSubDocScope,
    subDocName,
    setSubDocName,
    subDocType,
    setSubDocType,
    subDocFile,
    setSubDocFile,
    subDocSubmitting,
    setSubDocSubmitting,
    subDocFileZoneKey,
    setSubDocFileZoneKey,
    openSubDocs,
    submitSubDoc,
    removeTarget,
    setRemoveTarget,
    removing,
    setRemoving,
    confirmRemove,
    schedRegister,
    schedHandleSubmit,
    schedReset,
    schedSetValue,
    schedWatch,
    DAYS,
    openSchedule,
    onScheduleSubmit,
    watchedType,
    supersedableDocs,
    onUpload,
    openDocEdit,
    openAllocate,
    toggleAllocate,
    submitAllocate,
    saveDocEdit,
    openEdit,
    onEditSubmit,
    generateReport,
  };
}
