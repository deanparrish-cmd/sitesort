import { useState } from "react";
import {
  useListSubcontractorPeople, useCreateSubcontractorPerson,
  useListInHousePeople, useCreateInHousePerson, useCreatePortalInvite, useRevokeProjectInvite,
  useResendPortalInvite, useUpdateMemberPermissions,
  getListSubcontractorPeopleQueryKey, getListInHousePeopleQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  UserPlus, Copy, Trash2, Mail, ShieldCheck, Send, MoreHorizontal, X,
  RefreshCw, AlertTriangle, CheckCircle2,
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
type PillSource = { kind: "in_house" } | { kind: "subcontractor"; subcontractorId: string } | { kind: "person"; personId: string; subcontractorId?: string };

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

// ── Card action-row pill ────────────────────────────────────────────────────
// Invites the card's person directly (in-house card = that member; subcontractor
// card = its primary contact). Lazily creates the underlying `people` row on first
// invite, then reflects portal status in place. Manager-only (mounted gated).
export function PortalInvitePill({
  projectId, personName, personEmail, source, canManage,
}: {
  projectId: string;
  personName: string;
  personEmail?: string;
  source: PillSource;
  canManage: boolean;
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

  const [prompting, setPrompting] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const busy = createSub.isPending || createInHouse.isPending || invite.isPending || revoke.isPending;

  const email = (personEmail ?? "").trim().toLowerCase();
  // A known personId (Feature: person-first cards) matches directly — no
  // lazy-create-by-email indirection needed, the person already exists.
  const person = knownPersonId ? people.find(p => p.id === knownPersonId) : (email ? people.find(p => p.email.toLowerCase() === email) : undefined);
  const portal: PortalStatus = person?.portal ?? { status: "not_invited" };

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
      await (isSub ? subQ.refetch() : inHouseQ.refetch());
    } catch (e: any) {
      toast({ variant: "destructive", title: "Invite failed", description: e?.data?.message ?? "Please try again." });
    }
  };

  const onInvite = () => { if (!email) { setPrompting(true); return; } void doInvite(email); };
  const doRevoke = async () => {
    if (!portal.inviteId) return;
    try { await revoke.mutateAsync({ projectId, inviteId: portal.inviteId }); refresh(); }
    catch { toast({ variant: "destructive", title: "Could not revoke access" }); }
  };
  const togglePermission = async (field: "canLogIssues" | "canUpdatePlantMaterials" | "canEditDailyReport", value: boolean) => {
    if (!portal.memberId) return;
    try { await updatePermissions.mutateAsync({ projectId, memberId: portal.memberId, data: { [field]: value } }); refresh(); }
    catch { toast({ variant: "destructive", title: "Could not update permission" }); }
  };

  if (!canManage) return null;

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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className={cn(PILL, "border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800")} title={`Last active ${fmtRelative(portal.lastActiveAt)}`}>
            <ShieldCheck className="w-3.5 h-3.5" /> Portal member
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <div className="px-2 py-1.5 text-xs text-muted-foreground">Last active {fmtRelative(portal.lastActiveAt)}</div>
          <DropdownMenuSeparator />
          <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">Portal access — off by default; ticking adds the section to their portal</div>
          <DropdownMenuCheckboxItem
            checked={portal.canLogIssues ?? false}
            onSelect={e => e.preventDefault()}
            onCheckedChange={v => togglePermission("canLogIssues", v)}
          >
            Site Issues
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={portal.canUpdatePlantMaterials ?? false}
            onSelect={e => e.preventDefault()}
            onCheckedChange={v => togglePermission("canUpdatePlantMaterials", v)}
          >
            Plant &amp; Materials
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={portal.canEditDailyReport ?? false}
            onSelect={e => e.preventDefault()}
            onCheckedChange={v => togglePermission("canEditDailyReport", v)}
          >
            Daily Report
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="gap-2 cursor-pointer text-destructive focus:text-destructive" onClick={doRevoke}><Trash2 className="w-4 h-4" /> Revoke access</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  if (portal.status === "invited") {
    return (
      <span className="inline-flex flex-col items-end gap-0.5">
        <span className="inline-flex items-center gap-1">
          <button className={cn(PILL, portal.emailStatus === "failed" ? "border-red-200 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300 dark:border-red-800" : "border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800")} onClick={onInvite} disabled={busy} title="Copy a fresh invite link">
            <Copy className="w-3.5 h-3.5" /> Invited · Copy link
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="p-1 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted" title="More"><MoreHorizontal className="w-4 h-4" /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem className="gap-2 cursor-pointer text-destructive focus:text-destructive" onClick={doRevoke}><Trash2 className="w-4 h-4" /> Revoke invite</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
        <InviteEmailStatus projectId={projectId} portal={portal} onDone={refresh} />
      </span>
    );
  }

  return (
    <button className={cn(PILL, "border-border bg-background text-muted-foreground hover:text-primary hover:bg-muted")} onClick={onInvite} disabled={busy}>
      <Send className="w-3.5 h-3.5" /> Invite to Portal
    </button>
  );
}

