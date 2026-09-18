import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/list-row";
import { AlertTriangle, Building2, Clock, LogOut, UserCheck, Users, X } from "lucide-react";

export const CHECKIN_NOTIFICATION_TYPES = ["check_in", "check_in_blocked", "check_out"];

type Detail = {
  kind: "check_in" | "check_out" | "blocked";
  project: { id: string; name: string };
  at: string;
  fallback?: { workerName: string | null; companyName: string | null };
  checkin?: {
    id: string; workerName: string; companyName: string | null; photoUrl: string;
    checkedInAt: string; checkedOutAt: string | null; checkoutMethod: string | null; checkoutNote: string | null;
    onSite: boolean; notSignedOut: boolean;
  } | null;
  attempt?: { workerName: string | null; companyName: string | null; reason: string; reasonText: string };
};

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
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

  useEffect(() => {
    setDetail(null); setError(false);
    const t = localStorage.getItem("sitesort_token");
    fetch(`/api/notifications/${notificationId}/checkin`, { headers: t ? { Authorization: `Bearer ${t}` } : {} })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setDetail)
      .catch(() => setError(true));
  }, [notificationId]);

  const ci = detail?.checkin;
  const name = ci?.workerName ?? detail?.attempt?.workerName ?? detail?.fallback?.workerName ?? "Unknown";
  const company = ci?.companyName ?? detail?.attempt?.companyName ?? detail?.fallback?.companyName ?? null;

  return (
    <>
      <Dialog open onOpenChange={v => { if (!v) onClose(); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {detail?.kind === "blocked" ? <AlertTriangle className="w-5 h-5 text-destructive shrink-0" /> : detail?.kind === "check_out" ? <LogOut className="w-5 h-5 text-muted-foreground shrink-0" /> : <UserCheck className="w-5 h-5 text-green-600 shrink-0" />}
            <span className="break-words">
              {detail?.kind === "blocked" ? "Check-in blocked" : detail?.kind === "check_out" ? "Signed out" : "Check-in"}
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

            {detail.kind === "blocked" && detail.attempt ? (
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
                <dd className="font-medium" data-testid="text-checked-in">{fmtDay(ci.checkedInAt)} at {fmtTime(ci.checkedInAt)}</dd>
                <dt className="text-muted-foreground">Signed out</dt>
                <dd className="font-medium" data-testid="text-signed-out">
                  {ci.checkedOutAt ? (
                    <>{fmtTime(ci.checkedOutAt)}{ci.checkoutMethod === "manual" ? " (by a manager" + (ci.checkoutNote ? `: ${ci.checkoutNote}` : "") + ")" : ""}</>
                  ) : (
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <Pill className={ci.notSignedOut ? "bg-destructive text-destructive-foreground" : "bg-green-100 text-green-800"}>{ci.notSignedOut ? "Not signed out" : "Still on site"}</Pill>
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
