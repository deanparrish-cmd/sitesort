import { useState, useEffect, useRef } from "react";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QRCodeCanvas } from "qrcode.react";
import {
  Share2, Mail, MessageCircle, Users, Send, ExternalLink,
  Download, Clock, Loader2, CheckCircle2, Pin, PinOff,
} from "lucide-react";

type ShareLog = {
  id: string; entityType: string; entityId: string; entityName: string;
  method: string; recipientInfo: string | null; sentByName: string; createdAt: string;
};
type Member = { id: string; name: string; userId: string | null };

export interface ShareModalProps {
  open: boolean;
  onClose: () => void;
  entityType: string;
  entityId: string;
  entityName: string;
  fileUrl?: string | null;
  projectId?: string | null;
  version?: number | null;
}

function normaliseUrl(url: string) {
  const norm = url.replace(/^\/uploads\//, "/api/uploads/");
  return norm.startsWith("http") ? norm : `${window.location.origin}${norm}`;
}

const MSG_ATTACHMENT_TYPES = new Set(["document", "photo", "permit"]);

function methodLabel(method: string) {
  const map: Record<string, string> = {
    email: "Email", whatsapp: "WhatsApp", project_team: "Project Team",
    individual: "Individual", team: "Project Team", qr: "QR Code",
  };
  return map[method] ?? method;
}

export function ShareModal({ open, onClose, entityType, entityId, entityName, fileUrl, projectId, version }: ShareModalProps) {
  const [tab, setTab] = useState<"share" | "qr" | "history">("share");
  const [history, setHistory] = useState<ShareLog[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [isPinned, setIsPinned] = useState(false);
  const [pinLoading, setPinLoading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const token = () => localStorage.getItem("sitesort_token");
  const authH = () => ({ "Content-Type": "application/json", ...(token() ? { Authorization: `Bearer ${token()}` } : {}) });

  const fullUrl = fileUrl ? normaliseUrl(fileUrl) : null;
  const hasAttachment = MSG_ATTACHMENT_TYPES.has(entityType);
  const canPin = hasAttachment && !!projectId;

  useEffect(() => {
    if (!open) { setTab("share"); setSentTo(null); setSelectedUserId(""); setIsPinned(false); }
  }, [open]);

  useEffect(() => {
    if (!open || !projectId) return;
    fetch(`/api/projects/${projectId}/members`, { headers: token() ? { Authorization: `Bearer ${token()}` } : {} })
      .then(r => r.ok ? r.json() : [])
      .then((data: any[]) => setMembers(data.filter((m: any) => m.userId)))
      .catch(() => {});
  }, [open, projectId]);

  useEffect(() => {
    if (tab !== "qr" || !open || !canPin) return;
    fetch(`/api/projects/${projectId}/qr-pins`, {
      headers: token() ? { Authorization: `Bearer ${token()}` } : {},
    })
      .then(r => r.ok ? r.json() : [])
      .then((pins: { itemType: string; itemId: string }[]) => {
        setIsPinned(pins.some(p => p.itemType === entityType && p.itemId === entityId));
      })
      .catch(() => {});
  }, [tab, open, canPin, projectId, entityType, entityId]);

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
      body: JSON.stringify({ entityType, entityId, entityName, method, recipientInfo, projectId }),
    }).catch(() => {});
  };

  const versionSuffix = version ? ` (v${version})` : "";

  const shareEmail = () => {
    if (!fullUrl) return;
    const subject = encodeURIComponent(`${entityName}${versionSuffix}`);
    const body = encodeURIComponent(`Hi,\n\nPlease find "${entityName}"${versionSuffix} here:\n\n${fullUrl}`);
    window.open(`mailto:?subject=${subject}&body=${body}`);
    logShare("email");
  };

  const shareWhatsApp = () => {
    if (!fullUrl) return;
    const text = encodeURIComponent(`${entityName}${versionSuffix}\n${fullUrl}`);
    window.open(`https://wa.me/?text=${text}`, "_blank");
    logShare("whatsapp");
  };

  const shareProjectTeam = async () => {
    if (!projectId) return;
    setSending(true);
    setSentTo(null);
    const userIds = members.map(m => m.userId).filter(Boolean);
    const content = `${entityName}${versionSuffix}${fullUrl ? `\n${fullUrl}` : ""}`;
    await fetch("/api/messages/broadcast", {
      method: "POST",
      headers: authH(),
      body: JSON.stringify({
        recipientIds: userIds,
        content,
        ...(hasAttachment ? { attachmentType: entityType, attachmentId: entityId } : {}),
      }),
    }).catch(() => {});
    logShare("project_team", `All project members (${userIds.length})`);
    setSending(false);
    setSentTo("project team");
  };

  const shareIndividual = async () => {
    if (!selectedUserId) return;
    const member = members.find(m => m.userId === selectedUserId);
    if (!member) return;
    setSending(true);
    setSentTo(null);
    const content = hasAttachment ? (entityName + versionSuffix) : `${entityName}${versionSuffix}${fullUrl ? `\n${fullUrl}` : ""}`;
    await fetch("/api/messages", {
      method: "POST",
      headers: authH(),
      body: JSON.stringify({
        recipientId: selectedUserId,
        content,
        ...(hasAttachment ? { attachmentType: entityType, attachmentId: entityId } : {}),
      }),
    }).catch(() => {});
    logShare("individual", member.name);
    setSending(false);
    setSentTo(member.name);
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

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Share2 className="w-4 h-4" /> Share
        </DialogTitle>
        <p className="text-sm text-muted-foreground truncate">{entityName}{versionSuffix}</p>
      </DialogHeader>

        {/* Tabs */}
        <div className="flex border-b -mx-6 px-6">
          {(["share", "qr", "history"] as const).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setSentTo(null); }}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {t === "qr" ? "QR Code" : t === "history" ? "History" : "Share"}
            </button>
          ))}
        </div>

        {/* ── Share tab ── */}
        {tab === "share" && (
          <div className="space-y-4">
            {sentTo && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 text-sm">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Sent to {sentTo}
              </div>
            )}

            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">External</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  disabled={!fullUrl}
                  onClick={shareEmail}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-border bg-background hover:bg-muted transition-colors text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Mail className="w-4 h-4 text-blue-500" /> Email
                </button>
                <button
                  disabled={!fullUrl}
                  onClick={shareWhatsApp}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-border bg-background hover:bg-muted transition-colors text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <MessageCircle className="w-4 h-4 text-green-500" /> WhatsApp
                </button>
              </div>
            </div>

            {projectId && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">In App</p>
                <div className="space-y-2">
                  <button
                    disabled={sending || members.length === 0}
                    onClick={shareProjectTeam}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-background hover:bg-muted transition-colors text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Users className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-left">
                      <span className="block">Project Team</span>
                      <span className="text-xs text-muted-foreground font-normal">{members.length} member{members.length !== 1 ? "s" : ""}</span>
                    </span>
                    {sending && <Loader2 className="w-4 h-4 ml-auto animate-spin" />}
                  </button>

                  <div className="flex gap-2">
                    <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                      <SelectTrigger className="flex-1 text-sm h-10">
                        <SelectValue placeholder={members.length ? "Choose a team member…" : "No members"} />
                      </SelectTrigger>
                      <SelectContent>
                        {members.map(m => (
                          <SelectItem key={m.userId!} value={m.userId!}>{m.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <button
                      disabled={!selectedUserId || sending}
                      onClick={shareIndividual}
                      title="Send to individual"
                      className="px-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
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

                {canPin && (
                  <div className="w-full border-t pt-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 text-center">Site Board</p>
                    <button
                      onClick={togglePin}
                      disabled={pinLoading}
                      className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border text-sm font-medium transition-colors disabled:opacity-40 ${
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
                        <><Pin className="w-4 h-4" /> Add to Site Board</>
                      )}
                    </button>
                    <p className="text-xs text-muted-foreground text-center mt-2">
                      {isPinned
                        ? "Visible to anyone who scans the site QR code"
                        : "Pin so workers can access it by scanning the site QR code"}
                    </p>
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
