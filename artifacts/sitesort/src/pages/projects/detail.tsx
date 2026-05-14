import { useState, useRef, useEffect } from "react";
import { useRoute } from "wouter";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { MapPin, Calendar, Upload, FileText, CheckCircle2, AlertTriangle, ShieldCheck, Eye, EyeOff, Users, Search, X, Phone, Mail, HardHat, UserCheck, Clock, Pencil, Camera, FolderOpen, ChevronDown, ChevronRight, QrCode, Download, Printer, RefreshCw, ArrowDownCircle, ArrowUpCircle, Receipt, ClipboardCheck, UserPlus, ExternalLink, Share2, MessageCircle } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { FileDropZone } from "@/components/ui/file-drop-zone";
import { InsuranceCertZone } from "@/components/ui/insurance-cert-zone";
import { VoiceRecall } from "@/components/voice-recall";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetProject,
  useListDocuments,
  useListProjectMembers,
  useUploadDocument,
  useUpdateProject,
  DocumentType,
  UploadDocumentRequestType,
  UpdateProjectRequestStatus,
} from "@workspace/api-client-react";
import { formatDate, formatBytes, cn } from "@/lib/utils";
import { useForm } from "react-hook-form";

export default function ProjectDetail() {
  const [, params] = useRoute("/projects/:id");
  const projectId = params?.id || "";
  
  const { data: project, isLoading: projectLoading } = useGetProject(projectId, { query: { enabled: !!projectId } });
  const { data: documents, refetch: refetchDocs } = useListDocuments(projectId, undefined, { query: { enabled: !!projectId } });
  const { data: members } = useListProjectMembers(projectId, { query: { enabled: !!projectId } });
  
  type PermitItem = { id: string; type: string; description: string; startDate: string; expiryDate: string; status: string; responsibleName?: string };
  type InvoiceItem = { id: string; direction: string; counterpartyName: string; description: string; amount: string; currency: string; dueDate: string; status: string; reference?: string | null };

  const [permits, setPermits] = useState<PermitItem[]>([]);
  const [projectInvoices, setProjectInvoices] = useState<InvoiceItem[]>([]);

  useEffect(() => {
    if (!projectId) return;
    const token = localStorage.getItem("sitesort_token");
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    Promise.all([
      fetch(`/api/projects/${projectId}/permits`, { headers }).then(r => r.ok ? r.json() : []),
      fetch(`/api/projects/${projectId}/invoices`, { headers }).then(r => r.ok ? r.json() : []),
    ]).then(([p, inv]) => { setPermits(p); setProjectInvoices(inv); });
  }, [projectId]);

  const uploadMutation = useUploadDocument();
  const updateMutation = useUpdateProject();
  const queryClient = useQueryClient();
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const { register, handleSubmit, reset, watch, setValue } = useForm<Record<string, any>>({ defaultValues: { type: "drawing" } });
  const { register: editRegister, handleSubmit: editHandleSubmit, reset: editReset } = useForm();
  
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const toggleFolder = (trade: string) => setOpenFolders(prev => ({ ...prev, [trade]: !prev[trade] }));
  const isFolderOpen = (trade: string, defaultOpen = true) => trade in openFolders ? openFolders[trade] : defaultOpen;

  const [addingTrade, setAddingTrade] = useState(false);
  const [newTradeName, setNewTradeName] = useState("");
  const [addPersonTrade, setAddPersonTrade] = useState<string | null>(null);
  const [addPersonError, setAddPersonError] = useState<string | null>(null);
  const { register: personRegister, handleSubmit: personHandleSubmit, reset: personReset } = useForm();

  const submitAddTrade = async () => {
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

  const submitAddPerson = async (data: any) => {
    setAddPersonError(null);
    try {
      const token = localStorage.getItem("sitesort_token");
      const res = await fetch(`/api/projects/${projectId}/tradespeople`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ trade: addPersonTrade, companyName: data.companyName, contactName: data.contactName, contactEmail: data.contactEmail, contactPhone: data.contactPhone }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      await queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/members`] });
      await queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}`] });
      setAddPersonTrade(null);
      personReset();
    } catch (e: any) {
      setAddPersonError(e?.message ?? "Failed to add person");
    }
  };

  const [editingPhoneId, setEditingPhoneId] = useState<string | null>(null);
  const [phoneInput, setPhoneInput] = useState("");

  const savePhone = async (memberId: string) => {
    const token = localStorage.getItem("sitesort_token");
    await fetch(`/api/projects/${projectId}/members/${memberId}/contact`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ phone: phoneInput }),
    });
    await queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/members`] });
    setEditingPhoneId(null);
  };

  const [selectedDocType, setSelectedDocType] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");

  const [qrCode, setQrCode] = useState<{ token: string; siteUrl: string } | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrFetched, setQrFetched] = useState(false);
  const qrSvgRef = useRef<HTMLDivElement>(null);

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
              <div className="flex items-center gap-4 text-muted-foreground">
                <span className="flex items-center gap-1"><MapPin className="w-4 h-4"/> {project.address}</span>
                <span className="flex items-center gap-1"><Calendar className="w-4 h-4"/> Started {formatDate(project.startDate)}</span>
              </div>
            </div>
            <Button variant="outline" onClick={openEdit}>Edit Details</Button>
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

      <Tabs defaultValue="documents">
        <TabsList className="mb-6 w-full justify-start overflow-x-auto bg-transparent border-b rounded-none p-0 h-auto">
          {[
            { value: "overview", label: "Overview" },
            { value: "documents", label: "Documents" },
            { value: "team", label: "Team" },
            { value: "photos", label: "Photos" },
            { value: "permits", label: "Permits" },
            { value: "finances", label: "Finances & Expiry" },
            { value: "qr", label: "Site Board QR" },
          ].map(tab => (
            <TabsTrigger 
              key={tab.value}
              value={tab.value}
              className="px-6 py-3 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-primary"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview">
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
        </TabsContent>

        <TabsContent value="documents">
          <div className="mb-6">
            <VoiceRecall projectId={projectId} documents={documents?.map(d => ({ id: d.id, name: d.name, type: d.type, version: d.version, status: d.status, fileUrl: d.fileUrl, createdAt: String(d.createdAt) }))} />
          </div>
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
              <Button variant="accent" onClick={() => setIsUploadOpen(true)}>
                <Upload className="w-4 h-4 mr-2" /> Upload Document
              </Button>
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
                          <a
                            href={doc.fileUrl.replace(/^\/uploads\//, "/api/uploads/")}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 text-xs text-primary hover:underline font-medium"
                            title="Open document"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Open
                          </a>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="p-1 rounded text-muted-foreground hover:text-primary transition-colors" title="Share">
                                <Share2 className="w-3.5 h-3.5" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuItem
                                className="gap-2 cursor-pointer"
                                onClick={() => {
                                  const norm = doc.fileUrl.replace(/^\/uploads\//, "/api/uploads/"); const url = norm.startsWith("http") ? norm : `${window.location.origin}${norm}`;
                                  const subject = encodeURIComponent(`Document – ${doc.name}`);
                                  const body = encodeURIComponent(`Hi,\n\nPlease find the document "${doc.name}" (v${doc.version}) here:\n\n${url}`);
                                  window.open(`mailto:?subject=${subject}&body=${body}`);
                                }}
                              >
                                <Mail className="w-4 h-4 text-muted-foreground" /> Send via Email
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="gap-2 cursor-pointer"
                                onClick={() => {
                                  const norm = doc.fileUrl.replace(/^\/uploads\//, "/api/uploads/"); const url = norm.startsWith("http") ? norm : `${window.location.origin}${norm}`;
                                  const text = encodeURIComponent(`Document: ${doc.name} (v${doc.version})\n${url}`);
                                  window.open(`https://wa.me/?text=${text}`, "_blank");
                                }}
                              >
                                <MessageCircle className="w-4 h-4 text-green-600" /> Send via WhatsApp
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
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
        </TabsContent>
        
        <TabsContent value="team">
          <div className="flex justify-end mb-4">
            <Button variant="outline" size="sm" onClick={openFromDirectory}>
              <UserPlus className="w-4 h-4 mr-2" /> Add from Subcontractor Directory
            </Button>
          </div>
          {(!members || members.length === 0) ? (
            <div className="bg-card p-12 rounded-xl border text-center border-dashed border-2">
              <Users className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-50" />
              <h3 className="text-lg font-bold">No team members yet</h3>
              <p className="text-muted-foreground">Add tradespeople and subcontractors to this project.</p>
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
                        {trade !== "Site Staff" && (
                          <button
                            onClick={e => { e.stopPropagation(); setAddPersonTrade(trade); setAddPersonError(null); personReset(); }}
                            className="ml-2 flex items-center gap-1 text-xs font-semibold text-primary hover:underline shrink-0"
                          >+ Add Person</button>
                        )}
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
                  ? <Badge variant="destructive" className="text-[10px]"><AlertTriangle className="w-3 h-3 mr-1"/>On Hold</Badge>
                  : null;

                return (
                  <div key={member.id} className="bg-card border rounded-xl p-5 flex flex-col gap-3 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <label className="relative cursor-pointer group shrink-0" title="Click to upload photo">
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
                          <div className={cn("w-14 h-14 rounded-xl flex items-center justify-center shrink-0 overflow-hidden", isSubcontractor ? "bg-orange-500/10" : "bg-primary/10")}>
                            {member.avatarUrl ? (
                              <img src={member.avatarUrl} alt={member.name} className="w-full h-full object-cover" />
                            ) : (
                              <span className={cn("text-lg font-extrabold", isSubcontractor ? "text-orange-500" : "text-primary")}>
                                {member.name.split(" ").map((w: string) => w[0]).slice(0, 2).join("")}
                              </span>
                            )}
                          </div>
                          <div className="absolute inset-0 rounded-xl bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <Camera className="w-4 h-4 text-white" />
                          </div>
                        </label>
                        <div>
                          <p className="font-bold text-base leading-tight">{member.name}</p>
                          {isSubcontractor && member.contactName && (
                            <p className="text-xs text-muted-foreground">Contact: {member.contactName}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <Badge variant="secondary" className="text-[10px] capitalize">{member.role.replace('_', ' ')}</Badge>
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
                            <button
                              onClick={() => { setEditingPhoneId(member.id); setPhoneInput(member.phone ?? ""); }}
                              className="ml-1 opacity-0 group-hover/phone:opacity-100 transition-opacity text-muted-foreground hover:text-primary shrink-0"
                            ><Pencil className="w-3 h-3" /></button>
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
                      <button
                        onClick={() => openSchedule(member)}
                        className="ml-2 p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-primary transition-colors shrink-0"
                        title="Edit schedule"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
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
                {addingTrade ? (
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
                )}
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
                    <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{permits.length}</span>
                  </div>
                  {permits.length === 0 ? (
                    <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">No permits on this project.</CardContent></Card>
                  ) : (
                    <div className="space-y-2">
                      {[...permits].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)).map(p => {
                        const days = daysLeft(p.expiryDate);
                        return (
                          <div key={p.id} className={`flex items-center justify-between gap-4 px-4 py-3 rounded-xl border ${statusStyle(days)}`}>
                            <div className="min-w-0">
                              <p className="font-semibold text-sm truncate">{p.type}</p>
                              <p className="text-xs opacity-70 truncate">{p.description}{p.responsibleName ? ` · ${p.responsibleName}` : ""}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-xs font-semibold">{statusLabel(days)}</p>
                              <p className="text-xs opacity-70">{fmtDate(p.expiryDate)}</p>
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
                            <div className="text-right shrink-0">
                              {isSuperseded
                                ? <Badge variant="secondary" className="text-[10px]">Superseded</Badge>
                                : pending > 0
                                ? <Badge className="text-[10px] bg-yellow-100 text-yellow-700 border-yellow-200">{pending} pending sign-off</Badge>
                                : <Badge variant="success" className="text-[10px]">All signed off</Badge>
                              }
                              <p className="text-xs text-muted-foreground mt-0.5">{formatDate(doc.createdAt)}</p>
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
                            <div className="text-right shrink-0">
                              <p className="font-bold text-sm">{fmtAmt(inv.currency, inv.amount)}</p>
                              <p className="text-xs opacity-70">{paid ? "Paid" : statusLabel(days)} · {fmtDate(inv.dueDate)}</p>
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

                <div className="w-full bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
                  <p className="font-semibold mb-1">What workers will see when they scan:</p>
                  <ul className="list-disc list-inside space-y-1 text-blue-700 text-xs">
                    <li>Project name, address and status</li>
                    <li>Site manager contact details</li>
                    <li>Active permits and expiry dates</li>
                    <li>Public documents on display</li>
                    <li>Trades currently working on site</li>
                  </ul>
                </div>
              </div>
            ) : (
              <p className="text-destructive text-center text-sm">Failed to generate QR code. Please try again.</p>
            )}
          </div>
        </TabsContent>
      </Tabs>

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

      <Dialog open={!!addPersonTrade} onOpenChange={v => { if (!v) { setAddPersonTrade(null); setAddPersonError(null); } }}>
        <DialogHeader>
          <DialogTitle>Add Person — <span className="capitalize">{addPersonTrade}</span></DialogTitle>
        </DialogHeader>
        {addPersonError && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">{addPersonError}</div>
        )}
        <form onSubmit={personHandleSubmit(submitAddPerson)} className="space-y-4">
          <div>
            <label className="text-sm font-semibold mb-1 block">Company / Business Name</label>
            <Input {...personRegister("companyName", { required: true })} placeholder="e.g. Smith Electrical Ltd" />
          </div>
          <div>
            <label className="text-sm font-semibold mb-1 block">Contact Name</label>
            <Input {...personRegister("contactName", { required: true })} placeholder="e.g. John Smith" icon={<Users className="w-4 h-4" />} />
          </div>
          <div>
            <label className="text-sm font-semibold mb-1 block">Email</label>
            <Input {...personRegister("contactEmail")} type="email" placeholder="john@smithelectrical.co.uk" icon={<Mail className="w-4 h-4" />} />
          </div>
          <div>
            <label className="text-sm font-semibold mb-1 block">Phone</label>
            <Input {...personRegister("contactPhone")} type="tel" placeholder="+44 7700 000000" icon={<Phone className="w-4 h-4" />} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setAddPersonTrade(null)}>Cancel</Button>
            <Button type="submit" variant="accent">Add to Project</Button>
          </DialogFooter>
        </form>
      </Dialog>

      <Dialog open={fromDirOpen} onOpenChange={v => { if (!v) setFromDirOpen(false); }}>
        <DialogHeader>
          <DialogTitle>Add from Subcontractor Directory</DialogTitle>
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
    </SidebarLayout>
  );
}
