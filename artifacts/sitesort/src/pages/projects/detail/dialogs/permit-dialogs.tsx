import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MapPin, Calendar, Upload, FileText, CheckCircle2, AlertTriangle, ShieldCheck, Eye, EyeOff, Users, Search, X, Phone, Mail, HardHat, UserCheck, Clock, Pencil, Camera, FolderOpen, ChevronDown, ChevronUp, ChevronRight, QrCode, Download, Printer, RefreshCw, ArrowDownCircle, ArrowUpCircle, Receipt, ClipboardCheck, UserPlus, ExternalLink, Share2, MessageCircle, FileDown, Plus, Trash2, Flag, Pin, PinOff, StickyNote, Send, Loader2, History, Archive, Paperclip } from "lucide-react";
import { FileDropZone } from "@/components/ui/file-drop-zone";
import { useDetail } from "../context";
import { PERMIT_TYPES } from "../use-project-detail";

export function PermitDialogs() {
  const {
    members,
    permits,
    permitAddOpen,
    setPermitAddOpen,
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
    newPermitError,
    setNewPermitError,
    editingPermit,
    setEditingPermit,
    editPermitSubmitting,
    editPermitError,
    setEditPermitError,
    submitNewPermit,
    submitEditPermit,
  } = useDetail();

  return (
    <>
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
          <div className="grid grid-cols-2 gap-4 [&>*]:min-w-0">
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
            <label className="text-sm font-semibold mb-1.5 block">Action due by <span className="text-muted-foreground font-normal">(optional)</span></label>
            <Input type="date" value={newPermitDue} onChange={e => setNewPermitDue(e.target.value)} icon={<Calendar className="w-4 h-4" />} />
            <p className="text-xs text-muted-foreground mt-1">When the responsible person must renew or action this — separate from the legal expiry date.</p>
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

      {/* Edit / reassign permit (F1 Phase 2) — wires PATCH /api/permits/:id */}
      <Dialog open={!!editingPermit} onOpenChange={v => { if (!v) { setEditingPermit(null); setEditPermitError(null); } }}>
        <DialogHeader>
          <DialogTitle>Edit Permit / Certification</DialogTitle>
        </DialogHeader>
        {editingPermit && (
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-sm font-semibold mb-1.5 block">Description / Reference</label>
              <Input
                value={editingPermit.description}
                onChange={e => setEditingPermit(prev => prev && { ...prev, description: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-semibold mb-1.5 block">Responsible Person</label>
              <select
                value={editingPermit.responsibleUserId ?? ""}
                onChange={e => setEditingPermit(prev => prev && { ...prev, responsibleUserId: e.target.value })}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Select person…</option>
                {(members as any[] ?? []).filter((m: any) => !!m.userId).map((m: any) => (
                  <option key={m.id} value={m.userId}>{m.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4 [&>*]:min-w-0">
              <div>
                <label className="text-sm font-semibold mb-1.5 block">Expiry Date</label>
                <Input type="date" value={editingPermit.expiryDate?.slice(0, 10) ?? ""} onChange={e => setEditingPermit(prev => prev && { ...prev, expiryDate: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-semibold mb-1.5 block">Action due by</label>
                <Input type="date" value={editingPermit.dueDate?.slice(0, 10) ?? ""} onChange={e => setEditingPermit(prev => prev && { ...prev, dueDate: e.target.value })} icon={<Calendar className="w-4 h-4" />} />
              </div>
            </div>
            {editPermitError && (
              <p className="flex items-center gap-1.5 text-sm text-destructive"><AlertTriangle className="w-4 h-4 shrink-0" />{editPermitError}</p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setEditingPermit(null)}>Cancel</Button>
          <Button variant="accent" onClick={submitEditPermit} disabled={editPermitSubmitting}>
            {editPermitSubmitting ? "Saving…" : "Save Changes"}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
