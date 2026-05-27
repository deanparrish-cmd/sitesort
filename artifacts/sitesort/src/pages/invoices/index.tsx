import { useState, useEffect, useCallback, useRef } from "react";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus, Search, ArrowDownCircle, ArrowUpCircle, CheckCircle2, Clock,
  AlertTriangle, Receipt, Mic, MicOff, Paperclip, Upload, Loader2, X,
  Share2, Mail, MessageCircle, Eye, ExternalLink, FileText, Image,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { useListProjects } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { useSubscription } from "@/contexts/subscription";
import { useToast } from "@/hooks/use-toast";

// Normalise stored URLs: old records may have /uploads/… which is only served
// by Express. Rewrite to /api/uploads/… so Replit always routes to the API server.
function fullUrl(attachmentUrl: string) {
  const normalised = attachmentUrl.replace(/^\/uploads\//, "/api/uploads/");
  return normalised.startsWith("http") ? normalised : `${window.location.origin}${normalised}`;
}

function shareEmail(inv: Invoice) {
  const url = fullUrl(inv.attachmentUrl!);
  const subject = encodeURIComponent(`Invoice – ${inv.counterpartyName}`);
  const body = encodeURIComponent(
    `Hi,\n\nPlease find the invoice document attached below:\n\n${url}\n\nRef: ${inv.reference ?? "N/A"} | Amount: ${inv.currency} ${Number(inv.amount).toFixed(2)}\n\nRegards`
  );
  window.open(`mailto:?subject=${subject}&body=${body}`);
}

function shareWhatsApp(inv: Invoice) {
  const url = fullUrl(inv.attachmentUrl!);
  const text = encodeURIComponent(
    `Invoice document – ${inv.counterpartyName}\nRef: ${inv.reference ?? "N/A"} | ${inv.currency} ${Number(inv.amount).toFixed(2)}\n${url}`
  );
  window.open(`https://wa.me/?text=${text}`, "_blank");
}

type Invoice = {
  id: string;
  direction: "inbound" | "outbound";
  counterpartyName: string;
  description: string;
  amount: string;
  currency: string;
  dueDate: string;
  status: "pending" | "paid" | "overdue";
  reference?: string | null;
  attachmentUrl?: string | null;
  createdAt: string;
};

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

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("sitesort_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function fmtAmount(currency: string, amount: string) {
  return `${currency} ${Number(amount).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string) {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function daysUntil(dateStr: string) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr + "T00:00:00");
  return Math.ceil((due.getTime() - today.getTime()) / 86400000);
}

function StatusBadge({ invoice }: { invoice: Invoice }) {
  if (invoice.status === "paid") return <Badge variant="success" className="gap-1"><CheckCircle2 className="w-3 h-3" />Paid</Badge>;
  const days = daysUntil(invoice.dueDate);
  if (days < 0) return <Badge variant="destructive" className="gap-1"><AlertTriangle className="w-3 h-3" />Overdue</Badge>;
  if (days <= 7) return <Badge className="gap-1 bg-orange-100 text-orange-700 border-orange-200"><Clock className="w-3 h-3" />Due in {days}d</Badge>;
  return <Badge variant="secondary" className="gap-1"><Clock className="w-3 h-3" />Due in {days}d</Badge>;
}

type FormData = {
  direction: "inbound" | "outbound";
  counterpartyName: string;
  description: string;
  amount: string;
  currency: string;
  dueDate: string;
  reference: string;
  projectId: string;
};

export default function InvoicesPage() {
  const { isCancelled } = useSubscription();
  const { toast } = useToast();
  const { data: projects } = useListProjects();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "inbound" | "outbound" | "pending" | "paid">("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<Invoice | null>(null);

  // drag-and-drop state
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragRowId, setDragRowId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const dragCounter = useRef(0);
  const lastDragRowRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const clickUploadIdRef = useRef<string | null>(null);

  const [listening, setListening] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const voiceSupported = typeof window !== "undefined" && !!(
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  );
  const toggleVoiceSearch = useCallback(() => {
    if (listening) { recognitionRef.current?.stop(); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRec = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SpeechRec) return;
    const rec = new SpeechRec();
    rec.continuous = false; rec.interimResults = true; rec.lang = "en-GB";
    rec.onstart = () => setListening(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => setSearch(Array.from(e.results as any[]).map((r: any) => r[0].transcript).join(""));
    rec.onend = () => { setListening(false); recognitionRef.current = null; };
    rec.onerror = () => { setListening(false); recognitionRef.current = null; };
    rec.start(); recognitionRef.current = rec;
  }, [listening]);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    defaultValues: { direction: "inbound", currency: "GBP" },
  });

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch("/api/invoices");
    if (res.ok) setInvoices(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-open modal or activate voice search when navigated here via voice command
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") {
      window.history.replaceState({}, "", "/invoices");
      setModalOpen(true);
    } else if (params.get("recall") === "1") {
      window.history.replaceState({}, "", "/invoices");
      toggleVoiceSearch();
    }
  }, [toggleVoiceSearch]);

  async function markPaid(id: string) {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    await apiFetch(`/api/invoices/${id}`, { method: "PATCH", body: JSON.stringify({ status: "paid" }) });
    setInvoices(prev => prev.map(inv => inv.id === id ? { ...inv, status: "paid" } : inv));
  }

  async function deleteInvoice(id: string) {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    await apiFetch(`/api/invoices/${id}`, { method: "DELETE" });
    setInvoices(prev => prev.filter(inv => inv.id !== id));
  }

  async function onSubmit(data: FormData) {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    setSubmitting(true);
    setError(null);
    const res = await apiFetch("/api/invoices", {
      method: "POST",
      body: JSON.stringify({ ...data, amount: data.amount, projectId: data.projectId || null }),
    });
    if (res.ok) {
      const created = await res.json();
      setInvoices(prev => [created, ...prev]);
      setModalOpen(false);
      reset();
    } else {
      setError("Failed to create invoice. Please check your inputs.");
    }
    setSubmitting(false);
  }

  // ── upload + attach ──
  const attachFile = useCallback(async (file: File, invoiceId: string) => {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    setUploadingId(invoiceId);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const uploadRes = await fetch("/api/upload", {
        method: "POST",
        headers: authHeaders(),
        body: fd,
      });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const { url } = await uploadRes.json();
      const patchRes = await apiFetch(`/api/invoices/${invoiceId}`, {
        method: "PATCH",
        body: JSON.stringify({ attachmentUrl: url }),
      });
      if (!patchRes.ok) throw new Error("Attach failed");
      setInvoices(prev => prev.map(inv => inv.id === invoiceId ? { ...inv, attachmentUrl: url } : inv));
    } catch { /* silent */ }
    finally { setUploadingId(null); }
  }, [isCancelled, toast]);

  // ── global drag listeners ──
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      dragCounter.current++;
      setIsDragOver(true);
    };
    const onDragLeave = () => {
      dragCounter.current--;
      if (dragCounter.current <= 0) {
        dragCounter.current = 0;
        setIsDragOver(false);
        setDragRowId(null);
        lastDragRowRef.current = null;
      }
    };
    const onDragOver = (e: DragEvent) => { e.preventDefault(); };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsDragOver(false);
      const targetId = lastDragRowRef.current;
      setDragRowId(null);
      lastDragRowRef.current = null;
      const file = e.dataTransfer?.files[0];
      if (file && targetId) attachFile(file, targetId);
    };
    document.addEventListener("dragenter", onDragEnter);
    document.addEventListener("dragleave", onDragLeave);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragenter", onDragEnter);
      document.removeEventListener("dragleave", onDragLeave);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
    };
  }, [attachFile]);

  // ── click-to-upload ──
  function triggerUpload(invoiceId: string) {
    clickUploadIdRef.current = invoiceId;
    fileInputRef.current?.click();
  }

  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const invoiceId = clickUploadIdRef.current;
    if (file && invoiceId) attachFile(file, invoiceId);
    e.target.value = "";
    clickUploadIdRef.current = null;
  }

  const filtered = invoices.filter(inv => {
    const matchSearch = inv.counterpartyName.toLowerCase().includes(search.toLowerCase()) ||
      inv.description.toLowerCase().includes(search.toLowerCase()) ||
      (inv.reference ?? "").toLowerCase().includes(search.toLowerCase());
    const matchFilter =
      filter === "all" ? true :
      filter === "inbound" ? inv.direction === "inbound" :
      filter === "outbound" ? inv.direction === "outbound" :
      filter === "pending" ? inv.status !== "paid" :
      inv.status === "paid";
    return matchSearch && matchFilter;
  }).sort((a, b) => {
    if (a.status === "paid" && b.status !== "paid") return 1;
    if (a.status !== "paid" && b.status === "paid") return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });

  const totalInbound = invoices.filter(i => i.direction === "inbound" && i.status !== "paid").reduce((s, i) => s + Number(i.amount), 0);
  const totalOutbound = invoices.filter(i => i.direction === "outbound" && i.status !== "paid").reduce((s, i) => s + Number(i.amount), 0);
  const overdue = invoices.filter(i => i.status !== "paid" && daysUntil(i.dueDate) < 0).length;

  return (
    <SidebarLayout>
      {/* Hidden file input for click-to-upload */}
      <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" className="hidden" onChange={onFileInputChange} />

      {/* Global drag overlay */}
      {isDragOver && (
        <div className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center">
          <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary rounded-none transition-all" />
          <div className="relative bg-card border-2 border-primary rounded-2xl px-8 py-6 shadow-2xl text-center">
            <Upload className="w-8 h-8 text-primary mx-auto mb-2" />
            <p className="font-semibold text-foreground">
              {dragRowId
                ? `Drop to attach to ${invoices.find(i => i.id === dragRowId)?.counterpartyName ?? "invoice"}`
                : "Hover over an invoice row to attach"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">PDF, PNG or JPG</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold">Invoices</h1>
          <p className="text-muted-foreground">Track payments in and out.</p>
        </div>
        <Button variant="accent" onClick={() => setModalOpen(true)}>
          <Plus className="w-4 h-4 mr-2" /> New Invoice
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <Card className="p-5 border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-900">
          <div className="flex items-center gap-3 mb-1">
            <ArrowDownCircle className="w-5 h-5 text-emerald-600" />
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Due To You</p>
          </div>
          <p className="text-2xl font-extrabold text-emerald-700 dark:text-emerald-300">
            GBP {totalInbound.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
          </p>
          <p className="text-xs text-emerald-600/70 mt-0.5">unpaid inbound</p>
        </Card>
        <Card className="p-5 border-rose-200 bg-rose-50 dark:bg-rose-950/20 dark:border-rose-900">
          <div className="flex items-center gap-3 mb-1">
            <ArrowUpCircle className="w-5 h-5 text-rose-600" />
            <p className="text-sm font-medium text-rose-700 dark:text-rose-400">You Owe</p>
          </div>
          <p className="text-2xl font-extrabold text-rose-700 dark:text-rose-300">
            GBP {totalOutbound.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
          </p>
          <p className="text-xs text-rose-600/70 mt-0.5">unpaid outbound</p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-3 mb-1">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            <p className="text-sm font-medium text-muted-foreground">Overdue</p>
          </div>
          <p className="text-2xl font-extrabold text-destructive">{overdue}</p>
          <p className="text-xs text-muted-foreground mt-0.5">invoice{overdue !== 1 ? "s" : ""} past due</p>
        </Card>
      </div>

      {/* Filters & search */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder={listening ? "Listening…" : "Search invoices…"}
            className={cn("pl-9", voiceSupported ? "pr-10" : "", listening && "border-orange-400 ring-1 ring-orange-400/60")}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {voiceSupported && (
            <button type="button" onClick={toggleVoiceSearch} title={listening ? "Stop" : "Search by voice"}
              className={cn("absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md transition-colors",
                listening ? "text-orange-500 animate-pulse" : "text-muted-foreground hover:text-primary")}>
              {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {(["all", "inbound", "outbound", "pending", "paid"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors capitalize
                ${filter === f ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:border-primary/40"}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Drag hint */}
      <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
        <Paperclip className="w-3.5 h-3.5" />
        Drag a PDF or image onto any row to attach the invoice document, or click the paperclip icon.
      </p>

      {/* Table */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="divide-y">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex items-center gap-4 p-4 animate-pulse">
                <div className="w-8 h-8 rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-muted rounded w-1/3" />
                  <div className="h-3 bg-muted rounded w-1/2" />
                </div>
                <div className="h-4 bg-muted rounded w-20" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <Receipt className="w-10 h-10 text-muted-foreground/30 mb-3" />
            <p className="font-semibold text-muted-foreground">No invoices found</p>
            <p className="text-sm text-muted-foreground/70 mt-1">Add your first invoice to track payments.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="px-5 py-3 w-12" />
                  <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Type</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Counterparty</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">Description</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Due</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">File</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map(inv => {
                  const isRowDragTarget = dragRowId === inv.id;
                  const isUploading = uploadingId === inv.id;
                  return (
                    <tr
                      key={inv.id}
                      onDragOver={e => {
                        e.preventDefault();
                        setDragRowId(inv.id);
                        lastDragRowRef.current = inv.id;
                      }}
                      onClick={() => setViewingInvoice(inv)}
                      className={cn(
                        "transition-colors cursor-pointer",
                        isRowDragTarget
                          ? "bg-primary/10 outline outline-2 outline-primary/40"
                          : "hover:bg-muted/20"
                      )}
                    >
                      {/* Avatar */}
                      <td className="pl-5 pr-2 py-3.5">
                        <button
                          onClick={e => { e.stopPropagation(); setViewingInvoice(inv); }}
                          title="View invoice"
                          className={cn(
                            "w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 transition-opacity hover:opacity-80",
                            inv.direction === "inbound"
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-rose-100 text-rose-700"
                          )}
                        >
                          {inv.counterpartyName.charAt(0).toUpperCase()}
                        </button>
                      </td>
                      <td className="px-5 py-3.5">
                        {inv.direction === "inbound"
                          ? <span className="flex items-center gap-1.5 text-emerald-600 font-medium"><ArrowDownCircle className="w-4 h-4" />In</span>
                          : <span className="flex items-center gap-1.5 text-rose-600 font-medium"><ArrowUpCircle className="w-4 h-4" />Out</span>
                        }
                      </td>
                      <td className="px-5 py-3.5">
                        <p className="font-medium text-foreground">{inv.counterpartyName}</p>
                        {inv.reference && <p className="text-xs text-muted-foreground">{inv.reference}</p>}
                      </td>
                      <td className="px-5 py-3.5 text-muted-foreground hidden md:table-cell max-w-xs truncate">{inv.description}</td>
                      <td className="px-5 py-3.5 font-semibold tabular-nums">{fmtAmount(inv.currency, inv.amount)}</td>
                      <td className="px-5 py-3.5 text-muted-foreground whitespace-nowrap">{fmtDate(inv.dueDate)}</td>
                      <td className="px-5 py-3.5"><StatusBadge invoice={inv} /></td>

                      {/* Attachment cell */}
                      <td className="px-5 py-3.5">
                        {isUploading ? (
                          <Loader2 className="w-4 h-4 animate-spin text-primary" />
                        ) : inv.attachmentUrl ? (
                          <div className="flex items-center gap-1">
                            <a
                              href={fullUrl(inv.attachmentUrl)}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1 text-xs text-primary hover:underline font-medium"
                              onClick={e => e.stopPropagation()}
                            >
                              <Paperclip className="w-3.5 h-3.5" />
                              Open
                            </a>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  title="Share"
                                  className="flex items-center gap-1 px-1.5 py-1 rounded text-muted-foreground hover:text-primary transition-colors text-xs"
                                  onClick={e => e.stopPropagation()}
                                >
                                  <Share2 className="w-3.5 h-3.5" />
                                  Share
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-40">
                                <DropdownMenuItem onClick={() => shareEmail(inv)} className="gap-2 cursor-pointer">
                                  <Mail className="w-4 h-4 text-muted-foreground" />
                                  Send via Email
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => shareWhatsApp(inv)} className="gap-2 cursor-pointer">
                                  <MessageCircle className="w-4 h-4 text-green-600" />
                                  Send via WhatsApp
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <button
                              title="Remove attachment"
                              onClick={e => {
                                e.stopPropagation();
                                apiFetch(`/api/invoices/${inv.id}`, { method: "PATCH", body: JSON.stringify({ attachmentUrl: null }) })
                                  .then(r => r.ok && setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, attachmentUrl: null } : i)));
                              }}
                              className="p-1 text-muted-foreground/50 hover:text-destructive transition-colors"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <button
                            title="Attach invoice document"
                            onClick={() => triggerUpload(inv.id)}
                            className={cn(
                              "flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors",
                              isRowDragTarget && "text-primary"
                            )}
                          >
                            <Paperclip className="w-3.5 h-3.5" />
                            Attach
                          </button>
                        )}
                      </td>

                      <td className="px-5 py-3.5" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-2 justify-end">
                          <button
                            onClick={e => { e.stopPropagation(); setViewingInvoice(inv); }}
                            title="View invoice"
                            className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {inv.status !== "paid" && (
                            <button onClick={e => { e.stopPropagation(); markPaid(inv.id); }} className="text-xs text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap">
                              Mark paid
                            </button>
                          )}
                          <button onClick={e => { e.stopPropagation(); deleteInvoice(inv.id); }} className="text-xs text-muted-foreground hover:text-destructive transition-colors">
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Invoice viewer overlay */}
      {viewingInvoice && (
        <div className="fixed inset-0 z-50 flex items-stretch justify-center">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setViewingInvoice(null)} />
          <div className="relative z-10 flex flex-col w-full max-w-5xl m-4 bg-background rounded-2xl shadow-2xl overflow-hidden">
            {/* Viewer header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b bg-muted/30 flex-shrink-0">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0",
                  viewingInvoice.direction === "inbound" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                )}>
                  {viewingInvoice.counterpartyName.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold truncate leading-tight">{viewingInvoice.counterpartyName}</p>
                  {viewingInvoice.reference && <p className="text-xs text-muted-foreground">{viewingInvoice.reference}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {viewingInvoice.attachmentUrl && (
                  <a
                    href={fullUrl(viewingInvoice.attachmentUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border bg-background hover:bg-muted transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Open in new tab
                  </a>
                )}
                {viewingInvoice.attachmentUrl && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border bg-background hover:bg-muted transition-colors">
                        <Share2 className="w-3.5 h-3.5" /> Share
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem onClick={() => shareEmail(viewingInvoice)} className="gap-2 cursor-pointer">
                        <Mail className="w-4 h-4 text-muted-foreground" /> Send via Email
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => shareWhatsApp(viewingInvoice)} className="gap-2 cursor-pointer">
                        <MessageCircle className="w-4 h-4 text-green-600" /> Send via WhatsApp
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {viewingInvoice.status !== "paid" && (
                  <button
                    onClick={() => { markPaid(viewingInvoice.id); setViewingInvoice(prev => prev ? { ...prev, status: "paid" } : null); }}
                    className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Mark paid
                  </button>
                )}
                <button
                  onClick={() => setViewingInvoice(null)}
                  className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Viewer body */}
            <div className="flex flex-col sm:flex-row flex-1 min-h-0 overflow-hidden">
              {/* Details sidebar */}
              <div className="sm:w-64 flex-shrink-0 border-b sm:border-b-0 sm:border-r p-5 overflow-y-auto space-y-4">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Type</p>
                  {viewingInvoice.direction === "inbound"
                    ? <span className="flex items-center gap-1.5 text-emerald-600 font-medium text-sm"><ArrowDownCircle className="w-4 h-4" />Inbound (owed to you)</span>
                    : <span className="flex items-center gap-1.5 text-rose-600 font-medium text-sm"><ArrowUpCircle className="w-4 h-4" />Outbound (you pay)</span>
                  }
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Amount</p>
                  <p className="text-2xl font-extrabold tabular-nums">{fmtAmount(viewingInvoice.currency, viewingInvoice.amount)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Status</p>
                  <StatusBadge invoice={viewingInvoice} />
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Due Date</p>
                  <p className="text-sm font-medium">{fmtDate(viewingInvoice.dueDate)}</p>
                </div>
                {viewingInvoice.description && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Description</p>
                    <p className="text-sm text-muted-foreground">{viewingInvoice.description}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Created</p>
                  <p className="text-sm text-muted-foreground">{fmtDate(viewingInvoice.createdAt.slice(0, 10))}</p>
                </div>
                {!viewingInvoice.attachmentUrl && (
                  <button
                    onClick={() => { setViewingInvoice(null); triggerUpload(viewingInvoice.id); }}
                    className="w-full flex items-center justify-center gap-2 text-sm text-muted-foreground border border-dashed rounded-lg py-3 hover:text-primary hover:border-primary transition-colors"
                  >
                    <Paperclip className="w-4 h-4" /> Attach document
                  </button>
                )}
              </div>

              {/* File viewer */}
              <div className="flex-1 min-h-0 overflow-auto bg-muted/20 flex flex-col">
                {viewingInvoice.attachmentUrl ? (() => {
                  const url = fullUrl(viewingInvoice.attachmentUrl);
                  const isImg = /\.(png|jpe?g|webp|gif)$/i.test(url);
                  const isPdf = /\.pdf$/i.test(url);
                  if (isImg) {
                    return (
                      <div className="flex-1 flex items-center justify-center p-6 min-h-64">
                        <img
                          src={url}
                          alt="Invoice attachment"
                          className="max-w-full max-h-full object-contain rounded-lg shadow-md"
                        />
                      </div>
                    );
                  }
                  if (isPdf) {
                    return (
                      <iframe
                        src={url}
                        title="Invoice PDF"
                        className="flex-1 w-full min-h-[500px] border-0"
                      />
                    );
                  }
                  return (
                    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
                      <FileText className="w-12 h-12 text-muted-foreground/40" />
                      <p className="text-sm text-muted-foreground">Preview not available for this file type.</p>
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                      >
                        <ExternalLink className="w-4 h-4" /> Open file
                      </a>
                    </div>
                  );
                })() : (
                  <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
                    <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                      <Image className="w-7 h-7 text-muted-foreground/40" />
                    </div>
                    <div>
                      <p className="font-medium mb-1">No document attached</p>
                      <p className="text-sm text-muted-foreground">Drag a PDF or image onto the invoice row to attach it.</p>
                    </div>
                    <button
                      onClick={() => { setViewingInvoice(null); triggerUpload(viewingInvoice.id); }}
                      className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg border hover:bg-muted transition-colors"
                    >
                      <Upload className="w-4 h-4" /> Choose file
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create modal */}
      <Dialog open={modalOpen} onOpenChange={open => { setModalOpen(open); if (!open) { reset(); setError(null); } }}>
          <DialogHeader>
            <DialogTitle>New Invoice</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">
            {/* Direction */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">Type</label>
              <div className="grid grid-cols-2 gap-2">
                {(["inbound", "outbound"] as const).map(d => (
                  <label key={d} className="relative flex items-center gap-2 p-3 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                    <input type="radio" value={d} {...register("direction", { required: true })} className="sr-only" />
                    {d === "inbound"
                      ? <><ArrowDownCircle className="w-4 h-4 text-emerald-600" /><span className="text-sm font-medium">Inbound <span className="text-muted-foreground font-normal">(owed to you)</span></span></>
                      : <><ArrowUpCircle className="w-4 h-4 text-rose-600" /><span className="text-sm font-medium">Outbound <span className="text-muted-foreground font-normal">(you pay)</span></span></>
                    }
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Counterparty Name</label>
              <Input placeholder="e.g. Acme Supplies Ltd" {...register("counterpartyName", { required: true })} />
              {errors.counterpartyName && <p className="text-xs text-destructive mt-1">Required</p>}
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Description</label>
              <Input placeholder="e.g. Materials — Site A" {...register("description", { required: true })} />
              {errors.description && <p className="text-xs text-destructive mt-1">Required</p>}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-1">
                <label className="text-sm font-medium mb-1.5 block">Currency</label>
                <select {...register("currency")} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                  <option>GBP</option>
                  <option>EUR</option>
                  <option>USD</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-sm font-medium mb-1.5 block">Amount</label>
                <Input type="number" step="0.01" min="0" placeholder="0.00" {...register("amount", { required: true, min: 0.01 })} />
                {errors.amount && <p className="text-xs text-destructive mt-1">Enter a valid amount</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Due Date</label>
                <Input type="date" {...register("dueDate", { required: true })} />
                {errors.dueDate && <p className="text-xs text-destructive mt-1">Required</p>}
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Reference <span className="text-muted-foreground font-normal">(optional)</span></label>
                <Input placeholder="INV-001" {...register("reference")} />
              </div>
            </div>

            {(projects?.filter(p => p.status === "active") ?? []).length > 0 && (
              <div>
                <label className="text-sm font-medium mb-1.5 block">Link to Project <span className="text-muted-foreground font-normal">(optional)</span></label>
                <select {...register("projectId")} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="">— No project —</option>
                  {projects?.filter(p => p.status === "active").map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setModalOpen(false); reset(); setError(null); }}>Cancel</Button>
              <Button type="submit" variant="accent" disabled={submitting}>{submitting ? "Saving…" : "Save Invoice"}</Button>
            </DialogFooter>
          </form>
      </Dialog>
    </SidebarLayout>
  );
}
