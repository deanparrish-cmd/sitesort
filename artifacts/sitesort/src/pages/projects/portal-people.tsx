import { useState } from "react";
import {
  useListSubcontractorPeople, useCreateSubcontractorPerson,
  useListInHousePeople, useCreateInHousePerson, useCreatePortalInvite, useRevokeProjectInvite,
  useResendPortalInvite, useUpdateMemberPermissions,
  getListSubcontractorPeopleQueryKey, getListInHousePeopleQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Copy, Trash2, ShieldCheck, ShieldOff, Send, X,
  RefreshCw, AlertTriangle, CheckCircle2, Circle,
} from "lucide-react";

type PortalStatus = {
  status: "not_invited" | "invited" | "member"; role?: string; inviteId?: string; lastActiveAt?: string;
  emailStatus?: "sent" | "failed"; emailLastSentAt?: string;
  memberId?: string; canLogIssues?: boolean; canUpdatePlantMaterials?: boolean; canEditDailyReport?: boolean;
};

const RESEND_COOLDOWN_MS = 5 * 60 * 1000;

// Invite-email delivery state + a rate-limited "Resend" action. Shown for pending
// invites so the PM knows whether the email went out and can re-send / fall back
// to the copy link if it failed.
function InviteEmailStatus({ projectId, portal, onDone }: { projectId: string; portal: PortalStatus; onDone: () => void }) {
  const { toast } = useToast();
  const resend = useResendPortalInvite();
  if (!portal.inviteId) return null;
  const lastMs = portal.emailLastSentAt ? new Date(portal.emailLastSentAt).getTime() : 0;
  const cooling = lastMs > 0 && Date.now() - lastMs < RESEND_COOLDOWN_MS;
  const doResend = async () => {
    try {
      const res = await resend.mutateAsync({ projectId, inviteId: portal.inviteId! });
      if (res.emailStatus === "sent") toast({ title: "Invite email resent" });
      else toast({ variant: "destructive", title: "Send failed", description: "Use the Copy link instead." });
      onDone();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Couldn't resend", description: e?.data?.message ?? "Please try again shortly." });
      onDone();
    }
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] leading-tight flex-wrap">
      {portal.emailStatus === "failed" ? (
        <span className="inline-flex items-center gap-0.5 text-destructive font-medium"><AlertTriangle className="w-3 h-3" /> Email failed — use copy link or resend</span>
      ) : portal.emailStatus === "sent" ? (
        <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="w-3 h-3" /> Email sent {fmtRelative(portal.emailLastSentAt)}</span>
      ) : (
        <span className="text-muted-foreground">No email sent</span>
      )}
      <button
        onClick={doResend}
        disabled={resend.isPending || cooling}
        className="inline-flex items-center gap-0.5 text-primary hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
        title={cooling ? "You can resend again a few minutes after the last send" : "Resend the invite email"}
      >
        <RefreshCw className={cn("w-3 h-3", resend.isPending && "animate-spin")} /> {resend.isPending ? "Resending…" : "Resend"}
      </button>
    </span>
  );
}
type PersonLike = { id: string; name: string; lastName?: string | null; email: string; phone?: string; roleTitle?: string; showContactInPortal?: boolean; portal?: PortalStatus };
type PortalRole = "worker" | "manager" | "subcontractor";
type PersonInput = { firstName: string; lastName: string; email: string; phone?: string; roleTitle?: string };

// Best-effort split for the one-click "quick invite" path, which has no name
// form of its own — it reuses whatever display name is already on file (a
// dashboard user's name or a subcontractor's contact name). A single-word
// name is duplicated into both fields rather than left blank, so the
// required first+surname (min 2 chars each) validation never blocks this flow.
function splitName(full: string): { firstName: string; lastName: string } {
  const trimmed = full.trim();
  const idx = trimmed.indexOf(" ");
  if (idx === -1) return { firstName: trimmed, lastName: trimmed };
  return { firstName: trimmed.slice(0, idx), lastName: trimmed.slice(idx + 1).trim() || trimmed.slice(0, idx) };
}
export type PillSource = { kind: "in_house" } | { kind: "subcontractor"; subcontractorId: string } | { kind: "person"; personId: string; subcontractorId?: string };

