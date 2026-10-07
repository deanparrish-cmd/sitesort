import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ListRow, Pill } from "@/components/ui/list-row";
import { useToast } from "@/hooks/use-toast";
import { Users, LogOut, AlertTriangle, ShieldAlert, Check, X, Clock } from "lucide-react";
import { fmtSiteTime, fmtSiteDate, siteDayKey, siteTzLabel } from "@/lib/site-time";

export type Presence = "held" | "on_site" | "auto_closed_today" | "auto_closed" | "signed_out" | "none";

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
  personKey?: string | null;
  presence?: Presence;
  autoClosedAt?: string | null;
  holdReason?: string | null;
  holdStatus?: string | null;
  siteTimeZone?: string;
};

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem("sitesort_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// "today 07:45 UK time" / "Tue 7 Oct 07:45 UK time", on the site's own clock.
const when = (iso: string, tz?: string) => {
  const time = `${fmtSiteTime(iso, tz)} ${siteTzLabel(tz, new Date(iso))}`;
  return siteDayKey(iso, tz) === siteDayKey(new Date(), tz) ? `today ${time}` : `${fmtSiteDate(iso, tz)} ${time}`;
};

// Older API responses (no `presence`) fall back to the old open/closed rule.
const presenceOf = (c: RegisterCheckin): Presence =>
  c.presence ?? (c.checkedOutAt ? "signed_out" : c.notSignedOut ? "auto_closed" : "on_site");

export const holdReasonText = (r?: string | null) =>
  r === "insurance_expired" ? "Insurance expired" : "No insurance on file";

// One line of status for a check-in card, on the site clock.
export function checkinStatusLine(ci: {
  checkedOutAt?: string | null; checkoutMethod?: string | null; notSignedOut?: boolean; presence?: Presence;
  holdReason?: string | null; holdStatus?: string | null; autoClosedAt?: string | null; siteTimeZone?: string;
}): string {
  const tz = ci.siteTimeZone;
  if (ci.holdStatus === "pending") return ` · Waiting at the gate (${holdReasonText(ci.holdReason).toLowerCase()})`;
  if (ci.holdStatus === "refused") return ` · Refused (${holdReasonText(ci.holdReason).toLowerCase()})`;
  if (ci.holdStatus === "lapsed") return " · Not let on site (no decision)";
  const approved = ci.holdStatus === "approved" ? " · Let on site by a manager" : "";
  if (ci.checkedOutAt) return `${approved} · Out ${fmtSiteTime(ci.checkedOutAt, tz)}${ci.checkoutMethod === "manual" ? " (by manager)" : ""}`;
  if (ci.autoClosedAt || ci.presence === "auto_closed" || ci.presence === "auto_closed_today") return `${approved} · Closed automatically${ci.autoClosedAt ? ` ${fmtSiteTime(ci.autoClosedAt, tz)}` : ""}, not signed out`;
  if (ci.notSignedOut) return `${approved} · Not signed out`;
  return `${approved} · On site`;
}

/**
 * The live register and emergency roll-call. Shows, per person:
 *  - Waiting at the gate: insurance check failed, an admin / PM approves (with a
 *    reason) or refuses. Not counted as on site until approved.
 *  - On site: signed in and not signed out (counted).
 *  - Closed automatically today: never signed out by the site close time. NOT
 *    counted, but still listed, clearly marked, so a man working late never
 *    drops off the roll-call. Auto-close fixes the count, not the record.
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
  const [decide, setDecide] = useState<{ row: RegisterCheckin; decision: "approve" | "refuse" } | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // One row per PERSON: several rows for the same registered person (or the same
  // name + company, for older rows) collapse to their latest, so the roll-call
  // never lists one human twice.
  const onePerPerson = (list: RegisterCheckin[]) => {
    const seen = new Set<string>();
    return list
      .sort((a, b) => b.checkedInAt.localeCompare(a.checkedInAt))
      .filter(c => {
        const k = c.personKey ?? `${c.workerName.trim().toLowerCase().replace(/\s+/g, " ")}|${(c.companyName ?? "").trim().toLowerCase().replace(/\s+/g, " ")}|${c.projectId ?? ""}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
  };
  const roll = onePerPerson(checkins.filter(c => ["on_site", "auto_closed_today"].includes(presenceOf(c))))
    // Auto-closed first (they need checking), then longest on site first.
    .sort((a, b) => Number(presenceOf(b) === "auto_closed_today") - Number(presenceOf(a) === "auto_closed_today") || a.checkedInAt.localeCompare(b.checkedInAt));
  const onSiteCount = roll.filter(c => presenceOf(c) === "on_site").length;
  const autoClosed = roll.length - onSiteCount;
  const held = onePerPerson(checkins.filter(c => presenceOf(c) === "held"));

  const label = (c: RegisterCheckin) => [c.companyName, showProject ? c.projectName : null].filter(Boolean).join(" · ");

  const submitSignOut = async () => {
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

  const submitDecision = async () => {
    if (!decide?.row.projectId) return;
    if (decide.decision === "approve" && !note.trim()) return;
    setSaving(true);
    const res = await fetch(`/api/projects/${decide.row.projectId}/checkins/${decide.row.id}/hold-decision`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ decision: decide.decision, note: note.trim() }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const msg = await res?.json().then((b: { message?: string }) => b?.message).catch(() => undefined);
      toast({ title: "Couldn't save the decision", description: msg ?? "It may already have been decided.", variant: "destructive" });
      return;
    }
    toast({ title: decide.decision === "approve" ? `${decide.row.workerName} let on site` : `${decide.row.workerName} refused` });
    setDecide(null);
    setNote("");
    onChanged();
  };

  return (
    <Card className="p-4 mb-6" data-testid="card-on-site-register">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Users className="w-4 h-4 text-primary" />
        <h3 className="font-bold text-sm">Currently on site</h3>
        <span className="text-sm font-semibold" data-testid="text-on-site-count">{onSiteCount}</span>
        {autoClosed > 0 && (
          <span className="inline-flex items-center gap-1 text-xs font-bold text-destructive" data-testid="text-auto-closed-count">
            <AlertTriangle className="w-3.5 h-3.5" />{autoClosed} not signed out
          </span>
        )}
        {held.length > 0 && (
          <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700" data-testid="text-held-count">
            <ShieldAlert className="w-3.5 h-3.5" />{held.length} waiting at the gate
          </span>
        )}
      </div>

      {held.length > 0 && (
        <div className="mb-4 space-y-2" data-testid="section-held">
          <p className="text-xs font-semibold text-amber-800">Waiting at the gate: insurance check failed. They are not on site until approved.</p>
          {held.map(c => (
            <ListRow
              key={c.id}
              className="border-amber-300 bg-amber-50"
              content={<>
                <p className="font-semibold text-sm break-words">{c.workerName}</p>
                <p className="text-xs text-muted-foreground break-words">
                  {label(c)}{label(c) ? " · " : ""}arrived {when(c.checkedInAt, c.siteTimeZone)}
                </p>
              </>}
              actions={<>
                <Pill className="bg-amber-600 text-white border-amber-600 font-bold">{holdReasonText(c.holdReason)}</Pill>
                {canSignOut && (<>
                  <button type="button" onClick={() => { setDecide({ row: c, decision: "approve" }); setNote(""); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-green-600 bg-background text-xs font-semibold text-green-700 hover:bg-green-50" data-testid={`button-approve-hold-${c.id}`}>
                    <Check className="w-3.5 h-3.5" />Let on site
                  </button>
                  <button type="button" onClick={() => { setDecide({ row: c, decision: "refuse" }); setNote(""); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-background text-xs font-medium hover:bg-muted" data-testid={`button-refuse-hold-${c.id}`}>
                    <X className="w-3.5 h-3.5" />Refuse
                  </button>
                </>)}
              </>}
            />
          ))}
        </div>
      )}

      {autoClosed > 0 && (
        <p className="text-xs text-muted-foreground mb-2" data-testid="text-auto-closed-help">
          Anyone marked "Closed automatically" didn't sign out by the site close time. They no longer count as on site but stay listed here for today. Check they have left, then sign them out.
        </p>
      )}

      {roll.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody is signed in on site right now.</p>
      ) : (
        <div className="space-y-2">
          {roll.map(c => {
            const auto = presenceOf(c) === "auto_closed_today";
            return (
              <ListRow
                key={c.id}
                content={<>
                  <p className="font-semibold text-sm break-words">{c.workerName}</p>
                  <p className="text-xs text-muted-foreground break-words">
                    {label(c)}{label(c) ? " · " : ""}in {when(c.checkedInAt, c.siteTimeZone)}
                    {auto && c.autoClosedAt ? ` · closed automatically ${fmtSiteTime(c.autoClosedAt, c.siteTimeZone)}` : ""}
                  </p>
                </>}
                actions={<>
                  {auto
                    ? <Pill className="bg-destructive text-destructive-foreground border-destructive font-bold">Closed automatically, not signed out</Pill>
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
            );
          })}
        </div>
      )}

      <Dialog open={!!target} onOpenChange={v => { if (!v && !saving) setTarget(null); }}>
        <DialogHeader>
          <DialogTitle className="break-words">Sign out {target?.workerName}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground mb-3">
          Signed in {target ? when(target.checkedInAt, target.siteTimeZone) : ""}. The sign-out time is recorded as now, with your note.
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
          <Button onClick={submitSignOut} disabled={saving || !note.trim()} data-testid="button-confirm-sign-out">
            {saving ? "Signing out…" : "Sign out"}
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={!!decide} onOpenChange={v => { if (!v && !saving) setDecide(null); }}>
        <DialogHeader>
          <DialogTitle className="break-words">
            {decide?.decision === "approve" ? `Let ${decide.row.workerName} on site?` : `Refuse ${decide?.row.workerName}?`}
          </DialogTitle>
        </DialogHeader>
        {decide && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground flex items-start gap-1.5">
              <Clock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{holdReasonText(decide.row.holdReason)}. Arrived {when(decide.row.checkedInAt, decide.row.siteTimeZone)}.</span>
            </p>
            {decide.decision === "approve" && (
              <p className="text-sm">You are letting them on site without valid insurance on file. Your name, the time and your reason are recorded.</p>
            )}
            <Textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={decide.decision === "approve" ? "Reason (required), e.g. cert seen on his phone, upload promised today" : "Note (optional)"}
              rows={3}
              data-testid="input-hold-note"
            />
          </div>
        )}
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => setDecide(null)} disabled={saving}>Cancel</Button>
          <Button
            onClick={submitDecision}
            disabled={saving || (decide?.decision === "approve" && !note.trim())}
            variant={decide?.decision === "refuse" ? "destructive" : "default"}
            data-testid="button-confirm-hold-decision"
          >
            {saving ? "Saving…" : decide?.decision === "approve" ? "Let on site" : "Refuse"}
          </Button>
        </DialogFooter>
      </Dialog>
    </Card>
  );
}
