import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/list-row";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Building2, Check, Clock, LogOut, ShieldAlert, UserCheck, Users, X } from "lucide-react";
import { fmtSiteTime, fmtSiteDate, siteTzLabel } from "@/lib/site-time";
import { holdReasonText, checkinStatusLine, type Presence } from "@/components/on-site-register";

export const CHECKIN_NOTIFICATION_TYPES = ["check_in", "check_in_blocked", "check_out", "check_in_held", "check_in_auto_closed"];

type DetailCheckin = {
  id: string; workerName: string; companyName: string | null; photoUrl: string;
  checkedInAt: string; checkedOutAt: string | null; checkoutMethod: string | null; checkoutNote: string | null;
  onSite: boolean; notSignedOut: boolean; presence?: Presence; autoClosedAt?: string | null; siteTimeZone?: string;
  holdReason?: string | null; holdStatus?: string | null; holdNote?: string | null; holdDecidedAt?: string | null; holdDecidedByName?: string | null;
};

type Detail = {
  kind: "check_in" | "check_out" | "blocked" | "held" | "auto_closed";
  project: { id: string; name: string };
  at: string;
  fallback?: { workerName: string | null; companyName: string | null };
  checkin?: DetailCheckin | null;
  rows?: DetailCheckin[];
  canDecide?: boolean;
  attempt?: { workerName: string | null; companyName: string | null; reason: string; reasonText: string };
};