function fmtRelative(iso?: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const PILL = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors";

// One-click on/off pill for a single portal-section grant, rendered directly on
// the card (Feature: inline portal-permission toggles) — no menu to open, so a
// manager can see and change access at a glance same as Notes/Docs/Share/Remove.
// Scoped to ONE section only — distinct from the "Portal member" pill above,
// which is the whole-login on/off (see PortalStatusPill).
function PermissionTogglePill({ label, checked, disabled, note, onToggle }: { label: string; checked: boolean; disabled?: boolean; note?: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        PILL,
        "disabled:opacity-50 disabled:cursor-not-allowed",
        checked
          ? "border-violet-200 bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300 dark:border-violet-800"
          : "border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted"
      )}
      title={(checked
        ? `${label}: granted — click to remove access to just this section (their portal login stays active)`
        : `${label}: not granted — click to give access to just this section`) + (note ?? "")}
    >
      {checked ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Circle className="w-3.5 h-3.5" />} {label}
    </button>
  );
}

// ── Shared data/mutations for one person's portal membership on this project ──
// Both PortalStatusPill and PortalPermissionToggles call this with identical
// arguments, so they share the same React Query cache entry (no duplicate
// fetches) while rendering in two different places on the card (Fix: portal
// status pill sits above the role/type tag; section toggles stay next to it).
function usePortalMembership({
  projectId, personName, personEmail, source, canManage,
}: {
  projectId: string; personName: string; personEmail?: string; source: PillSource; canManage: boolean;
}) {
  const { toast } = useToast();
  const isPerson = source.kind === "person";
  const isSub = source.kind === "subcontractor" || (isPerson && !!source.subcontractorId);
  const subId = source.kind === "subcontractor" ? source.subcontractorId : (isPerson ? (source.subcontractorId ?? "") : "");
  const knownPersonId = isPerson ? source.personId : undefined;

  const subQ = useListSubcontractorPeople(subId, { projectId }, { query: { enabled: isSub && canManage, retry: false, queryKey: getListSubcontractorPeopleQueryKey(subId, { projectId }) } });
  const inHouseQ = useListInHousePeople(projectId, {}, { query: { enabled: !isSub && canManage, retry: false, queryKey: getListInHousePeopleQueryKey(projectId, {}) } });
  const people = ((isSub ? subQ.data : inHouseQ.data) ?? []) as PersonLike[];
  const loading = isSub ? subQ.isLoading : inHouseQ.isLoading;
  const refresh = () => { void (isSub ? subQ.refetch() : inHouseQ.refetch()); };

  const createSub = useCreateSubcontractorPerson();
  const createInHouse = useCreateInHousePerson();
  const invite = useCreatePortalInvite();
  const revoke = useRevokeProjectInvite();
  const updatePermissions = useUpdateMemberPermissions();

  const busy = createSub.isPending || createInHouse.isPending || invite.isPending || revoke.isPending;

  const email = (personEmail ?? "").trim().toLowerCase();
  // A known personId (Feature: person-first cards) matches directly — no
  // lazy-create-by-email indirection needed, the person already exists.
  const person = knownPersonId ? people.find(p => p.id === knownPersonId) : (email ? people.find(p => p.email.toLowerCase() === email) : undefined);
  const portal: PortalStatus = person?.portal ?? { status: "not_invited" };

  // Single invite-creation path for every route into the portal — email send
  // and copyable link both come from this ONE call, which never accepts
  // permission fields (CreatePortalInviteBody: personId + role only). Section
  // permissions are only ever set afterwards, once status is "member", via
  // togglePermission below — so no invite path can create a member with
  // permissions that aren't uniformly manageable on the card (Fix: share-link
  // invites carry the same guarantees as email invites, because there is no
  // separate share-link route to drift out of sync).
  const doInvite = async (useEmail: string) => {
    try {
      let personId = person?.id ?? knownPersonId;
      if (!personId) {
        const data: PersonInput = { ...splitName(personName || useEmail), email: useEmail };
        const created = isSub
          ? await createSub.mutateAsync({ subcontractorId: subId, data })
          : await createInHouse.mutateAsync({ projectId, data });
        personId = (created as { id: string }).id;
      }
      const res = await invite.mutateAsync({ projectId, data: { personId, role: (portal.role as PortalRole) ?? "worker" } });
      if (res.inviteUrl) {
        try { await navigator.clipboard.writeText(res.inviteUrl); } catch { /* noop */ }
        toast({ title: "Invite link copied", description: "Share it to grant portal-only access." });
      }
      refresh();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Invite failed", description: e?.data?.message ?? "Please try again." });
    }
  };

  // Whole-portal-login revoke (distinct from togglePermission, which only ever
  // touches one section). Reuses the same endpoint the Team Portal tab's invite
  // list revokes through — kills any active session immediately and cancels a
  // pending invite; works for both a pending invite and an accepted member.
  const doRevoke = async () => {
    if (!portal.inviteId) return;
    try { await revoke.mutateAsync({ projectId, inviteId: portal.inviteId }); refresh(); toast({ title: "Portal access removed" }); }
    catch { toast({ variant: "destructive", title: "Could not remove portal access" }); }
  };

  const togglePermission = async (field: "canLogIssues" | "canUpdatePlantMaterials" | "canEditDailyReport", value: boolean) => {
    if (!portal.memberId) return;
    try { await updatePermissions.mutateAsync({ projectId, memberId: portal.memberId, data: { [field]: value } }); refresh(); }
    catch { toast({ variant: "destructive", title: "Could not update permission" }); }
  };

  return { portal, busy, loading, doInvite, doRevoke, togglePermission, updatePermissions, revoke };
}

