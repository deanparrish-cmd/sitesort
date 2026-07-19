import { useState, useEffect, useRef } from "react";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QRCodeCanvas } from "qrcode.react";
import { cn } from "@/lib/utils";
import {
  Share2, Mail, MessageCircle, Users, ExternalLink, X,
  Download, Clock, Loader2, CheckCircle2, Pin, PinOff, QrCode, ChevronDown,
} from "lucide-react";

type ShareLog = {
  id: string; entityType: string; entityId: string; entityName: string;
  method: string; recipientInfo: string | null; sentByName: string; createdAt: string;
};
type Project = { id: string; name: string };
type PortalTrade = { trade: string; memberCount: number };
type PortalMemberOpt = { personId: string; userId: string; name: string };
type PortalShareRule = { id: string; audienceType: string; trade?: string; personId?: string; personName?: string };

export interface ShareModalProps {
  open: boolean;
  onClose: () => void;
  entityType: string;
  entityId: string;
  entityName: string;
  fileUrl?: string | null;
  projectId?: string | null;
  version?: number | null;
  additionalInfo?: string | null;
  /** Plain text to share when there is no fileUrl (e.g. a daily note). */
  shareText?: string | null;
}

function normaliseUrl(url: string) {
  const norm = url.replace(/^\/uploads\//, "/api/uploads/");
  return norm.startsWith("http") ? norm : `${window.location.origin}${norm}`;
}

// Portal-shareable entity types (things portal members can actually open). Also
// the set that can be pinned to the Site Board.
const PORTAL_ENTITY_TYPES = new Set(["document", "photo", "permit", "plant_item"]);

function methodLabel(method: string) {
  const map: Record<string, string> = {
    email: "Email", whatsapp: "WhatsApp", project_team: "Project Team",
    individual: "Individual", team: "Project Team", qr: "QR Code", portal: "Team Portal",
  };
  return map[method] ?? method;
}

function shareRuleLabel(s: PortalShareRule): string {
  if (s.audienceType === "all") return "Everyone on this project";
  if (s.audienceType === "trade") return `Trade: ${s.trade}`;
  return s.personName ?? "A team member";
}

export function ShareModal({ open, onClose, entityType, entityId, entityName, fileUrl, projectId, version, additionalInfo, shareText }: ShareModalProps) {
  const [tab, setTab] = useState<"share" | "qr" | "history">("share");
  const [history, setHistory] = useState<ShareLog[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  // Team Portal sharing state
  const [portalMode, setPortalMode] = useState<"all" | "trade" | "person">("all");
  const [selTrades, setSelTrades] = useState<string[]>([]);
  const [selPersons, setSelPersons] = useState<string[]>([]);
  const [portalTrades, setPortalTrades] = useState<PortalTrade[]>([]);
  const [portalMembers, setPortalMembers] = useState<PortalMemberOpt[]>([]);
  const [existingShares, setExistingShares] = useState<PortalShareRule[]>([]);
  const [portalSharing, setPortalSharing] = useState(false);
  const [portalMsg, setPortalMsg] = useState<string | null>(null);
  const [isPinned, setIsPinned] = useState(false);
  const [pinLoading, setPinLoading] = useState(false);
  const [siteBoardUrl, setSiteBoardUrl] = useState<string | null>(null);
  // Project picker — used when no projectId prop is supplied (e.g. insurance certs in Compliance)
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const token = () => localStorage.getItem("sitesort_token");
  const authH = () => ({ "Content-Type": "application/json", ...(token() ? { Authorization: `Bearer ${token()}` } : {}) });

  // Effective project id: either the prop (project-context pages) or user-selected
  const effectiveProjectId = projectId || selectedProjectId || null;

  const fullUrl = fileUrl ? normaliseUrl(fileUrl) : null;
  const isPortalEntity = PORTAL_ENTITY_TYPES.has(entityType);
  const canPin = isPortalEntity && !!projectId;
  const hasContent = !!(fullUrl || shareText);

  useEffect(() => {
    if (!open) {
      setTab("share"); setIsPinned(false);
      setSiteBoardUrl(null); setSelectedProjectId("");
      setPortalMode("all"); setSelTrades([]); setSelPersons([]);
      setPortalTrades([]); setPortalMembers([]); setExistingShares([]); setPortalMsg(null);
    }
  }, [open]);

  // Load project list when no projectId prop is given (e.g. Compliance Centre insurance)
  useEffect(() => {
    if (!open || projectId) return;
    fetch("/api/projects", { headers: token() ? { Authorization: `Bearer ${token()}` } : {} })
      .then(r => r.ok ? r.json() : [])
      .then((data: any[]) => setProjects(data.filter((p: any) => p.status !== "archived")))
      .catch(() => {});
  }, [open, projectId]);

  // Load portal audience (trades + members) and current share rules for this item.
  const loadPortalShares = () => {
    if (!effectiveProjectId) return;
    fetch(`/api/projects/${effectiveProjectId}/portal-shares?itemType=${entityType}&itemId=${entityId}`, { headers: authH() })
      .then(r => r.ok ? r.json() : [])
      .then((rules: PortalShareRule[]) => setExistingShares(Array.isArray(rules) ? rules : []))
      .catch(() => {});
  };
  useEffect(() => {
    if (!open || !isPortalEntity || !effectiveProjectId) return;
    fetch(`/api/projects/${effectiveProjectId}/portal-audience`, { headers: authH() })
      .then(r => r.ok ? r.json() : { trades: [], members: [] })
      .then((d: { trades: PortalTrade[]; members: PortalMemberOpt[] }) => {
        setPortalTrades(d.trades ?? []);
        setPortalMembers(d.members ?? []);
      })
      .catch(() => {});
    loadPortalShares();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isPortalEntity, effectiveProjectId, entityId]);

  useEffect(() => {
    if (tab !== "qr" || !open || !effectiveProjectId) return;
    const h: Record<string, string> = token() ? { Authorization: `Bearer ${token()}` } : {};
    fetch(`/api/projects/${effectiveProjectId}/qr-codes`, { headers: h })
      .then(r => r.ok ? r.json() : [])
      .then((codes: { siteUrl: string }[]) => { setSiteBoardUrl(codes[0]?.siteUrl ?? null); })
      .catch(() => {});
    if (!canPin) return;
    fetch(`/api/projects/${effectiveProjectId}/qr-pins`, { headers: h })
      .then(r => r.ok ? r.json() : [])
      .then((pins: { itemType: string; itemId: string }[]) => {
        setIsPinned(pins.some(p => p.itemType === entityType && p.itemId === entityId));
      })
      .catch(() => {});
  }, [tab, open, effectiveProjectId, canPin, entityType, entityId]);

  useEffect(() => {
    if (tab !== "history" || !open) return;
    setHistoryLoading(true);
    fetch(`/api/share-logs?entityType=${entityType}&entityId=${entityId}`, {
      headers: token() ? { Authorization: `Bearer ${token()}` } : {},
    })
      .then(r => r.ok ? r.json() : [])
      .then(setHistory)
      .finally(() => setHistoryLoading(false));
  }, [tab, open, entityType, entityId]);

  const logShare = (method: string, recipientInfo?: string) => {
    fetch("/api/share-logs", {
      method: "POST",
      headers: authH(),
      body: JSON.stringify({ entityType, entityId, entityName, method, recipientInfo, projectId: effectiveProjectId }),
    }).catch(() => {});
  };

  const versionSuffix = version ? ` (v${version})` : "";

  const shareEmail = () => {
    if (!hasContent) return;
    const subject = encodeURIComponent(`${entityName}${versionSuffix}`);
    const details = additionalInfo ? `\n\n${additionalInfo}` : "";
    const body = shareText && !fullUrl
      ? encodeURIComponent(`${shareText}${details}`)
      : encodeURIComponent(`Hi,\n\nPlease find "${entityName}"${versionSuffix} here:\n\n${fullUrl}${details}`);
    window.open(`mailto:?subject=${subject}&body=${body}`);
    logShare("email");
  };

  const shareWhatsApp = () => {
    if (!hasContent) return;
    const details = additionalInfo ? `\n\n${additionalInfo}` : "";
    const text = shareText && !fullUrl
      ? encodeURIComponent(`${shareText}${details}`)
      : encodeURIComponent(`${entityName}${versionSuffix}\n${fullUrl}${details}`);
    window.open(`https://wa.me/?text=${text}`, "_blank");
    logShare("whatsapp");
  };

  const toggleTrade = (t: string) => setSelTrades(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  const togglePerson = (p: string) => setSelPersons(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);

  const submitPortalShare = async () => {
    if (!effectiveProjectId) return;
    const audiences =
      portalMode === "all" ? [{ type: "all" as const }] :
      portalMode === "trade" ? selTrades.map(t => ({ type: "trade" as const, trade: t })) :
      selPersons.map(p => ({ type: "person" as const, personId: p }));
    if (audiences.length === 0) return;
    setPortalSharing(true);
    setPortalMsg(null);
    try {
      const res = await fetch(`/api/projects/${effectiveProjectId}/portal-shares`, {
        method: "POST",
        headers: authH(),
        body: JSON.stringify({ itemType: entityType, itemId: entityId, audiences }),
      });
      const data = await res.json().catch(() => ({}));
      const n = typeof data.recipientCount === "number" ? data.recipientCount : null;
      const summary = portalMode === "all" ? "everyone on this project"
        : portalMode === "trade" ? `${selTrades.length} trade${selTrades.length !== 1 ? "s" : ""}`
        : `${selPersons.length} ${selPersons.length !== 1 ? "people" : "person"}`;
      setPortalMsg(`Shared to ${summary}${n !== null ? ` · ${n} member${n !== 1 ? "s" : ""} now have access` : ""}`);
      logShare("portal", summary);
      setSelTrades([]); setSelPersons([]);
      loadPortalShares();
    } finally {
      setPortalSharing(false);
    }
  };

  const removePortalShare = async (id: string) => {
    if (!effectiveProjectId) return;
    await fetch(`/api/projects/${effectiveProjectId}/portal-shares/${id}`, { method: "DELETE", headers: authH() }).catch(() => {});
    setExistingShares(prev => prev.filter(s => s.id !== id));
  };

  const togglePin = async () => {
    if (!canPin) return;
    setPinLoading(true);
    const method = isPinned ? "DELETE" : "POST";
    await fetch(`/api/projects/${projectId}/qr-pins`, {
      method,
      headers: authH(),
      body: JSON.stringify({ itemType: entityType, itemId: entityId }),
    }).catch(() => {});
    setIsPinned(v => !v);
    setPinLoading(false);
  };

  const downloadQr = () => {
    const url = canvasRef.current?.toDataURL("image/png");
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${entityName.replace(/[^a-z0-9]/gi, "-")}-qr.png`;
    a.click();
    logShare("qr");
  };

  const selectedProjectName = !projectId && selectedProjectId
    ? projects.find(p => p.id === selectedProjectId)?.name
    : null;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Share2 className="w-4 h-4" /> Share
        </DialogTitle>
        <p className="text-sm text-muted-foreground truncate">{entityName}{versionSuffix}</p>
      </DialogHeader>

        {/* Tabs */}
        <div className="flex border-b -mx-4 sm:-mx-6 px-4 sm:px-6">
          {(["share", "qr", "history"] as const).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setPortalMsg(null); }}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {t === "qr" ? "QR Code" : t === "history" ? "History" : "Share"}
            </button>
          ))}
        </div>

        {/* ── Share tab ── */}
        {tab === "share" && (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">External</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  disabled={!hasContent}
                  onClick={shareEmail}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-border bg-background hover:bg-muted transition-colors text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Mail className="w-4 h-4 text-blue-500" /> Email
                </button>
                <button
                  disabled={!hasContent}
                  onClick={shareWhatsApp}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-border bg-background hover:bg-muted transition-colors text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <MessageCircle className="w-4 h-4 text-green-500" /> WhatsApp
                </button>
              </div>
            </div>

            {/* Team Portal — only for portal-shareable entities (document/photo/permit) */}
            {isPortalEntity && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Team Portal</p>

                {/* Project picker when no project context (rare for portal entities) */}
                {!effectiveProjectId ? (
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">Choose a project to share into its portal:</p>
                    <Select value={selectedProjectId} onValueChange={val => setSelectedProjectId(val)}>
                      <SelectTrigger className="w-full text-sm h-10">
                        <SelectValue placeholder={projects.length ? "Select a project…" : "Loading projects…"} />
                      </SelectTrigger>
                      <SelectContent>
                        {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {!projectId && selectedProjectName && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground truncate">{selectedProjectName}</span>
                        <button onClick={() => setSelectedProjectId("")} className="flex items-center gap-0.5 hover:text-foreground shrink-0">
                          <ChevronDown className="w-3 h-3" /> Change
                        </button>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">Portal members see only what's shared with them. Trade shares also reach people invited later.</p>

                    {/* Audience mode */}
                    <div className="flex gap-1 p-1 rounded-lg bg-muted">
                      {([["all", "Everyone"], ["trade", "Trades"], ["person", "People"]] as const).map(([m, label]) => (
                        <button
                          key={m}
                          onClick={() => { setPortalMode(m); setPortalMsg(null); }}
                          className={cn("flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors", portalMode === m ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {portalMode === "all" && (
                      <p className="text-xs text-muted-foreground">Everyone on this project's portal will be able to see it.</p>
                    )}
                    {portalMode === "trade" && (
                      <div className="flex flex-wrap gap-1.5">
                        {portalTrades.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No trades on this project yet.</p>
                        ) : portalTrades.map(t => {
                          const empty = t.memberCount === 0;
                          const sel = selTrades.includes(t.trade);
                          return (
                            <button
                              key={t.trade}
                              disabled={empty}
                              onClick={() => toggleTrade(t.trade)}
                              title={empty ? "No portal members in this trade yet" : undefined}
                              className={cn(
                                "inline-flex items-center gap-1 max-w-full px-2.5 py-1 rounded-full text-xs border transition-colors",
                                empty ? "opacity-50 cursor-not-allowed border-dashed text-muted-foreground"
                                  : sel ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-background border-border hover:border-primary/40",
                              )}
                            >
                              <span className="truncate">{t.trade}</span>
                              <span className="shrink-0 opacity-70">{empty ? "· no members" : `· ${t.memberCount}`}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {portalMode === "person" && (
                      <div className="flex flex-wrap gap-1.5">
                        {portalMembers.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No portal members on this project yet.</p>
                        ) : portalMembers.map(m => {
                          const sel = selPersons.includes(m.personId);
                          return (
                            <button
                              key={m.personId}
                              onClick={() => togglePerson(m.personId)}
                              className={cn(
                                "inline-flex items-center max-w-full px-2.5 py-1 rounded-full text-xs border transition-colors",
                                sel ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:border-primary/40",
                              )}
                            >
                              <span className="truncate">{m.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <button
                      onClick={submitPortalShare}
                      disabled={portalSharing || (portalMode === "trade" && selTrades.length === 0) || (portalMode === "person" && selPersons.length === 0)}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {portalSharing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
                      Share to portal
                    </button>

                    {portalMsg && (
                      <p className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> {portalMsg}
                      </p>
                    )}

                    {existingShares.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">Currently shared with</p>
                        {existingShares.map(s => (
                          <div key={s.id} className="flex items-center gap-2 text-xs bg-muted/50 rounded-md px-2 py-1.5">
                            <span className="flex-1 min-w-0 truncate">{shareRuleLabel(s)}</span>
                            <button onClick={() => removePortalShare(s.id)} title="Remove" className="shrink-0 rounded-full p-0.5 hover:bg-muted">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── QR tab ── */}
        {tab === "qr" && (
          <div className="flex flex-col items-center gap-4 py-2">
            {fullUrl ? (
              <>
                <div className="p-4 bg-white rounded-xl border shadow-sm">
                  <QRCodeCanvas ref={canvasRef} value={fullUrl} size={200} level="H" includeMargin={false} />
                </div>
                <p className="text-xs text-muted-foreground text-center break-all max-w-xs px-2">{fullUrl}</p>
                <div className="flex gap-2">
                  <button
                    onClick={downloadQr}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-background hover:bg-muted transition-colors text-sm font-medium"
                  >
                    <Download className="w-4 h-4" /> Download PNG
                  </button>
                  <button
                    onClick={() => { navigator.clipboard.writeText(fullUrl).catch(() => {}); }}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-background hover:bg-muted transition-colors text-sm font-medium"
                  >
                    Copy Link
                  </button>
                </div>

                {(siteBoardUrl || canPin) && (
                  <div className="w-full border-t pt-4 space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center">Site Board</p>
                    {siteBoardUrl && (
                      <a
                        href={siteBoardUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-border bg-background hover:bg-muted transition-colors text-sm font-medium"
                      >
                        <QrCode className="w-4 h-4 text-primary" /> View Site Board
                      </a>
                    )}
                    {canPin && (
                      <>
                        <button
                          onClick={togglePin}
                          disabled={pinLoading}
                          className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors disabled:opacity-40 ${
                            isPinned
                              ? "bg-primary/10 border-primary/30 text-primary hover:bg-primary/20"
                              : "border-border bg-background hover:bg-muted text-foreground"
                          }`}
                        >
                          {pinLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : isPinned ? (
                            <><PinOff className="w-4 h-4" /> Remove from Site Board</>
                          ) : (
                            <><Pin className="w-4 h-4" /> Pin to Site Board</>
                          )}
                        </button>
                        <p className="text-xs text-muted-foreground text-center">
                          {isPinned
                            ? "Visible to anyone who scans the site QR code"
                            : "Pin so workers can access it by scanning the site QR code"}
                        </p>
                      </>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">No file available for QR code.</p>
            )}
          </div>
        )}

        {/* ── History tab ── */}
        {tab === "history" && (
          <div className="min-h-[120px]">
            {historyLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : history.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No shares recorded yet.</p>
            ) : (
              <div className="space-y-0 max-h-64 overflow-y-auto divide-y">
                {history.map(log => (
                  <div key={log.id} className="flex items-start gap-3 py-2.5">
                    <Clock className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm">
                        <span className="font-medium">{log.sentByName}</span>
                        {" via "}
                        <span className="font-medium">{methodLabel(log.method)}</span>
                        {log.recipientInfo ? <span className="text-muted-foreground"> → {log.recipientInfo}</span> : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(log.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                        {" · "}
                        {new Date(log.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      <div className="flex items-center justify-between pt-1 border-t mt-2">
        {fullUrl ? (
          <button
            onClick={() => window.open(fullUrl, "_blank", "noopener,noreferrer")}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Open file
          </button>
        ) : <span />}
        <Button variant="outline" size="sm" onClick={onClose}>Done</Button>
      </div>
    </Dialog>
  );
}