// On the site's clock (project timezone), labelled, never the viewer's device clock.
const fmtTime = (iso: string, tz?: string) => `${fmtSiteTime(iso, tz)} ${siteTzLabel(tz, new Date(iso))}`;
const fmtDay = (iso: string, tz?: string) => fmtSiteDate(iso, tz, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const normUrl = (u: string) => u.replace(/^\/uploads\//, "/api/uploads/");

/**
 * Detail behind a check-in / check-in-blocked / sign-out notification: photo
 * (tap to enlarge), name, company, in and out times, and a link to the project's
 * Currently on site register. Opened from the dashboard activity feed and the
 * Notifications page.
 */
export function CheckinNotificationDialog({ notificationId, onClose }: { notificationId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const [decision, setDecision] = useState<"approve" | "refuse" | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const load = () => {
    setError(false);
    const t = localStorage.getItem("sitesort_token");
    fetch(`/api/notifications/${notificationId}/checkin`, { headers: t ? { Authorization: `Bearer ${t}` } : {} })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setDetail)
      .catch(() => setError(true));
  };
  useEffect(() => { setDetail(null); load(); }, [notificationId]);

  const decide = async () => {
    const ci = detail?.checkin;
    if (!detail || !ci || !decision) return;
    if (decision === "approve" && !note.trim()) return;
    setSaving(true);
    const t = localStorage.getItem("sitesort_token");
    const res = await fetch(`/api/projects/${detail.project.id}/checkins/${ci.id}/hold-decision`, {
      method: "POST",
      headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}), "Content-Type": "application/json" },
      body: JSON.stringify({ decision, note: note.trim() }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const msg = await res?.json().then((b: { message?: string }) => b?.message).catch(() => undefined);
      toast({ title: "Couldn't save the decision", description: msg ?? "It may already have been decided.", variant: "destructive" });
      load();
      return;
    }
    toast({ title: decision === "approve" ? `${ci.workerName} let on site` : `${ci.workerName} refused` });
    setDecision(null);
    setNote("");
    load();
  };

  const ci = detail?.checkin;
  const name = ci?.workerName ?? detail?.attempt?.workerName ?? detail?.fallback?.workerName ?? "Unknown";
  const company = ci?.companyName ?? detail?.attempt?.companyName ?? detail?.fallback?.companyName ?? null;

  return (
    <>
      <Dialog open onOpenChange={v => { if (!v) onClose(); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {detail?.kind === "blocked" || detail?.kind === "auto_closed" ? <AlertTriangle className="w-5 h-5 text-destructive shrink-0" /> : detail?.kind === "held" ? <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" /> : detail?.kind === "check_out" ? <LogOut className="w-5 h-5 text-muted-foreground shrink-0" /> : <UserCheck className="w-5 h-5 text-green-600 shrink-0" />}
            <span className="break-words">
              {detail?.kind === "blocked" ? "Check-in blocked" : detail?.kind === "held" ? "Waiting at the gate" : detail?.kind === "auto_closed" ? "Not signed out" : detail?.kind === "check_out" ? "Signed out" : "Check-in"}
              {detail ? ` at ${detail.project.name}` : ""}
            </span>
          </DialogTitle>
        </DialogHeader>

        {error ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Couldn't load this check-in. It may have been removed.</p>
        ) : !detail ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
        ) : (
          <div className="space-y-4" data-testid="checkin-detail">
            {ci?.photoUrl && (
              <button type="button" onClick={() => setEnlarged(true)} className="block w-full rounded-xl overflow-hidden border bg-muted" aria-label="Enlarge check-in photo" data-testid="button-enlarge-checkin-photo">
                <img src={normUrl(ci.photoUrl)} alt={`Check-in photo of ${name}`} className="w-full max-h-72 object-contain" />
              </button>
            )}

            <div className="space-y-1">
              <p className="font-bold text-base break-words" data-testid="text-checkin-name">{name}</p>
              {company && <p className="text-sm text-muted-foreground flex items-center gap-1.5 break-words"><Building2 className="w-3.5 h-3.5 shrink-0" />{company}</p>}
            </div>

            {detail.kind === "auto_closed" ? (
              <div className="space-y-2" data-testid="auto-closed-detail">
                <p className="text-sm">These people didn't sign out by the site close time. They no longer count as on site but stay on today's register, marked, until signed out.</p>
                {(detail.rows ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">They have all been signed out since.</p>
                ) : (detail.rows ?? []).map(r => (
                  <div key={r.id} className="rounded-lg border px-3 py-2">
                    <p className="text-sm font-semibold break-words">{r.workerName}</p>
                    <p className="text-xs text-muted-foreground break-words">{r.companyName ? `${r.companyName} · ` : ""}in {fmtDay(r.checkedInAt, r.siteTimeZone)} {fmtTime(r.checkedInAt, r.siteTimeZone)}{checkinStatusLine(r)}</p>
                  </div>
                ))}
              </div>
            ) : detail.kind === "held" && ci ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2" data-testid="held-detail">
                <p className="text-sm font-semibold text-amber-900">{holdReasonText(ci.holdReason)}</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Clock className="w-3 h-3" />Arrived {fmtDay(ci.checkedInAt, ci.siteTimeZone)} at {fmtTime(ci.checkedInAt, ci.siteTimeZone)}</p>
                {ci.holdStatus === "pending" ? (
                  detail.canDecide ? (
                    decision ? (
                      <div className="space-y-2">
                        {decision === "approve" && <p className="text-sm">You are letting them on site without valid insurance on file. Your name, the time and your reason are recorded.</p>}
                        <Textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder={decision === "approve" ? "Reason (required), e.g. cert seen on his phone, upload promised today" : "Note (optional)"} data-testid="input-hold-note" />
                        <div className="flex flex-wrap gap-2 justify-end">
                          <Button variant="outline" size="sm" onClick={() => { setDecision(null); setNote(""); }} disabled={saving}>Cancel</Button>
                          <Button size="sm" variant={decision === "refuse" ? "destructive" : "default"} onClick={decide} disabled={saving || (decision === "approve" && !note.trim())} data-testid="button-confirm-hold-decision">
                            {saving ? "Saving…" : decision === "approve" ? "Let on site" : "Refuse"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => setDecision("approve")} data-testid="button-approve-hold"><Check className="w-4 h-4 mr-1.5" />Let on site</Button>
                        <Button size="sm" variant="outline" onClick={() => setDecision("refuse")} data-testid="button-refuse-hold"><X className="w-4 h-4 mr-1.5" />Refuse</Button>
                      </div>
                    )
                  ) : (
                    <p className="text-xs text-muted-foreground">Waiting for an admin or project manager to decide.</p>
                  )
                ) : (
                  <p className="text-sm" data-testid="text-hold-decided">
                    {ci.holdStatus === "approved" ? "Let on site" : ci.holdStatus === "refused" ? "Refused" : "Not let on site: nobody decided before the site close time"}
                    {ci.holdDecidedByName ? ` by ${ci.holdDecidedByName}` : ""}
                    {ci.holdDecidedAt ? ` at ${fmtTime(ci.holdDecidedAt, ci.siteTimeZone)}` : ""}
                    {ci.holdNote ? `: ${ci.holdNote}` : ""}
                  </p>
                )}
              </div>
            ) : detail.kind === "blocked" && detail.attempt ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 space-y-1.5" data-testid="blocked-detail">
                <p className="text-sm font-semibold text-destructive">Why it was blocked</p>
                <p className="text-sm">{detail.attempt.reasonText}</p>
                <p className="text-xs text-muted-foreground">They entered: <strong>{detail.attempt.workerName}</strong> / <strong>{detail.attempt.companyName}</strong></p>
                <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Clock className="w-3 h-3" />Attempted {fmtDay(detail.at)} at {fmtTime(detail.at)}</p>
                {detail.attempt.reason === "not_registered" && (
                  <p className="text-xs text-muted-foreground">If this is a real worker, check the spelling against their contact card or add them to the project.</p>
                )}
              </div>
            ) : ci ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Checked in</dt>
                <dd className="font-medium" data-testid="text-checked-in">{fmtDay(ci.checkedInAt, ci.siteTimeZone)} at {fmtTime(ci.checkedInAt, ci.siteTimeZone)}</dd>
                <dt className="text-muted-foreground">Signed out</dt>
                <dd className="font-medium" data-testid="text-signed-out">
                  {ci.checkedOutAt ? (
                    <>{fmtTime(ci.checkedOutAt, ci.siteTimeZone)}{ci.checkoutMethod === "manual" ? " (by a manager" + (ci.checkoutNote ? `: ${ci.checkoutNote}` : "") + ")" : ""}</>
                  ) : (
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <Pill className={ci.notSignedOut ? "bg-destructive text-destructive-foreground" : "bg-green-100 text-green-800"}>{ci.notSignedOut ? (ci.autoClosedAt ? "Closed automatically, not signed out" : "Not signed out") : "Still on site"}</Pill>
                    </span>
                  )}
                </dd>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">The full check-in record couldn't be found, so only the details from the notification are shown.</p>
            )}
          </div>
        )}

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={onClose}>Close</Button>
          {detail && (
            <Link href={`/projects/${detail.project.id}?tab=checkins`} onClick={onClose}>
              <Button variant="accent" data-testid="link-on-site-register"><Users className="w-4 h-4 mr-1.5" />Currently on site</Button>
            </Link>
          )}
        </DialogFooter>
      </Dialog>

      {enlarged && ci?.photoUrl && (
        <div className="fixed inset-0 z-[80] bg-black/85 flex items-center justify-center p-3" onClick={() => setEnlarged(false)} data-testid="photo-lightbox">
          <button type="button" className="absolute top-4 right-4 rounded-full bg-white/90 p-2" aria-label="Close photo"><X className="w-5 h-5" /></button>
          <img src={normUrl(ci.photoUrl)} alt={`Check-in photo of ${name}`} className="max-w-full max-h-full object-contain" />
        </div>
      )}
    </>
  );
}