// ── Card row 1: whole-portal-login status/on-off ────────────────────────────
// Invites the card's person directly (in-house card = that member; subcontractor
// card = its primary contact). Lazily creates the underlying `people` row on first
// invite, then reflects portal status in place. Manager-only (mounted gated).
// The "Portal member" pill IS the whole-access on/off control: clicking it opens
// a confirm dialog and, on confirm, removes the person's portal login entirely
// (kills active sessions, cancels any pending invite). After removal the pill
// reverts to "Invite to Portal", so clicking it again re-invites/restores.
export function PortalStatusPill({
  projectId, personName, personEmail, source, canManage,
}: {
  projectId: string;
  personName: string;
  personEmail?: string;
  source: PillSource;
  canManage: boolean;
}) {
  const { portal, busy, loading, doInvite, doRevoke, revoke } = usePortalMembership({ projectId, personName, personEmail, source, canManage });
  const [prompting, setPrompting] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState<"member" | "invited" | null>(null);

  if (!canManage) return null;

  const email = (personEmail ?? "").trim().toLowerCase();
  const onInvite = () => { if (!email) { setPrompting(true); return; } void doInvite(email); };

  // Subcontractor primary contact with no email on file → prompt + save it back.
  if (prompting) {
    return (
      <span className="inline-flex items-center gap-1">
        <Input className="h-7 w-40 text-xs" type="email" autoFocus placeholder="contact email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          value={emailInput} onChange={e => setEmailInput(e.target.value)} />
        <Button size="sm" className="h-7 px-2 text-xs" isLoading={busy} disabled={!emailInput.trim()}
          onClick={async () => { const em = emailInput.trim().toLowerCase(); setPrompting(false); await doInvite(em); }}>Save & invite</Button>
        <button className="p-1 text-muted-foreground hover:text-destructive" onClick={() => setPrompting(false)}><X className="w-3.5 h-3.5" /></button>
      </span>
    );
  }

  if (loading) return <span className={cn(PILL, "border-border bg-background text-muted-foreground/60")}>…</span>;

  if (portal.status === "member") {
    return (
      <>
        <button
          type="button"
          onClick={() => setConfirmRevoke("member")}
          className={cn(PILL, "border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800 hover:border-emerald-400")}
          title={`Last active ${fmtRelative(portal.lastActiveAt)} — click to remove this person's portal login entirely`}
        >
          <ShieldCheck className="w-3.5 h-3.5" /> Portal member
        </button>
        <Dialog open={confirmRevoke === "member"} onOpenChange={v => { if (!v) setConfirmRevoke(null); }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <ShieldOff className="w-4 h-4" /> Remove {personName}'s portal access completely?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>This ends any active portal session immediately and cancels any pending invite for them.</p>
            <p className="text-muted-foreground">
              This is different from the Site Issues / Plant &amp; Materials / Daily Report toggles on this card — unticking one of those removes access to that section only. This removes{" "}
              <span className="font-semibold text-foreground">their whole portal login</span>.
            </p>
            <p className="text-muted-foreground">You can re-invite {personName} to the portal afterwards.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRevoke(null)}>Cancel</Button>
            <Button variant="destructive" isLoading={revoke.isPending} onClick={async () => { await doRevoke(); setConfirmRevoke(null); }}>Remove access</Button>
          </DialogFooter>
        </Dialog>
      </>
    );
  }

  if (portal.status === "invited") {
    return (
      <>
        <span className="inline-flex flex-col items-end gap-0.5">
          <span className="inline-flex items-center gap-1">
            <button className={cn(PILL, portal.emailStatus === "failed" ? "border-red-200 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300 dark:border-red-800" : "border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800")} onClick={onInvite} disabled={busy} title="Copy a fresh invite link">
              <Copy className="w-3.5 h-3.5" /> Invited · Copy link
            </button>
            <button
              type="button"
              onClick={() => setConfirmRevoke("invited")}
              disabled={busy}
              className="p-1 text-muted-foreground hover:text-destructive rounded-lg hover:bg-muted"
              title="Cancel this pending invite"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </span>
          <InviteEmailStatus projectId={projectId} portal={portal} onDone={() => {}} />
        </span>
        <Dialog open={confirmRevoke === "invited"} onOpenChange={v => { if (!v) setConfirmRevoke(null); }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <ShieldOff className="w-4 h-4" /> Cancel {personName}'s pending invite?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">They won't be able to use the link they were sent. You can invite them again later.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRevoke(null)}>Keep invite</Button>
            <Button variant="destructive" isLoading={revoke.isPending} onClick={async () => { await doRevoke(); setConfirmRevoke(null); }}>Cancel invite</Button>
          </DialogFooter>
        </Dialog>
      </>
    );
  }

  return (
    <button className={cn(PILL, "border-border bg-background text-muted-foreground hover:text-primary hover:bg-muted")} onClick={onInvite} disabled={busy}>
      <Send className="w-3.5 h-3.5" /> Invite to Portal
    </button>
  );
}

