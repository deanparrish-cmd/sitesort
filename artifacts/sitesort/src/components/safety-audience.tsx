import { useEffect, useState } from "react";

// A current safety document goes to everyone on the project (#65), so no
// screen offers a choice of who gets it: a picker there controlled nothing
// (Dean, 2026-10-26). These say who it reaches instead, from the server's own
// count (GET /projects/:id/safety-audience). Wording approved by Dean.

export type SafetyAudience = { projectName: string; members: number; pendingInvites: number; alertsOn: number; openToEveryone: boolean | null };

const authH = (): Record<string, string> => {
  const t = localStorage.getItem("sitesort_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
};

// null while loading or when it couldn't be loaded (`failed`).
export function useSafetyAudience(projectId: string | null | undefined, documentId: string | null, enabled: boolean) {
  const [data, setData] = useState<SafetyAudience | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setData(null); setFailed(false);
    if (!enabled || !projectId) return;
    let cancelled = false;
    const q = documentId ? `?documentId=${encodeURIComponent(documentId)}` : "";
    fetch(`/api/projects/${projectId}/safety-audience${q}`, { headers: authH() })
      .then(async r => {
        if (cancelled) return;
        if (!r.ok) { setFailed(true); return; }
        setData(await r.json());
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [projectId, documentId, enabled]);
  return { data, failed };
}

// "All 7 people on the Team Portal for test 1 site sort"
function whoCanOpen(a: SafetyAudience): string {
  return a.members === 1
    ? `The 1 person on the Team Portal for ${a.projectName}`
    : `All ${a.members} people on the Team Portal for ${a.projectName}`;
}

function pendingLine(a: SafetyAudience): string | null {
  return a.pendingInvites > 0 ? `${a.pendingInvites} more will get it when they accept their invite.` : null;
}

// Phone alerts, in the present tense (Dean, 2026-10-26, approved wording):
// how many have alerts turned on now, never that an alert reached anyone.
function shareAlertLine(a: SafetyAudience): string {
  const off = a.members - a.alertsOn;
  if (a.members === 1) {
    return a.alertsOn === 1
      ? "They have phone alerts turned on for this project."
      : "They don't have phone alerts turned on for this project, so they only see it when they open the Team Portal.";
  }
  if (off === 0) return `All ${a.members} have phone alerts turned on for this project.`;
  if (a.alertsOn === 0) return "None of them have phone alerts turned on for this project, so they only see it when they open the Team Portal.";
  return `${a.alertsOn} of the ${a.members} ${a.alertsOn === 1 ? "has" : "have"} phone alerts turned on for this project. The other ${off} only ${off === 1 ? "sees" : "see"} it when they open the Team Portal.`;
}

function uploadAlertLine(a: SafetyAudience): string {
  const off = a.members - a.alertsOn;
  if (a.members === 1) {
    return a.alertsOn === 1
      ? `${whoCanOpen(a)} will get this. They have phone alerts turned on and will be sent an alert.`
      : `${whoCanOpen(a)} will get this. They don't have phone alerts turned on, so they'll see it next time they open the Team Portal.`;
  }
  if (off === 0) return `${whoCanOpen(a)} will get this, and all ${a.members} have phone alerts turned on, so each will be sent an alert.`;
  if (a.alertsOn === 0) return `${whoCanOpen(a)} will get this. None of them have phone alerts turned on, so they'll see it next time they open the Team Portal.`;
  return `${whoCanOpen(a)} will get this. ${a.alertsOn} of them ${a.alertsOn === 1 ? "has" : "have"} phone alerts turned on and will be sent an alert. The other ${off} will see it next time they open the Team Portal.`;
}

// Share dialog, Team Portal section, for a current safety document.
export function SafetyShareNotice({ audience }: { audience: SafetyAudience }) {
  const pending = pendingLine(audience);
  return (
    <div className="space-y-1.5 min-w-0" data-testid="portal-share-safety">
      <p className="text-sm font-semibold break-words">Safety documents go to everyone on this project.</p>
      <p className="text-sm break-words">
        {audience.members === 0
          ? `Nobody on ${audience.projectName} has joined the Team Portal yet. Everyone who joins will be able to open this.`
          : `${whoCanOpen(audience)} can open this. ${shareAlertLine(audience)}`}
        {" "}You can't choose who gets a safety document, so nobody can be left out by mistake.
      </p>
      {pending && <p className="text-xs text-muted-foreground break-words">{pending}</p>}
    </div>
  );
}

// Upload dialog, when the category is Safety Document.
export function SafetyUploadNotice({ audience }: { audience: SafetyAudience }) {
  const pending = pendingLine(audience);
  return (
    <div className="space-y-1 min-w-0" data-testid="upload-safety-audience">
      <p className="text-sm break-words">
        Safety documents go to everyone on this project.{" "}
        {audience.members === 0
          ? `Nobody on ${audience.projectName} has joined the Team Portal yet. Everyone who joins will get this.`
          : uploadAlertLine(audience)}
      </p>
      {pending && <p className="text-xs text-muted-foreground break-words">{pending}</p>}
    </div>
  );
}

export function emailAllLabel(members: number): string {
  return members === 1 ? "Also email them" : `Also email all ${members}`;
}

// What the server says it did: never claims an email it didn't send.
export function emailedText(r: { recipientCount: number; emailedCount: number }): string {
  if (r.recipientCount === 0) return "Nobody to email: nobody has joined the Team Portal for this project yet.";
  if (r.emailedCount === r.recipientCount) return r.recipientCount === 1 ? "Emailed them." : `Emailed all ${r.recipientCount}.`;
  const off = r.recipientCount - r.emailedCount;
  return `Emailed ${r.emailedCount} of ${r.recipientCount}. ${off === 1 ? "1 has" : `${off} have`} email turned off in their settings, so ${off === 1 ? "wasn't" : "weren't"} emailed.`;
}
