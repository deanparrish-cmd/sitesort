import { useState, useEffect, useCallback, useMemo } from "react";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ShareModal } from "@/components/share-modal";
import { FileDropZone } from "@/components/ui/file-drop-zone";
import {
  Plus, Search, ChevronDown, ChevronRight, HardHat, Mail, Phone,
  ShieldCheck, ShieldAlert, ShieldX, Shield, Star, AlertTriangle,
  Users, Pencil, X, FolderOpen, MessageSquare,
  FolderPlus, CheckCircle2, Loader2, Building2,
  Share2, StickyNote, Clock, Send, FileText, ExternalLink, UserCheck, Trash2,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { cn } from "@/lib/utils";
import { useSubscription } from "@/contexts/subscription";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useToast } from "@/hooks/use-toast";

type InsuranceStatus = "valid" | "expiring_soon" | "expired" | "none";

type ContactType = "subcontractor" | "merchant" | "supplier" | "professional" | "other";

const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  subcontractor: "Subcontractor",
  merchant: "Merchant",
  supplier: "Supplier",
  professional: "Professional Services",
  other: "Other",
};

const CONTACT_TYPE_GROUP_LABELS: Record<string, string> = {
  merchant: "Merchants",
  supplier: "Suppliers",
  professional: "Professional Services",
  other: "Other Contacts",
};

// Reverse: group label → contact type key
const GROUP_LABEL_TO_TYPE: Record<string, ContactType> = Object.fromEntries(
  Object.entries(CONTACT_TYPE_GROUP_LABELS).map(([k, v]) => [v, k as ContactType])
);

type InsuranceRecord = {
  id: string;
  type: string;
  certificateUrl: string;
  expiryDate: string;
  status: string;
  assignedToUserId?: string | null;
  assignedToUserName?: string | null;
  dueDate?: string | null;
  overdue?: boolean;
};

type CompanyUser = { id: string; name: string; role: string };

type Sub = {
  id: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  contactType: ContactType;
  trades: string[];
  reliabilityRating: number | null;
  paymentHold: boolean;
  notes: string | null;
  insuranceStatus: InsuranceStatus;
  insuranceRecords: InsuranceRecord[];
  createdAt: string;
};

type SubNote = {
  id: string;
  body: string;
  authorName: string;
  projectId: string | null;
  projectName: string | null;
  createdAt: string;
};

type SubDoc = {
  id: string;
  name: string;
  type: string;
  version: number;
  fileUrl: string;
  fileSize: number;
  status: "current" | "superseded";
  projectId: string | null;
  projectName: string | null;
  uploaderName: string;
  createdAt: string;
};

const DOC_TYPE_LABELS: Record<string, string> = {
  terms: "Signed T&Cs",
  tax_form: "Tax Form (W9/UTR)",
  certification: "Certification",
  id_verification: "ID Verification",
  other: "Other",
};

function formatNoteTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const TRADE_CATEGORIES = [
  "Builders",
  "Electricians",
  "Plumbers",
  "Roofers",
  "Carpenters",
  "Plasterers",
  "Painters & Decorators",
  "Scaffolders",
  "Groundworkers",
  "Steelworkers",
  "Glaziers",
  "Heating Engineers",
  "Landscapers",
  "Demolition",
  "Other",
];

function normaliseUrl(url: string) {
  return url.startsWith("/uploads/") ? `/api${url}` : url;
}

function insuranceBadge(status: InsuranceStatus) {
  if (status === "valid") return <Badge className="gap-1 text-[10px] bg-emerald-100 text-emerald-700 border-emerald-200"><ShieldCheck className="w-3 h-3" />Insurance OK</Badge>;
  if (status === "expiring_soon") return <Badge className="gap-1 text-[10px] bg-yellow-100 text-yellow-700 border-yellow-200"><ShieldAlert className="w-3 h-3" />Expiring Soon</Badge>;
  if (status === "expired") return <Badge variant="destructive" className="gap-1 text-[10px]"><ShieldX className="w-3 h-3" />Site Access Denied</Badge>;
  return <Badge variant="secondary" className="gap-1 text-[10px]"><Shield className="w-3 h-3" />No Insurance</Badge>;
}

function RatingStars({ rating }: { rating: number | null }) {
  if (!rating) return null;
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <Star key={n} className={cn("w-3 h-3", n <= rating ? "fill-orange-400 text-orange-400" : "text-muted-foreground/30")} />
      ))}
    </div>
  );
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  );
}

function ContactActions({ email, phone }: { email: string; phone: string | null }) {
  const cleanPhone = phone?.replace(/\D/g, "") ?? null;
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      {phone && (
        <>
          <a
            href={`tel:${phone}`}
            title={`Call ${phone}`}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
          >
            <Phone className="w-4 h-4" />
          </a>
          <a
            href={`sms:${phone}`}
            title={`Text ${phone}`}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
          >
            <MessageSquare className="w-4 h-4" />
          </a>
          <a
            href={`https://wa.me/${cleanPhone}`}
            target="_blank"
            rel="noreferrer"
            title={`WhatsApp ${phone}`}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-[#25D366] hover:bg-green-50 dark:hover:bg-green-950/30 transition-colors"
          >
            <WhatsAppIcon className="w-4 h-4" />
          </a>
        </>
      )}
      {email && (
        <a
          href={`mailto:${email}`}
          title={`Email ${email}`}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
        >
          <Mail className="w-4 h-4" />
        </a>
      )}
    </div>
  );
}

function apiFetch(path: string, options?: RequestInit) {
  const token = localStorage.getItem("sitesort_token");
  return fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
}

type AddFormData = {
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  contactType: ContactType;
  trades: string[];
  notes: string;
};

type EditFormData = AddFormData & { reliabilityRating: string; paymentHold: boolean };

