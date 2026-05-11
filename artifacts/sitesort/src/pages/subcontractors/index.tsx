import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Plus, Search, ChevronDown, ChevronRight, HardHat, Mail, Phone,
  ShieldCheck, ShieldAlert, ShieldX, Shield, Star, AlertTriangle,
  Users, Pencil, X, FolderOpen, Mic, MicOff, MessageSquare,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { cn } from "@/lib/utils";

type InsuranceStatus = "valid" | "expiring_soon" | "expired" | "none";

type Sub = {
  id: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  trades: string[];
  reliabilityRating: number | null;
  paymentHold: boolean;
  insuranceStatus: InsuranceStatus;
  createdAt: string;
};

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

function insuranceBadge(status: InsuranceStatus) {
  if (status === "valid") return <Badge className="gap-1 text-[10px] bg-emerald-100 text-emerald-700 border-emerald-200"><ShieldCheck className="w-3 h-3" />Insurance OK</Badge>;
  if (status === "expiring_soon") return <Badge className="gap-1 text-[10px] bg-yellow-100 text-yellow-700 border-yellow-200"><ShieldAlert className="w-3 h-3" />Expiring Soon</Badge>;
  if (status === "expired") return <Badge variant="destructive" className="gap-1 text-[10px]"><ShieldX className="w-3 h-3" />Insurance Expired</Badge>;
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
  trades: string[];
};

type EditFormData = AddFormData & { reliabilityRating: string; paymentHold: boolean };

