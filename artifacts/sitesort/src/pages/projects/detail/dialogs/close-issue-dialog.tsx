import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// PM-only "close as invalid/duplicate" reason dialog — shared by the Issues
// tab list and the photo detail overlay.
export function CloseInvalidDialog({ photoId, onClose, closeIssueAsInvalid }: {
  photoId: string | null; onClose: () => void;
  closeIssueAsInvalid: (photoId: string, reason: "invalid" | "duplicate", note: string) => Promise<void>;
}) {
  const [reason, setReason] = useState<"invalid" | "duplicate">("invalid");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    if (!photoId || !note.trim()) return;
    setSubmitting(true);
    try { await closeIssueAsInvalid(photoId, reason, note.trim()); onClose(); setNote(""); }
    finally { setSubmitting(false); }
  };
  return (
    <Dialog open={!!photoId} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogHeader><DialogTitle>Close as invalid/duplicate</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div className="flex gap-2">
          <button type="button" onClick={() => setReason("invalid")} className={cn("text-xs px-3 py-1.5 rounded-full border font-semibold", reason === "invalid" ? "bg-primary/10 border-primary text-primary" : "border-border text-muted-foreground")}>Invalid</button>
          <button type="button" onClick={() => setReason("duplicate")} className={cn("text-xs px-3 py-1.5 rounded-full border font-semibold", reason === "duplicate" ? "bg-primary/10 border-primary text-primary" : "border-border text-muted-foreground")}>Duplicate</button>
        </div>
        <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Reason (required)" rows={3} />
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!note.trim()} isLoading={submitting}>Close issue</Button>
      </DialogFooter>
    </Dialog>
  );
}