export default function SubcontractorsPage() {
  const { isCancelled } = useSubscription();
  const { toast } = useToast();
  const caps = useCapabilities();
  const [subs, setSubs] = useState<Sub[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [openTrades, setOpenTrades] = useState<Record<string, boolean>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Sub | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedTradesAdd, setSelectedTradesAdd] = useState<string[]>([]);
  const [selectedTradesEdit, setSelectedTradesEdit] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<ContactType | "all">("all");

  // Share-to-project state
  type ProjectLinkStatus = "idle" | "loading" | "added" | "already" | "error";
  type ActiveProject = { id: string; name: string; address: string };
  const [shareTarget, setShareTarget] = useState<Sub | null>(null);
  const [sharingContact, setSharingContact] = useState<{ id: string; name: string; text: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Sub | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [shareProjects, setShareProjects] = useState<ActiveProject[]>([]);
  const [shareProjectsLoading, setShareProjectsLoading] = useState(false);
  const [linkStatus, setLinkStatus] = useState<Record<string, ProjectLinkStatus>>({});

  // Notes state
  const [notesTarget, setNotesTarget] = useState<Sub | null>(null);
  const [notesList, setNotesList] = useState<SubNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [noteScope, setNoteScope] = useState<"general" | "project">("general");
  const [noteProjectId, setNoteProjectId] = useState("");
  const [noteProjects, setNoteProjects] = useState<{ id: string; name: string }[]>([]);

  // Documents state (F6)
  const [docsTarget, setDocsTarget] = useState<Sub | null>(null);
  const [docsList, setDocsList] = useState<SubDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docScope, setDocScope] = useState<"general" | "project">("general");
  const [docProjectId, setDocProjectId] = useState("");
  const [docProjects, setDocProjects] = useState<{ id: string; name: string }[]>([]);
  const [docName, setDocName] = useState("");
  const [docType, setDocType] = useState("terms");
  const [docFile, setDocFile] = useState<{ url: string; size: number } | null>(null);
  const [docSubmitting, setDocSubmitting] = useState(false);
  const [docFileZoneKey, setDocFileZoneKey] = useState(0);

  // Insurance assign/reassign dialog (F1 Phase 3)
  const [insTarget, setInsTarget] = useState<{ sub: Sub; record: InsuranceRecord } | null>(null);
  const [insAssignee, setInsAssignee] = useState("");
  const [insDueDate, setInsDueDate] = useState("");
  const [insSubmitting, setInsSubmitting] = useState(false);
  const [insError, setInsError] = useState<string | null>(null);
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([]);

  // Company users for the assignee dropdown — fetched once.
  useEffect(() => {
    apiFetch("/api/users")
      .then(r => r.ok ? r.json() : [])
      .then((u: CompanyUser[]) => setCompanyUsers(u))
      .catch(() => setCompanyUsers([]));
  }, []);

  const openInsAssign = (sub: Sub, record: InsuranceRecord) => {
    setInsTarget({ sub, record });
    setInsAssignee(record.assignedToUserId ?? "");
    setInsDueDate(record.dueDate ? record.dueDate.slice(0, 10) : "");
    setInsError(null);
  };

  const saveInsAssign = async () => {
    if (!insTarget) return;
    if (isCancelled) { toast({ variant: "destructive", title: "Subscription inactive", description: "Reactivate to make changes." }); return; }
    setInsSubmitting(true);
    setInsError(null);
    const res = await apiFetch(`/api/subcontractors/${insTarget.sub.id}/insurance/${insTarget.record.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignedToUserId: insAssignee || null, dueDate: insDueDate || null }),
    });
    setInsSubmitting(false);
    if (!res.ok) { setInsError("Failed to save. Please try again."); return; }
    setInsTarget(null);
    await load();
  };

  useEffect(() => {
    if (!shareTarget) return;
    setShareProjectsLoading(true);
    setLinkStatus({});
    apiFetch("/api/projects")
      .then(r => r.ok ? r.json() : [])
      .then((all: any[]) => setShareProjects(all.filter((p: any) => p.status === "active")))
      .catch(() => setShareProjects([]))
      .finally(() => setShareProjectsLoading(false));
  }, [shareTarget]);

  async function linkToProject(projectId: string) {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    if (!shareTarget) return;
    setLinkStatus(prev => ({ ...prev, [projectId]: "loading" }));
    try {
      const res = await apiFetch(`/api/projects/${projectId}/members/link`, {
        method: "POST",
        body: JSON.stringify({ subcontractorId: shareTarget.id }),
      });
      if (res.status === 409) {
        setLinkStatus(prev => ({ ...prev, [projectId]: "already" }));
      } else if (res.ok) {
        setLinkStatus(prev => ({ ...prev, [projectId]: "added" }));
      } else {
        setLinkStatus(prev => ({ ...prev, [projectId]: "error" }));
      }
    } catch {
      setLinkStatus(prev => ({ ...prev, [projectId]: "error" }));
    }
  }

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<AddFormData>({ defaultValues: { contactType: "subcontractor" } });
  const { register: editReg, handleSubmit: editSubmit, reset: editReset, watch: editWatch } = useForm<EditFormData>({ defaultValues: { contactType: "subcontractor" } });
  const addContactType = watch("contactType") as ContactType;
  const editContactType = editWatch("contactType") as ContactType;

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch("/api/subcontractors");
    if (res.ok) setSubs(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/subcontractors/${deleteTarget.id}`, { method: "DELETE" });
      if (res.ok) {
        toast({ title: "Subcontractor deleted", description: `${deleteTarget.companyName} was removed.` });
        setDeleteTarget(null);
        await load();
      } else {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Couldn't delete", description: err.message ?? "Please try again.", variant: "destructive" });
      }
    } finally {
      setDeleting(false);
    }
  };

  // Handle params: ?new=1 opens modal, ?q=term pre-fills search
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") {
      if (caps.isLoading) return;
      window.history.replaceState({}, "", "/subcontractors");
      if (!isCancelled && caps.canManageSubcontractors) {
        setAddOpen(true);
        setAddError(null);
        reset();
        setSelectedTradesAdd([]);
      }
    } else if (params.get("q")) {
      const term = params.get("q")!;
      window.history.replaceState({}, "", "/subcontractors");
      setSearch(term);
    }
  }, [isCancelled, reset]);

  // Group contacts: subcontractors by trade, others by their contact type
  const grouped = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = subs.filter(s => {
      if (typeFilter !== "all" && (s.contactType ?? "subcontractor") !== typeFilter) return false;
      return (
        s.companyName.toLowerCase().includes(q) ||
        s.contactName.toLowerCase().includes(q) ||
        s.trades.some(t => t.toLowerCase().includes(q))
      );
    });

    const map: Record<string, Sub[]> = {};
    for (const s of filtered) {
      if (!s.contactType || s.contactType === "subcontractor") {
        const trades = s.trades.length ? s.trades : ["Other"];
        for (const trade of trades) {
          (map[trade] ??= []).push(s);
        }
      } else {
        const groupKey = CONTACT_TYPE_GROUP_LABELS[s.contactType] ?? "Other Contacts";
        (map[groupKey] ??= []).push(s);
      }
    }

    const tradeKeys = TRADE_CATEGORIES.filter(t => map[t]);
    const unknownTradeKeys = Object.keys(map).filter(t => !TRADE_CATEGORIES.includes(t) && !Object.values(CONTACT_TYPE_GROUP_LABELS).includes(t)).sort();
    const typeGroupKeys = Object.values(CONTACT_TYPE_GROUP_LABELS).filter(g => map[g]);
    return { map, orderedKeys: [...tradeKeys, ...unknownTradeKeys, ...typeGroupKeys] };
  }, [subs, search, typeFilter]);

  const toggleTrade = (trade: string) =>
    setOpenTrades(prev => ({ ...prev, [trade]: !(prev[trade] ?? true) }));

  async function openNotes(sub: Sub) {
    setNotesTarget(sub);
    setNotesList([]);
    setNoteDraft("");
    setNoteScope("general");
    setNoteProjectId("");
    setNotesLoading(true);
    const [notesRes, projectsRes] = await Promise.all([
      apiFetch(`/api/subcontractors/${sub.id}/notes`),
      apiFetch("/api/projects"),
    ]);
    if (notesRes.ok) {
      const data: SubNote[] = await notesRes.json();
      data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setNotesList(data);
    }
    if (projectsRes.ok) {
      const all = await projectsRes.json();
      setNoteProjects((all as any[]).filter(p => p.status === "active").map(p => ({ id: p.id, name: p.name })));
    }
    setNotesLoading(false);
  }

  async function addNote() {
    if (!notesTarget) return;
    const body = noteDraft.trim();
    if (!body) return;
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    if (noteScope === "project" && !noteProjectId) {
      toast({ title: "Select a project", description: "Choose a project or switch to General.", variant: "destructive" });
      return;
    }
    setNoteSubmitting(true);
    const res = await apiFetch(`/api/subcontractors/${notesTarget.id}/notes`, {
      method: "POST",
      body: JSON.stringify({ body, projectId: noteScope === "project" ? noteProjectId : null }),
    });
    if (res.ok) {
      const created: SubNote = await res.json();
      setNotesList(prev => [created, ...prev]);
      setNoteDraft("");
    } else {
      toast({ title: "Couldn't save note", description: "Please try again.", variant: "destructive" });
    }
    setNoteSubmitting(false);
  }

  async function openDocs(sub: Sub) {
    setDocsTarget(sub);
    setDocsList([]);
    setDocScope("general");
    setDocProjectId("");
    setDocName("");
    setDocType("terms");
    setDocFile(null);
    setDocFileZoneKey(k => k + 1);
    setDocsLoading(true);
    const [docsRes, projectsRes] = await Promise.all([
      apiFetch(`/api/subcontractors/${sub.id}/documents`),
      apiFetch("/api/projects"),
    ]);
    if (docsRes.ok) {
      const data: SubDoc[] = await docsRes.json();
      setDocsList(data);
    }
    if (projectsRes.ok) {
      const all = await projectsRes.json();
      setDocProjects((all as any[]).filter(p => p.status === "active").map(p => ({ id: p.id, name: p.name })));
    }
    setDocsLoading(false);
  }

  async function uploadDoc() {
    if (!docsTarget || !docName.trim() || !docFile) return;
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    if (docScope === "project" && !docProjectId) {
      toast({ title: "Select a project", description: "Choose a project or switch to General.", variant: "destructive" });
      return;
    }
    setDocSubmitting(true);
    const projectId = docScope === "project" ? docProjectId : null;
    const res = await apiFetch(`/api/subcontractors/${docsTarget.id}/documents`, {
      method: "POST",
      body: JSON.stringify({ name: docName.trim(), type: docType, fileUrl: docFile.url, fileSize: docFile.size, projectId }),
    });
    if (res.ok) {
      const created: SubDoc = await res.json();
      setDocsList(prev => [
        created,
        ...prev.map(d => (d.name === created.name && d.projectId === created.projectId && d.status === "current") ? { ...d, status: "superseded" as const } : d),
      ]);
      setDocName("");
      setDocFile(null);
      setDocFileZoneKey(k => k + 1);
    } else {
      toast({ title: "Couldn't upload", description: "Please try again.", variant: "destructive" });
    }
    setDocSubmitting(false);
  }

  async function onAdd(data: AddFormData) {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    setSubmitting(true); setAddError(null);
    const trades = data.contactType === "subcontractor" ? selectedTradesAdd : [];
    const res = await apiFetch("/api/subcontractors", {
      method: "POST",
      body: JSON.stringify({ ...data, trades }),
    });
    if (res.ok) {
      const created = await res.json();
      setSubs(prev => [created, ...prev]);
      setAddOpen(false); reset(); setSelectedTradesAdd([]);
    } else {
      const e = await res.json().catch(() => ({}));
      setAddError(e.message ?? "Failed to add contact.");
    }
    setSubmitting(false);
  }

  function openEdit(sub: Sub) {
    setEditTarget(sub);
    setSelectedTradesEdit(sub.trades);
    setEditError(null);
    editReset({
      companyName: sub.companyName,
      contactName: sub.contactName,
      contactEmail: sub.contactEmail,
      contactPhone: sub.contactPhone ?? "",
      contactType: sub.contactType ?? "subcontractor",
      reliabilityRating: sub.reliabilityRating != null ? String(sub.reliabilityRating) : "",
      paymentHold: sub.paymentHold,
      notes: sub.notes ?? "",
    });
  }

  async function onEdit(data: EditFormData) {
    if (!editTarget) return;
    setSubmitting(true); setEditError(null);
    const res = await apiFetch(`/api/subcontractors/${editTarget.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        ...data,
        trades: data.contactType === "subcontractor" ? selectedTradesEdit : [],
        reliabilityRating: data.reliabilityRating ? Number(data.reliabilityRating) : null,
        paymentHold: data.paymentHold,
      }),
    });
    if (res.ok) {
      const updated = await res.json();
      setSubs(prev => prev.map(s => s.id === updated.id ? updated : s));
      setEditTarget(null);
    } else {
      const e = await res.json().catch(() => ({}));
      setEditError(e.message ?? "Failed to save changes.");
    }
    setSubmitting(false);
  }

  function toggleTradeSelection(trade: string, selected: string[], setSelected: (v: string[]) => void) {
    setSelected(selected.includes(trade) ? selected.filter(t => t !== trade) : [...selected, trade]);
  }

  const totalSubs = subs.length;
  const holdCount = subs.filter(s => s.paymentHold).length;
  const insuranceIssues = subs.filter(s => s.insuranceStatus === "expired" || s.insuranceStatus === "expiring_soon").length;

  return (
    <SidebarLayout>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold">Contacts</h1>
          <p className="text-muted-foreground">Directory of all your contacts — subcontractors, merchants, suppliers and more.</p>
        </div>
        {caps.canManageSubcontractors && (
          <Button variant="accent" onClick={() => { setAddOpen(true); setAddError(null); reset(); setSelectedTradesAdd([]); }}>
            <Plus className="w-4 h-4 mr-2" /> Add Contact
          </Button>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1"><Users className="w-4 h-4 text-primary" /><p className="text-xs font-medium text-muted-foreground">Total</p></div>
          <p className="text-2xl font-extrabold">{totalSubs}</p>
        </Card>
        <Card className={cn("p-4", insuranceIssues > 0 && "border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20")}>
          <div className="flex items-center gap-2 mb-1"><ShieldAlert className="w-4 h-4 text-yellow-600" /><p className="text-xs font-medium text-muted-foreground">Insurance Issues</p></div>
          <p className={cn("text-2xl font-extrabold", insuranceIssues > 0 ? "text-yellow-700" : "")}>{insuranceIssues}</p>
        </Card>
        <Card className={cn("p-4", holdCount > 0 && "border-red-300 bg-red-50 dark:bg-red-950/20")}>
          <div className="flex items-center gap-2 mb-1"><AlertTriangle className="w-4 h-4 text-destructive" /><p className="text-xs font-medium text-muted-foreground">Payment Hold</p></div>
          <p className={cn("text-2xl font-extrabold", holdCount > 0 ? "text-destructive" : "")}>{holdCount}</p>
        </Card>
      </div>

      {/* Search + type filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative max-w-sm w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by name, trade or company…"
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {([["all", "All"], ...Object.entries(CONTACT_TYPE_LABELS)] as [ContactType | "all", string][]).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTypeFilter(value)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors",
                typeFilter === value
                  ? value === "all"         ? "bg-foreground text-background border-foreground"
                  : value === "subcontractor" ? "bg-orange-500 text-white border-orange-500"
                  : value === "merchant"     ? "bg-blue-500 text-white border-blue-500"
                  : value === "supplier"     ? "bg-purple-500 text-white border-purple-500"
                  : value === "professional" ? "bg-teal-500 text-white border-teal-500"
                  :                           "bg-muted-foreground text-background border-muted-foreground"
                  : "bg-background text-muted-foreground border-input hover:border-primary/50"
              )}
            >{label}</button>
          ))}
        </div>
      </div>

      {/* Directory */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />)}
        </div>
      ) : grouped.orderedKeys.length === 0 ? (
        <Card className="p-12 text-center border-dashed border-2">
          <HardHat className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
          <h3 className="font-bold text-lg mb-1">{search ? "No results" : "No contacts yet"}</h3>
          <p className="text-muted-foreground text-sm mb-6">{search ? "Try a different search." : "Add your first contact to get started."}</p>
          {!search && caps.canManageSubcontractors && <Button variant="accent" onClick={() => setAddOpen(true)}><Plus className="w-4 h-4 mr-2" />Add Contact</Button>}
        </Card>
      ) : (
        <div className="space-y-3">
          {grouped.orderedKeys.map(trade => {
            const members = grouped.map[trade];
            const open = openTrades[trade] ?? true;
            return (
              <div key={trade} className="bg-card border rounded-xl overflow-hidden shadow-sm">
                <button
                  onClick={() => toggleTrade(trade)}
                  className="w-full flex items-center gap-3 px-5 py-4 hover:bg-muted/30 transition-colors text-left"
                >
                  {open ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                  {(() => {
                    const ct = GROUP_LABEL_TO_TYPE[trade];
                    return <FolderOpen className={cn("w-5 h-5 shrink-0",
                      ct === "merchant"     ? "text-blue-500"   :
                      ct === "supplier"     ? "text-purple-500" :
                      ct === "professional" ? "text-teal-500"   :
                      ct === "other"        ? "text-muted-foreground" :
                      "text-orange-500"
                    )} />;
                  })()}
                  <span className="font-bold flex-1">{trade}</span>
                  {(() => {
                    const ct = GROUP_LABEL_TO_TYPE[trade];
                    if (!ct) return (
                      <Badge className="text-[10px] bg-orange-100 text-orange-700 border-orange-200 shrink-0">Subcontractor</Badge>
                    );
                    return (
                      <Badge className={cn("text-[10px] shrink-0",
                        ct === "merchant"     && "bg-blue-100 text-blue-700 border-blue-200",
                        ct === "supplier"     && "bg-purple-100 text-purple-700 border-purple-200",
                        ct === "professional" && "bg-teal-100 text-teal-700 border-teal-200",
                        ct === "other"        && "bg-muted text-muted-foreground",
                      )}>{CONTACT_TYPE_LABELS[ct]}</Badge>
                    );
                  })()}
                  <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full mr-1">
                    {members.length} {members.length === 1 ? "company" : "companies"}
                  </span>
                </button>

                {open && (
                  <div className="border-t divide-y">
                    {members.map(sub => (
                      <div key={sub.id} className={cn("px-4 py-3 hover:bg-muted/10 transition-colors", sub.paymentHold && "bg-red-50/50 dark:bg-red-950/10")}>
                        {/* Top row: avatar + info + desktop-only actions */}
                        <div className="flex items-start gap-3">
                          {/* Avatar */}
                          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                            <span className="font-extrabold text-primary text-sm">
                              {sub.companyName.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}
                            </span>
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0 overflow-hidden">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-bold text-sm truncate">{sub.companyName}</p>
                              {sub.contactType && (
                                <Badge className={cn("text-[10px] shrink-0",
                                  sub.contactType === "subcontractor" && "bg-orange-100 text-orange-700 border-orange-200",
                                  sub.contactType === "merchant"      && "bg-blue-100 text-blue-700 border-blue-200",
                                  sub.contactType === "supplier"      && "bg-purple-100 text-purple-700 border-purple-200",
                                  sub.contactType === "professional"  && "bg-teal-100 text-teal-700 border-teal-200",
                                  sub.contactType === "other"         && "bg-muted text-muted-foreground",
                                )}>{CONTACT_TYPE_LABELS[sub.contactType]}</Badge>
                              )}
                              {sub.paymentHold && (
                                <Badge variant="destructive" className="text-[10px] gap-1 shrink-0"><AlertTriangle className="w-3 h-3" />Payment Hold</Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate">{sub.contactName}</p>
                            <div className="flex flex-col gap-0.5 mt-0.5">
                              {sub.contactPhone && (
                                <span className="text-xs text-muted-foreground flex items-center gap-1 min-w-0">
                                  <Phone className="w-3 h-3 shrink-0" /><span className="truncate">{sub.contactPhone}</span>
                                </span>
                              )}
                              {sub.contactEmail && (
                                <span className="text-xs text-muted-foreground flex items-center gap-1 min-w-0">
                                  <Mail className="w-3 h-3 shrink-0" /><span className="truncate">{sub.contactEmail}</span>
                                </span>
                              )}
                            </div>
                            {sub.trades.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {sub.trades.map(t => (
                                  <span key={t} className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800">
                                    {t}
                                  </span>
                                ))}
                              </div>
                            )}
                            {sub.insuranceRecords?.length > 0 && (
                              <div className="mt-2 space-y-1">
                                {sub.insuranceRecords.map(r => {
                                  const expired = r.status === "expired";
                                  const expiring = r.status === "expiring_soon";
                                  return (
                                    <div key={r.id} className={cn("flex flex-col gap-0.5 text-[10px] font-medium px-2 py-1.5 rounded-md border", expired ? "bg-red-50 border-red-300 text-red-700" : expiring ? "bg-yellow-50 border-yellow-200 text-yellow-700" : "bg-emerald-50 border-emerald-200 text-emerald-700")}>
                                      <div className="flex items-center gap-1.5">
                                        <FileText className="w-3 h-3 shrink-0" />
                                        <span className="truncate">{r.type} — {expired ? "expired" : "expires"} {new Date(r.expiryDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                                        {r.overdue && <span className="shrink-0 text-[9px] font-bold text-red-700 bg-red-100 border border-red-300 rounded px-1 py-px uppercase tracking-wide">Overdue</span>}
                                        <button onClick={() => window.open(normaliseUrl(r.certificateUrl), "_blank")} className="ml-auto shrink-0 hover:opacity-70" title="Open certificate">
                                          <ExternalLink className="w-3 h-3" />
                                        </button>
                                        {caps.canManageSubcontractors && (
                                          <button onClick={() => openInsAssign(sub, r)} className="shrink-0 hover:opacity-70" title="Assign owner & due date">
                                            <Pencil className="w-3 h-3" />
                                          </button>
                                        )}
                                      </div>
                                      {(r.assignedToUserName || r.dueDate) && (
                                        <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-[9px] opacity-90">
                                          {r.assignedToUserName && <span className="flex items-center gap-1"><UserCheck className="w-2.5 h-2.5" />{r.assignedToUserName}</span>}
                                          {r.dueDate && <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" />Due {new Date(r.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>}
                                        </div>
                                      )}
                                      {expired && <span className="text-[9px] font-bold text-red-700 uppercase tracking-wide">Site access denied — new document required</span>}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {/* Desktop-only: status + all action icons */}
                          <div className="hidden md:flex items-center gap-1 shrink-0">
                            <div className="flex flex-col items-end gap-1.5 mr-1">
                              {insuranceBadge(sub.insuranceStatus)}
                              <RatingStars rating={sub.reliabilityRating} />
                            </div>
                            <ContactActions email={sub.contactEmail} phone={sub.contactPhone} />
                            <button onClick={() => openNotes(sub)} className="p-1.5 rounded-lg text-muted-foreground hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors" title="Notes & reminders log">
                              <StickyNote className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => openDocs(sub)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-muted transition-colors" title="Documents">
                              <FileText className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setSharingContact({
                                id: sub.id,
                                name: sub.companyName,
                                text: `${sub.companyName}\nContact: ${sub.contactName}${sub.contactEmail ? `\nEmail: ${sub.contactEmail}` : ""}${sub.contactPhone ? `\nPhone: ${sub.contactPhone}` : ""}${sub.trades.length ? `\nTrades: ${sub.trades.join(", ")}` : ""}`,
                              })}
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
                              title="Share contact"
                            >
                              <Share2 className="w-3.5 h-3.5" />
                            </button>
                            {caps.canManageSubcontractors && (
                              <>
                                <button onClick={() => setShareTarget(sub)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-muted transition-colors" title="Add to a project">
                                  <FolderPlus className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => openEdit(sub)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-muted transition-colors" title="Edit">
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => setDeleteTarget(sub)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" title="Delete subcontractor">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Mobile-only bottom bar: insurance badge left, action icons right */}
                        <div className="flex md:hidden items-center justify-between mt-2 pt-2 border-t border-border/40">
                          <div className="flex items-center gap-2">
                            {insuranceBadge(sub.insuranceStatus)}
                            <RatingStars rating={sub.reliabilityRating} />
                          </div>
                          <div className="flex items-center gap-0.5">
                            <ContactActions email={sub.contactEmail} phone={sub.contactPhone} />
                            <button onClick={() => openNotes(sub)} className="p-1.5 rounded-lg text-muted-foreground hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors" title="Notes & reminders log">
                              <StickyNote className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => openDocs(sub)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-muted transition-colors" title="Documents">
                              <FileText className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setSharingContact({
                                id: sub.id,
                                name: sub.companyName,
                                text: `${sub.companyName}\nContact: ${sub.contactName}${sub.contactEmail ? `\nEmail: ${sub.contactEmail}` : ""}${sub.contactPhone ? `\nPhone: ${sub.contactPhone}` : ""}${sub.trades.length ? `\nTrades: ${sub.trades.join(", ")}` : ""}`,
                              })}
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
                              title="Share contact"
                            >
                              <Share2 className="w-3.5 h-3.5" />
                            </button>
                            {caps.canManageSubcontractors && (
                              <>
                                <button onClick={() => setShareTarget(sub)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-muted transition-colors" title="Add to a project">
                                  <FolderPlus className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => openEdit(sub)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-muted transition-colors" title="Edit">
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => setDeleteTarget(sub)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" title="Delete subcontractor">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add modal */}
      <Dialog open={addOpen} onOpenChange={open => { setAddOpen(open); if (!open) { reset(); setSelectedTradesAdd([]); setAddError(null); } }}>
        <DialogHeader>
          <DialogTitle>Add Contact</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onAdd)} className="space-y-4 pt-2">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Contact Type</label>
            <select {...register("contactType")} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              {(Object.entries(CONTACT_TYPE_LABELS) as [ContactType, string][]).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
            <div className="col-span-2">
              <label className="text-sm font-medium mb-1.5 block">Company Name</label>
              <Input placeholder="e.g. Smith Electrical Ltd" {...register("companyName", { required: true })} />
              {errors.companyName && <p className="text-xs text-destructive mt-1">Required</p>}
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Contact Name</label>
              <Input placeholder="John Smith" {...register("contactName", { required: true })} />
              {errors.contactName && <p className="text-xs text-destructive mt-1">Required</p>}
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Phone</label>
              <Input placeholder="+44 7700 000000" {...register("contactPhone")} />
            </div>
            <div className="col-span-2">
              <label className="text-sm font-medium mb-1.5 block">Email</label>
              <Input type="email" placeholder="john@example.com" {...register("contactEmail", { required: true })} />
              {errors.contactEmail && <p className="text-xs text-destructive mt-1">Required</p>}
            </div>
          </div>

          {addContactType === "subcontractor" && (
            <div>
              <label className="text-sm font-medium mb-2 block">Trade Types</label>
              <div className="flex flex-wrap gap-2">
                {TRADE_CATEGORIES.map(trade => (
                  <button
                    key={trade}
                    type="button"
                    onClick={() => toggleTradeSelection(trade, selectedTradesAdd, setSelectedTradesAdd)}
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-xs font-semibold border-2 transition-colors",
                      selectedTradesAdd.includes(trade)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-input hover:border-primary/50"
                    )}
                  >{trade}</button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-sm font-medium mb-1.5 block">Notes</label>
            <textarea
              placeholder="Any additional notes…"
              rows={3}
              {...register("notes")}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          {addError && <p className="text-sm text-destructive">{addError}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button type="submit" variant="accent" disabled={submitting}>{submitting ? "Saving…" : "Add Contact"}</Button>
          </DialogFooter>
        </form>
      </Dialog>

      {/* Add to project dialog */}
      <Dialog open={!!shareTarget} onOpenChange={open => { if (!open) setShareTarget(null); }}>
        <DialogHeader>
          <DialogTitle>Add to a Project</DialogTitle>
        </DialogHeader>
        {shareTarget && (
          <div className="space-y-4">
            {/* Sub summary */}
            <div className="flex items-center gap-3 px-4 py-3 bg-muted/40 rounded-xl">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <span className="font-extrabold text-primary text-sm">
                  {shareTarget.companyName.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}
                </span>
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-sm">{shareTarget.companyName}</p>
                <p className="text-xs text-muted-foreground">{shareTarget.contactName}{shareTarget.trades.length ? ` · ${shareTarget.trades.join(", ")}` : ""}</p>
              </div>
            </div>

            <p className="text-sm text-muted-foreground">Select an active project to add this subcontractor to.</p>

            {shareProjectsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : shareProjects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Building2 className="w-8 h-8 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">No active projects found.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {shareProjects.map(project => {
                  const status = linkStatus[project.id] ?? "idle";
                  return (
                    <div key={project.id} className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border bg-card hover:bg-muted/20 transition-colors">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{project.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{project.address}</p>
                      </div>
                      <div className="shrink-0">
                        {status === "idle" && (
                          <Button size="sm" variant="accent" onClick={() => linkToProject(project.id)}>
                            <FolderPlus className="w-3.5 h-3.5 mr-1.5" /> Add
                          </Button>
                        )}
                        {status === "loading" && (
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground px-3 py-1.5">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Adding…
                          </span>
                        )}
                        {status === "added" && (
                          <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold px-3 py-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Added
                          </span>
                        )}
                        {status === "already" && (
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground px-3 py-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Already on project
                          </span>
                        )}
                        {status === "error" && (
                          <span className="flex items-center gap-1.5 text-xs text-destructive px-3 py-1.5">
                            <X className="w-3.5 h-3.5" /> Failed — retry?
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setShareTarget(null)}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </Dialog>

      {/* Edit modal */}
      <Dialog open={!!editTarget} onOpenChange={open => { if (!open) { setEditTarget(null); setEditError(null); } }}>
        <DialogHeader>
          <DialogTitle>Edit — {editTarget?.companyName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={editSubmit(onEdit)} className="space-y-4 pt-2">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Contact Type</label>
            <select {...editReg("contactType")} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              {(Object.entries(CONTACT_TYPE_LABELS) as [ContactType, string][]).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
            <div className="col-span-2">
              <label className="text-sm font-medium mb-1.5 block">Company Name</label>
              <Input {...editReg("companyName", { required: true })} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Contact Name</label>
              <Input {...editReg("contactName", { required: true })} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Phone</label>
              <Input {...editReg("contactPhone")} />
            </div>
            <div className="col-span-2">
              <label className="text-sm font-medium mb-1.5 block">Email</label>
              <Input type="email" {...editReg("contactEmail", { required: true })} />
            </div>
          </div>

          {editContactType === "subcontractor" && (
            <div>
              <label className="text-sm font-medium mb-2 block">Trade Types</label>
              <div className="flex flex-wrap gap-2">
                {TRADE_CATEGORIES.map(trade => (
                  <button
                    key={trade}
                    type="button"
                    onClick={() => toggleTradeSelection(trade, selectedTradesEdit, setSelectedTradesEdit)}
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-xs font-semibold border-2 transition-colors",
                      selectedTradesEdit.includes(trade)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-input hover:border-primary/50"
                    )}
                  >{trade}</button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Reliability Rating</label>
              <select {...editReg("reliabilityRating")} className="w-full min-w-0 max-w-full box-border h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="">Not rated</option>
                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} star{n !== 1 ? "s" : ""}</option>)}
              </select>
            </div>
            <div className="flex items-end pb-0.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" {...editReg("paymentHold")} className="w-4 h-4 rounded border-input" />
                <span className="text-sm font-medium">Payment Hold</span>
              </label>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Notes</label>
            <textarea
              placeholder="Any additional notes…"
              rows={3}
              {...editReg("notes")}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          {editError && <p className="text-sm text-destructive">{editError}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button type="submit" variant="accent" disabled={submitting}>{submitting ? "Saving…" : "Save Changes"}</Button>
          </DialogFooter>
        </form>
      </Dialog>
      {/* Notes & reminders log dialog */}
      <Dialog open={!!notesTarget} onOpenChange={open => { if (!open) { setNotesTarget(null); setNotesList([]); setNoteDraft(""); setNoteScope("general"); setNoteProjectId(""); } }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <StickyNote className="w-4 h-4 text-amber-600" /> Notes & Reminders
          </DialogTitle>
        </DialogHeader>
        {notesTarget && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/40">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                {notesTarget.companyName.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate">{notesTarget.companyName}</p>
                <p className="text-xs text-muted-foreground truncate">{notesTarget.contactName}</p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">General notes</span> appear across all projects this contact is linked to. <span className="font-medium text-foreground">Project notes</span> stay within a single project.
            </p>

            {caps.canManageSubcontractors && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => setNoteScope("general")}
                    className={`flex-1 text-xs font-semibold py-1.5 rounded-lg border transition-colors ${noteScope === "general" ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-input hover:border-primary/50"}`}
                  >
                    General (all projects)
                  </button>
                  <button
                    onClick={() => setNoteScope("project")}
                    className={`flex-1 text-xs font-semibold py-1.5 rounded-lg border transition-colors ${noteScope === "project" ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-input hover:border-primary/50"}`}
                  >
                    Specific project
                  </button>
                </div>
                {noteScope === "project" && (
                  <select
                    value={noteProjectId}
                    onChange={e => setNoteProjectId(e.target.value)}
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Select project…</option>
                    {noteProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
                <textarea
                  placeholder={noteScope === "general" ? "e.g. Reminded John his public liability insurance expires next month…" : "e.g. Running 2 days behind on Block A…"}
                  rows={3}
                  value={noteDraft}
                  onChange={e => setNoteDraft(e.target.value)}
                  onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); addNote(); } }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
                <div className="flex justify-end">
                  <Button variant="accent" size="sm" onClick={addNote} disabled={noteSubmitting || !noteDraft.trim()}>
                    {noteSubmitting ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</> : <><Send className="w-3.5 h-3.5 mr-1.5" />Add Note</>}
                  </Button>
                </div>
              </div>
            )}

            <div className="border-t pt-3 max-h-72 overflow-y-auto -mr-1 pr-1">
              {notesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : notesList.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <StickyNote className="w-8 h-8 text-muted-foreground/30 mb-2" />
                  <p className="text-sm text-muted-foreground">No notes yet.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {notesList.map(n => (
                    <div key={n.id} className="rounded-lg border bg-muted/30 p-3">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="text-[13px] text-foreground whitespace-pre-wrap break-words flex-1 min-w-0">{n.body}</p>
                        {n.projectId ? (
                          <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary">{n.projectName ?? "Project"}</span>
                        ) : (
                          <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">General</span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />{formatNoteTime(n.createdAt)} · {n.authorName}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => { setNotesTarget(null); setNotesList([]); setNoteDraft(""); setNoteScope("general"); setNoteProjectId(""); }}>Close</Button>
        </DialogFooter>
      </Dialog>

      {/* Documents dialog (F6) */}
      <Dialog open={!!docsTarget} onOpenChange={open => { if (!open) { setDocsTarget(null); setDocsList([]); setDocScope("general"); setDocProjectId(""); } }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" /> Documents
          </DialogTitle>
        </DialogHeader>
        {docsTarget && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/40">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                {docsTarget.companyName.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate">{docsTarget.companyName}</p>
                <p className="text-xs text-muted-foreground truncate">{docsTarget.contactName}</p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">General documents</span> apply to this contact everywhere. <span className="font-medium text-foreground">Project documents</span> only show within that project's Team tab.
            </p>

            {caps.canManageSubcontractors && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => setDocScope("general")}
                    className={`flex-1 text-xs font-semibold py-1.5 rounded-lg border transition-colors ${docScope === "general" ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-input hover:border-primary/50"}`}
                  >
                    General (everywhere)
                  </button>
                  <button
                    onClick={() => setDocScope("project")}
                    className={`flex-1 text-xs font-semibold py-1.5 rounded-lg border transition-colors ${docScope === "project" ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-input hover:border-primary/50"}`}
                  >
                    Specific project
                  </button>
                </div>
                {docScope === "project" && (
                  <select
                    value={docProjectId}
                    onChange={e => setDocProjectId(e.target.value)}
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Select project…</option>
                    {docProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
                <div className="grid grid-cols-2 gap-2 [&>*]:min-w-0">
                  <Input placeholder="Document name" value={docName} onChange={e => setDocName(e.target.value)} />
                  <select
                    value={docType}
                    onChange={e => setDocType(e.target.value)}
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {Object.entries(DOC_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                <FileDropZone
                  key={docFileZoneKey}
                  onUploaded={f => setDocFile({ url: f.url, size: f.size })}
                  onCleared={() => setDocFile(null)}
                />
                <div className="flex justify-end">
                  <Button variant="accent" size="sm" onClick={uploadDoc} disabled={docSubmitting || !docName.trim() || !docFile}>
                    {docSubmitting ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Uploading…</> : <>Upload</>}
                  </Button>
                </div>
              </div>
            )}

            <div className="border-t pt-3 max-h-72 overflow-y-auto -mr-1 pr-1">
              {docsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : docsList.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <FileText className="w-8 h-8 text-muted-foreground/30 mb-2" />
                  <p className="text-sm text-muted-foreground">No documents yet.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {docsList.map(d => (
                    <div key={d.id} className="rounded-lg border bg-muted/30 p-3">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-foreground truncate">{d.name}</p>
                          <p className="text-[11px] text-muted-foreground">{DOC_TYPE_LABELS[d.type] ?? d.type} · v{d.version}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {d.status === "superseded" ? (
                            <Badge variant="destructive" className="text-[9px]">SUPERSEDED</Badge>
                          ) : (
                            <Badge variant="success" className="text-[9px]">CURRENT</Badge>
                          )}
                          {d.projectId ? (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary">{d.projectName ?? "Project"}</span>
                          ) : (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">General</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" />{formatNoteTime(d.createdAt)} · {d.uploaderName}
                        </p>
                        <button onClick={() => window.open(normaliseUrl(d.fileUrl), "_blank")} className="shrink-0 text-muted-foreground hover:text-primary transition-colors" title="Open document">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => { setDocsTarget(null); setDocsList([]); setDocScope("general"); setDocProjectId(""); }}>Close</Button>
        </DialogFooter>
      </Dialog>

      {/* Insurance — assign owner & due date (F1 Phase 3) */}
      <Dialog open={!!insTarget} onOpenChange={open => { if (!open) { setInsTarget(null); setInsError(null); } }}>
        <DialogHeader>
          <DialogTitle>Insurance Accountability</DialogTitle>
        </DialogHeader>
        {insTarget && (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{insTarget.sub.companyName}</span>
              {" — "}{insTarget.record.type} cert, expires {new Date(insTarget.record.expiryDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Assign to</label>
              <select
                value={insAssignee}
                onChange={e => setInsAssignee(e.target.value)}
                className="flex h-11 w-full rounded-lg border-2 border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/10"
              >
                <option value="">Unassigned</option>
                {companyUsers.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Action due by (optional)</label>
              <Input type="date" value={insDueDate} onChange={e => setInsDueDate(e.target.value)} />
              <p className="text-[11px] text-muted-foreground mt-1">The deadline to chase the renewal — distinct from the cert's expiry. Past-due shows an OVERDUE flag.</p>
            </div>
            {insError && <p className="text-destructive text-sm">{insError}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => { setInsTarget(null); setInsError(null); }}>Cancel</Button>
          <Button variant="accent" onClick={saveInsAssign} isLoading={insSubmitting}>Save</Button>
        </DialogFooter>
      </Dialog>

      <ShareModal
        open={!!sharingContact}
        onClose={() => setSharingContact(null)}
        entityType="contact"
        entityId={sharingContact?.id ?? ""}
        entityName={sharingContact?.name ?? ""}
        fileUrl={null}
        shareText={sharingContact?.text ?? null}
      />

      <Dialog open={!!deleteTarget} onOpenChange={v => { if (!v && !deleting) setDeleteTarget(null); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive"><Trash2 className="w-4 h-4" /> Delete subcontractor</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <p className="text-sm">
            Permanently delete <span className="font-semibold">{deleteTarget?.companyName}</span>? This also removes their people/portal access, insurance records, notes, and any links to projects. This can't be undone.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
          <Button variant="destructive" onClick={confirmDelete} isLoading={deleting}>Delete</Button>
        </DialogFooter>
      </Dialog>
    </SidebarLayout>
  );
}
