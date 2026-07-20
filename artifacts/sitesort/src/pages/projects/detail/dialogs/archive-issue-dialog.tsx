import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

// PM-only archive (soft-delete) confirmation dialog — shared by the Issues
// tab list and the photo detail overlay. Reason is optional, unlike close-as-
// invalid/duplicate; archiving is reversible via Restore, so there's no
// business need to force one.
export function ArchiveIssueDialog({ photoId, onClose, archiveIssue }: {
  photoId: string | null; onClose: () => void;
  archiveIssue: (photoId: string, reason?: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    if (!photoId) return;
    setSubmitting(true);
    try { await archiveIssue(photoId, reason.trim() || undefined); onClose(); setReason(""); }
    finally { setSubmitting(false); }
  };
  return (
    <Dialog open={!!photoId} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogHeader><DialogTitle>Archive this issue?</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">It's removed from the active list and counts, but stays on record — viewable under Archived, and can be restored any time.</p>
        <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (optional)" rows={3} />
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="destructive" onClick={submit} isLoading={submitting}>Archive issue</Button>
      </DialogFooter>
    </Dialog>
  );
}