// ── Card row: per-section access toggles ────────────────────────────────────
// Rendered for BOTH a pending invite AND an accepted member — a PM can grant
// section access before the person ever logs in, so it's ready the moment
// they accept (Fix: permission parity regardless of invite route or accept
// state). The underlying project_members row already exists by invite time
// (see portalStatusFor in people.ts), so togglePermission works identically
// either way. Each pill is scoped to ONE section — see PermissionTogglePill's
// tooltip and PortalStatusPill's confirm dialog for the wording distinguishing
// this from a whole-login revoke.
export function PortalPermissionToggles({
  projectId, personName, personEmail, source, canManage,
}: {
  projectId: string;
  personName: string;
  personEmail?: string;
  source: PillSource;
  canManage: boolean;
}) {
  const { portal, togglePermission, updatePermissions } = usePortalMembership({ projectId, personName, personEmail, source, canManage });
  if (!canManage || (portal.status !== "member" && portal.status !== "invited")) return null;
  const pendingNote = portal.status === "invited" ? " — applies as soon as they accept" : "";
  return (
    <>
      <PermissionTogglePill
        label="Site Issues"
        checked={portal.canLogIssues ?? false}
        disabled={updatePermissions.isPending}
        note={pendingNote}
        onToggle={() => togglePermission("canLogIssues", !(portal.canLogIssues ?? false))}
      />
      <PermissionTogglePill
        label="Plant & Materials"
        checked={portal.canUpdatePlantMaterials ?? false}
        disabled={updatePermissions.isPending}
        note={pendingNote}
        onToggle={() => togglePermission("canUpdatePlantMaterials", !(portal.canUpdatePlantMaterials ?? false))}
      />
      <PermissionTogglePill
        label="Daily Report"
        checked={portal.canEditDailyReport ?? false}
        disabled={updatePermissions.isPending}
        note={pendingNote}
        onToggle={() => togglePermission("canEditDailyReport", !(portal.canEditDailyReport ?? false))}
      />
    </>
  );
}
