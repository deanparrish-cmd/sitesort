import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ListRow, Pill } from "@/components/ui/list-row";
import { useToast } from "@/hooks/use-toast";
import { Users, LogOut, AlertTriangle } from "lucide-react";

export type RegisterCheckin = {
  id: string;
  projectId?: string;
  projectName?: string;
  workerName: string;
  companyName?: string | null;
  checkedInAt: string;
  checkedOutAt?: string | null;
  onSite?: boolean;
  notSignedOut?: boolean;
};

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem("sitesort_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

const when = (iso: string) => {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString()
    ? `today ${time}`
    : `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} ${time}`;
};

/**
 * Live "who is on site right now" register (emergency roll-call). A person is
 * on site when their latest in/out cycle has no sign-out. Cycles left open from a
 * previous day are flagged "Not signed out" and are NEVER auto-closed: a manager
 * closes them with a note.
 */
export function OnSiteRegister({
  checkins,
  canSignOut,
  onChanged,
  showProject = false,
}: {
  checkins: RegisterCheckin[];
  canSignOut: boolean;
  onChanged: () => void;
  showProject?: boolean;
}) {
  const { toast } = useToast();
  const [target, setTarget] = useState<RegisterCheckin | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const onSite = checkins
    .filter(c => c.onSite ?? !c.checkedOutAt)
    // Not-signed-out flags first, then longest on site first.
    .sort((a, b) => Number(!!b.notSignedOut) - Number(!!a.notSignedOut) || a.checkedInAt.localeCompare(b.checkedInAt));
  const flagged = onSite.filter(c => c.notSignedOut).length;

  const submit = async () => {
    if (!target?.projectId || !note.trim()) return;
    setSaving(true);
    const res = await fetch(`/api/projects/${target.projectId}/checkins/${target.id}/sign-out`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ note: note.trim() }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      toast({ title: "Couldn't sign out", description: "They may already be signed out.", variant: "destructive" });
      return;
    }
    toast({ title: `${target.workerName} signed out` });
    setTarget(null);
    setNote("");
    onChanged();
  };

  return (
    <Card className="p-4 mb-6" data-testid="card-on-site-register">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Users className="w-4 h-4 text-primary" />
        <h3 className="font-bold text-sm">Currently on site</h3>
        <span className="text-sm font-semibold" data-testid="text-on-site-count">{onSite.length}</span>
        {flagged > 0 && (
          <span className="inline-flex items-center gap-1 text-xs font-bold text-destructive">
            <AlertTriangle className="w-3.5 h-3.5" />{flagged} not signed out
          </span>
        )}
      </div>
      {onSite.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody is signed in on site right now.</p>
      ) : (
        <div className="space-y-2">
          {onSite.map(c => (
            <ListRow
              key={c.id}
              content={<>
                <p className="font-semibold text-sm break-words">{c.workerName}</p>
                <p className="text-xs text-muted-foreground break-words">
                  {[c.companyName, showProject ? c.projectName : null].filter(Boolean).join(" · ")}
                  {(c.companyName || (showProject && c.projectName)) ? " · " : ""}in {when(c.checkedInAt)}
                </p>
              </>}
              actions={<>
                {c.notSignedOut
                  ? <Pill className="bg-destructive text-destructive-foreground border-destructive font-bold">Not signed out</Pill>
                  : <Pill className="bg-green-100 text-green-800 border-green-300">On site</Pill>}
                {canSignOut && (
                  <button
                    type="button"
                    onClick={() => { setTarget(c); setNote(""); }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-background text-xs font-medium hover:bg-muted transition-colors"
                    data-testid={`button-manual-sign-out-${c.id}`}
                  >
                    <LogOut className="w-3.5 h-3.5" />Sign out
                  </button>
                )}
              </>}
            />
          ))}
        </div>
      )}

      <Dialog open={!!target} onOpenChange={v => { if (!v && !saving) setTarget(null); }}>
        <DialogHeader>
          <DialogTitle>Sign out {target?.workerName}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground mb-3">
          Signed in {target ? when(target.checkedInAt) : ""}. The sign-out time is recorded as now, with your note.
        </p>
        <Textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Reason, e.g. left site at 17:00, forgot to sign out"
          rows={3}
          data-testid="input-sign-out-note"
        />
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => setTarget(null)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !note.trim()} data-testid="button-confirm-sign-out">
            {saving ? "Signing out…" : "Sign out"}
          </Button>
        </DialogFooter>
      </Dialog>
    </Card>
  );
}
