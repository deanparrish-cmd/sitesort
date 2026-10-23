import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ShieldAlert, ShieldCheck, IdCard } from "lucide-react";

// What the QR gate will do for someone (#164). The server works it out with the
// gate's own function (lib/gate-identity.ts), so this line can never disagree
// with the barrier. held = no card and no firm: held every time until a PM
// gives them a card. staff = let on with no insurance check. firm = the firm's
// public liability verdict, the same words as the contact card.
export type GateStanding = { kind: "firm" | "staff" | "held"; holds: boolean; text: string };

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem("sitesort_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export function GateStandingLine({ standing, onGiveCard, className }: { standing?: GateStanding | null; onGiveCard?: () => void; className?: string }) {
  if (!standing) return null;
  const tone = standing.holds ? "text-destructive" : standing.kind === "staff" ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400";
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 min-w-0", className)} data-testid="gate-standing" data-kind={standing.kind}>
      <p className={cn("flex items-start gap-1.5 text-xs font-semibold break-words min-w-0 flex-1 basis-48", tone)}>
        {standing.holds || standing.kind === "staff" ? <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-px" /> : <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-px" />}
        <span className="min-w-0">{standing.text}</span>
      </p>
      {standing.kind === "held" && onGiveCard && (
        <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={onGiveCard} data-testid="button-give-card">
          <IdCard className="w-3.5 h-3.5 mr-1" /> Give them a card
        </Button>
      )}
    </div>
  );
}

type Firm = { id: string; companyName: string; archivedAt?: string | null };

// "Give them a card": the PM decides who this person is. Our own staff (let on
// with no insurance check) or someone at a firm (the gate checks that firm's
// public liability). A positive choice either way, recorded on the project.
export function GiveCardDialog({ projectId, memberId, name, open, onClose, onDone }: {
  projectId: string; memberId: string; name: string; open: boolean; onClose: () => void; onDone: (s: GateStanding) => void;
}) {
  const [choice, setChoice] = useState<"in_house" | "firm" | "">("");
  const [firmId, setFirmId] = useState("");
  const [firms, setFirms] = useState<Firm[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setChoice(""); setFirmId(""); setErr("");
    fetch("/api/subcontractors", { headers: authHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then((rows: Firm[]) => setFirms(rows.filter(f => !f.archivedAt).sort((a, b) => a.companyName.localeCompare(b.companyName))))
      .catch(() => { setFirms([]); setErr("Couldn't load your contacts. You can still make them your own staff, or try again."); });
  }, [open]);

  const save = async () => {
    setSaving(true); setErr("");
    try {
      const r = await fetch(`/api/projects/${projectId}/members/${memberId}/card`, {
        method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(choice === "in_house" ? { inHouse: true } : { subcontractorId: firmId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.message ?? "That didn't save. Try again."); return; }
      onDone(d.gateStanding);
      onClose();
    } catch {
      setErr("That didn't save. Check your connection and try again.");
    } finally { setSaving(false); }
  };

  const ready = choice === "in_house" || (choice === "firm" && !!firmId);
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogHeader>
        <DialogTitle className="break-words">Give {name} a card</DialogTitle>
      </DialogHeader>
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">Until they have a card or a firm, the site gate holds them every time they sign in. Who are they?</p>
        <label className={cn("flex items-start gap-2 rounded-lg border p-3 cursor-pointer", choice === "in_house" && "border-primary bg-primary/5")}>
          <input type="radio" name="give-card-kind" id="give-card-in-house" className="mt-1" checked={choice === "in_house"} onChange={() => setChoice("in_house")} />
          <span className="min-w-0">
            <span className="font-semibold block">Our own staff</span>
            <span className="text-muted-foreground">Let on site as your own staff, with no insurance check.</span>
          </span>
        </label>
        <label className={cn("flex items-start gap-2 rounded-lg border p-3 cursor-pointer", choice === "firm" && "border-primary bg-primary/5")}>
          <input type="radio" name="give-card-kind" id="give-card-firm" className="mt-1" checked={choice === "firm"} onChange={() => setChoice("firm")} />
          <span className="min-w-0 flex-1 space-y-2">
            <span className="font-semibold block">At a firm</span>
            <span className="text-muted-foreground block">The gate checks that firm's public liability insurance.</span>
            {choice === "firm" && (
              <select id="give-card-firm-select" value={firmId} onChange={e => setFirmId(e.target.value)} aria-label="Which firm"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm min-w-0">
                <option value="" disabled>{firms === null ? "Loading contacts" : firms.length ? "Choose the firm" : "No firms in your contacts"}</option>
                {(firms ?? []).map(f => <option key={f.id} value={f.id}>{f.companyName}</option>)}
              </select>
            )}
          </span>
        </label>
        {err && <p className="text-destructive text-sm">{err}</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Not now</Button>
        <Button onClick={save} disabled={!ready} isLoading={saving} data-testid="button-give-card-save">Give them the card</Button>
      </DialogFooter>
    </Dialog>
  );
}
