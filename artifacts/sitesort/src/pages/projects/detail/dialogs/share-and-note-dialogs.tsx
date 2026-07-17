import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { MapPin, Calendar, Upload, FileText, CheckCircle2, AlertTriangle, ShieldCheck, Eye, EyeOff, Users, Search, X, Phone, Mail, HardHat, UserCheck, Clock, Pencil, Camera, FolderOpen, ChevronDown, ChevronUp, ChevronRight, QrCode, Download, Printer, RefreshCw, ArrowDownCircle, ArrowUpCircle, Receipt, ClipboardCheck, UserPlus, ExternalLink, Share2, MessageCircle, FileDown, Plus, Trash2, Flag, Pin, PinOff, StickyNote, Send, Loader2, History, Archive, Paperclip } from "lucide-react";
import { ShareModal } from "@/components/share-modal";
import { formatDate, formatBytes, cn } from "@/lib/utils";
import { useDetail } from "../context";

export function ShareAndNoteDialogs() {
  const {
    projectId,
    openingNote,
    setOpeningNote,
    sharingNote,
    setSharingNote,
    sharingDoc,
    setSharingDoc,
    sharingContact,
    setSharingContact,
    sharingInvoice,
    setSharingInvoice,
  } = useDetail();

  return (
    <>
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

      {/* Note detail dialog */}
      <Dialog open={!!openingNote} onOpenChange={v => { if (!v) setOpeningNote(null); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-4 h-4" /> Site Update
          </DialogTitle>
          {openingNote && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {openingNote.authorName} · {formatDate(openingNote.createdAt)}
            </p>
          )}
        </DialogHeader>
        {openingNote && (
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <p className="text-sm text-foreground whitespace-pre-wrap">{openingNote.body}</p>
            {openingNote.photoUrl && (
              <img
                src={openingNote.photoUrl.replace(/^\/uploads\//, "/api/uploads/")}
                alt="Update attachment"
                className="rounded-md border max-h-80 w-full object-contain bg-background"
              />
            )}
          </div>
        )}
        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (openingNote) navigator.clipboard.writeText(openingNote.body).catch(() => {});
            }}
          >
            Copy text
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setSharingNote(openingNote); setOpeningNote(null); }}
            >
              <Share2 className="w-3.5 h-3.5 mr-1.5" /> Share
            </Button>
            <Button size="sm" onClick={() => setOpeningNote(null)}>Done</Button>
          </div>
        </DialogFooter>
      </Dialog>

      {/* Note share modal */}
      <ShareModal
        open={!!sharingNote}
        onClose={() => setSharingNote(null)}
        entityType="daily_note"
        entityId={sharingNote?.id ?? ""}
        entityName={`Site update — ${sharingNote?.authorName ?? ""}`}
        fileUrl={null}
        projectId={projectId}
        shareText={sharingNote?.body ?? null}
      />

      <ShareModal
        open={!!sharingContact}
        onClose={() => setSharingContact(null)}
        entityType="contact"
        entityId={sharingContact?.id ?? ""}
        entityName={sharingContact?.name ?? ""}
        fileUrl={null}
        projectId={projectId}
        shareText={sharingContact?.text ?? null}
      />

      <ShareModal
        open={!!sharingInvoice}
        onClose={() => setSharingInvoice(null)}
        entityType="invoice"
        entityId={sharingInvoice?.id ?? ""}
        entityName={`Invoice — ${sharingInvoice?.counterpartyName ?? ""}`}
        fileUrl={sharingInvoice?.attachmentUrl ?? null}
        projectId={projectId}
      />
    </>
  );
}