export default function SubcontractorsPage() {
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

  const [listening, setListening] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const voiceSupported = typeof window !== "undefined" && !!(
    (window as unknown as Record<string, unknown>).SpeechRecognition ||
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition
  );

  function toggleVoiceSearch() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRec = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SpeechRec) return;
    const rec = new SpeechRec();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = "en-GB";
    rec.onstart = () => setListening(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      const transcript = Array.from(e.results as any[]).map((r: any) => r[0].transcript).join("");
      setSearch(transcript);
    };
    rec.onend = () => { setListening(false); recognitionRef.current = null; };
    rec.onerror = () => { setListening(false); recognitionRef.current = null; };
    rec.start();
    recognitionRef.current = rec;
  }

  const { register, handleSubmit, reset, formState: { errors } } = useForm<AddFormData>();
  const { register: editReg, handleSubmit: editSubmit, reset: editReset } = useForm<EditFormData>();

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch("/api/subcontractors");
    if (res.ok) setSubs(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Group subs by trade — a sub can appear in multiple trade groups
  const grouped = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = subs.filter(s =>
      s.companyName.toLowerCase().includes(q) ||
      s.contactName.toLowerCase().includes(q) ||
      s.trades.some(t => t.toLowerCase().includes(q))
    );

    const map: Record<string, Sub[]> = {};
    for (const s of filtered) {
      const trades = s.trades.length ? s.trades : ["Other"];
      for (const trade of trades) {
        (map[trade] ??= []).push(s);
      }
    }

    // Sort trade keys: known categories first in order, then unknowns alphabetically
    const known = TRADE_CATEGORIES.filter(t => map[t]);
    const unknown = Object.keys(map).filter(t => !TRADE_CATEGORIES.includes(t)).sort();
    return { map, orderedKeys: [...known, ...unknown] };
  }, [subs, search]);

  const toggleTrade = (trade: string) =>
    setOpenTrades(prev => ({ ...prev, [trade]: !(prev[trade] ?? true) }));

  async function onAdd(data: AddFormData) {
    setSubmitting(true); setAddError(null);
    const res = await apiFetch("/api/subcontractors", {
      method: "POST",
      body: JSON.stringify({ ...data, trades: selectedTradesAdd }),
    });
    if (res.ok) {
      const created = await res.json();
      setSubs(prev => [created, ...prev]);
      setAddOpen(false); reset(); setSelectedTradesAdd([]);
    } else {
      const e = await res.json().catch(() => ({}));
      setAddError(e.message ?? "Failed to add subcontractor.");
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
      reliabilityRating: sub.reliabilityRating != null ? String(sub.reliabilityRating) : "",
      paymentHold: sub.paymentHold,
    });
  }

  async function onEdit(data: EditFormData) {
    if (!editTarget) return;
    setSubmitting(true); setEditError(null);
    const res = await apiFetch(`/api/subcontractors/${editTarget.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        ...data,
        trades: selectedTradesEdit,
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
          <h1 className="text-3xl font-bold">Subcontractors</h1>
          <p className="text-muted-foreground">Directory of all your subcontractors, grouped by trade.</p>
        </div>
        <Button variant="accent" onClick={() => { setAddOpen(true); setAddError(null); reset(); setSelectedTradesAdd([]); }}>
          <Plus className="w-4 h-4 mr-2" /> Add Subcontractor
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-8">
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

      {/* Search + Voice */}
      <div className="relative max-w-sm mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder={listening ? "Listening…" : "Search by name, trade or company…"}
          className={cn("pl-9", voiceSupported ? "pr-10" : "", listening && "border-orange-400 ring-1 ring-orange-400/60")}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {voiceSupported && (
          <button
            type="button"
            onClick={toggleVoiceSearch}
            title={listening ? "Stop listening" : "Search by voice"}
            className={cn(
              "absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md transition-colors",
              listening ? "text-orange-500 animate-pulse" : "text-muted-foreground hover:text-primary"
            )}
          >
            {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
        )}
      </div>

      {/* Directory */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />)}
        </div>
      ) : grouped.orderedKeys.length === 0 ? (
        <Card className="p-12 text-center border-dashed border-2">
          <HardHat className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
          <h3 className="font-bold text-lg mb-1">{search ? "No results" : "No subcontractors yet"}</h3>
          <p className="text-muted-foreground text-sm mb-6">{search ? "Try a different search." : "Add your first subcontractor to get started."}</p>
          {!search && <Button variant="accent" onClick={() => setAddOpen(true)}><Plus className="w-4 h-4 mr-2" />Add Subcontractor</Button>}
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
                  <FolderOpen className="w-5 h-5 text-orange-500 shrink-0" />
                  <span className="font-bold flex-1">{trade}</span>
                  <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full mr-1">
                    {members.length} {members.length === 1 ? "company" : "companies"}
                  </span>
                </button>

                {open && (
                  <div className="border-t divide-y">
                    {members.map(sub => (
                      <div key={sub.id} className={cn("flex items-center gap-3 px-5 py-4 hover:bg-muted/10 transition-colors", sub.paymentHold && "bg-red-50/50 dark:bg-red-950/10")}>
                        {/* Avatar */}
                        <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                          <span className="font-extrabold text-primary text-sm">
                            {sub.companyName.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}
                          </span>
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-bold text-sm">{sub.companyName}</p>
                            {sub.paymentHold && (
                              <Badge variant="destructive" className="text-[10px] gap-1"><AlertTriangle className="w-3 h-3" />Payment Hold</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{sub.contactName}</p>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                            {sub.contactPhone && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Phone className="w-3 h-3 shrink-0" />{sub.contactPhone}
                              </span>
                            )}
                            {sub.contactEmail && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                                <Mail className="w-3 h-3 shrink-0" />{sub.contactEmail}
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
                        </div>

                        {/* Contact actions */}
                        <ContactActions email={sub.contactEmail} phone={sub.contactPhone} />

                        {/* Status */}
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          {insuranceBadge(sub.insuranceStatus)}
                          <RatingStars rating={sub.reliabilityRating} />
                        </div>

                        {/* Edit */}
                        <button
                          onClick={() => openEdit(sub)}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-muted transition-colors shrink-0"
                          title="Edit"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
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
          <DialogTitle>Add Subcontractor</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onAdd)} className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
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

          {addError && <p className="text-sm text-destructive">{addError}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button type="submit" variant="accent" disabled={submitting}>{submitting ? "Saving…" : "Add Subcontractor"}</Button>
          </DialogFooter>
        </form>
      </Dialog>

      {/* Edit modal */}
      <Dialog open={!!editTarget} onOpenChange={open => { if (!open) { setEditTarget(null); setEditError(null); } }}>
        <DialogHeader>
          <DialogTitle>Edit — {editTarget?.companyName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={editSubmit(onEdit)} className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Reliability Rating</label>
              <select {...editReg("reliabilityRating")} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
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

          {editError && <p className="text-sm text-destructive">{editError}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button type="submit" variant="accent" disabled={submitting}>{submitting ? "Saving…" : "Save Changes"}</Button>
          </DialogFooter>
        </form>
      </Dialog>
    </SidebarLayout>
  );
}
