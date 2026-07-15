import { useState } from "react";
import {
  useListSubcontractorPeople, useCreateSubcontractorPerson, useDeletePerson,
  useListInHousePeople, useCreateInHousePerson, useCreatePortalInvite, useRevokeProjectInvite,
  useResendPortalInvite, useUpdatePerson,
  getListSubcontractorPeopleQueryKey, getListInHousePeopleQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  UserPlus, Copy, Trash2, Mail, ShieldCheck, Send, MoreHorizontal, X, ChevronDown, ChevronRight,
  RefreshCw, AlertTriangle, CheckCircle2,
} from "lucide-react";

type PortalStatus = { status: "not_invited" | "invited" | "member"; role?: string; inviteId?: string; lastActiveAt?: string; emailStatus?: "sent" | "failed"; emailLastSentAt?: string };

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
type PersonLike = { id: string; name: string; email: string; phone?: string; roleTitle?: string; showContactInPortal?: boolean; portal?: PortalStatus };
type PortalRole = "worker" | "manager" | "subcontractor";
type PersonInput = { name: string; email: string; phone?: string; roleTitle?: string };
type PillSource = { kind: "in_house" } | { kind: "subcontractor"; subcontractorId: string };

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
  const isSub = source.kind === "subcontractor";
  const subId = isSub ? source.subcontractorId : "";

  const subQ = useListSubcontractorPeople(subId, { projectId }, { query: { enabled: isSub && canManage, retry: false, queryKey: getListSubcontractorPeopleQueryKey(subId, { projectId }) } });
  const inHouseQ = useListInHousePeople(projectId, { query: { enabled: !isSub && canManage, retry: false, queryKey: getListInHousePeopleQueryKey(projectId) } });
  const people = ((isSub ? subQ.data : inHouseQ.data) ?? []) as PersonLike[];
  const loading = isSub ? subQ.isLoading : inHouseQ.isLoading;
  const refresh = () => { void (isSub ? subQ.refetch() : inHouseQ.refetch()); };

  const createSub = useCreateSubcontractorPerson();
  const createInHouse = useCreateInHousePerson();
  const invite = useCreatePortalInvite();
  const revoke = useRevokeProjectInvite();

  const [prompting, setPrompting] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const busy = createSub.isPending || createInHouse.isPending || invite.isPending || revoke.isPending;

  const email = (personEmail ?? "").trim().toLowerCase();
  const person = email ? people.find(p => p.email.toLowerCase() === email) : undefined;
  const portal: PortalStatus = person?.portal ?? { status: "not_invited" };

  const doInvite = async (useEmail: string) => {
    try {
      let personId = person?.id;
      if (!personId) {
        const data: PersonInput = { name: personName || useEmail, email: useEmail };
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
        <DropdownMenuContent align="end" className="w-52">
          <div className="px-2 py-1.5 text-xs text-muted-foreground">Last active {fmtRelative(portal.lastActiveAt)}</div>
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

// ── Additional-worker row (used only in the quiet "add another person" area) ──
function PersonRow({
  person, onInvite, onRevoke, onDelete, busy, projectId, onChanged,
}: {
  person: PersonLike;
  onInvite: (role: PortalRole) => Promise<void>;
  onRevoke: (inviteId: string) => Promise<void>;
  onDelete: () => Promise<void>;
  busy: boolean;
  projectId: string;
  onChanged: () => void;
}) {
  const portal = person.portal ?? { status: "not_invited" };
  const [role, setRole] = useState<PortalRole>((portal.role as PortalRole) ?? "worker");
  const [copied, setCopied] = useState(false);
  const invite = async () => { await onInvite(role); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const updatePerson = useUpdatePerson();
  // Effective contact visibility: explicit flag, else role default (managers ON).
  const contactOn = person.showContactInPortal ?? (portal.role === "manager");
  const toggleContact = async () => {
    try { await updatePerson.mutateAsync({ personId: person.id, data: { showContactInPortal: !contactOn } }); onChanged(); } catch { /* noop */ }
  };
  const onPortal = portal.status === "member" || portal.status === "invited";

  return (
    <div className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg hover:bg-muted/40">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{person.name}{person.roleTitle && <span className="text-xs text-muted-foreground font-normal"> · {person.roleTitle}</span>}</p>
        <p className="text-xs text-muted-foreground truncate flex items-center gap-1"><Mail className="w-3 h-3 shrink-0" />{person.email}</p>
        {portal.status === "invited" && (
          <div className="mt-0.5"><InviteEmailStatus projectId={projectId} portal={portal} onDone={onChanged} /></div>
        )}
        {onPortal && (
          <button onClick={toggleContact} disabled={updatePerson.isPending} className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground" title="Show this person's email & phone on their portal Team row">
            <span className={cn("relative inline-flex h-4 w-7 rounded-full transition-colors shrink-0", contactOn ? "bg-primary" : "bg-muted-foreground/30")}>
              <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform", contactOn ? "translate-x-3.5" : "translate-x-0.5")} />
            </span>
            Show contact in portal
          </button>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {portal.status === "member" ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"><ShieldCheck className="w-3 h-3" /> Member</span>
        ) : portal.status === "invited" ? (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={invite} isLoading={busy} title="Copy a fresh invite link"><Copy className="w-3.5 h-3.5" />{copied ? " Copied" : " Copy link"}</Button>
        ) : (
          <>
            <select value={role} onChange={e => setRole(e.target.value as PortalRole)} className="h-7 rounded-lg border border-input bg-background px-1.5 text-xs" title="Portal role">
              <option value="worker">Worker</option><option value="manager">Manager</option><option value="subcontractor">Subcontractor</option>
            </select>
            <Button size="sm" className="h-7 px-2 text-xs" onClick={invite} isLoading={busy}><Send className="w-3.5 h-3.5" /></Button>
          </>
        )}
        {(portal.status !== "not_invited") && portal.inviteId && (
          <button onClick={() => onRevoke(portal.inviteId!)} disabled={busy} className="p-1.5 text-muted-foreground hover:text-destructive rounded-lg hover:bg-muted disabled:opacity-50" title="Revoke"><Trash2 className="w-4 h-4" /></button>
        )}
        {portal.status === "not_invited" && (
          <button onClick={onDelete} disabled={busy} className="p-1.5 text-muted-foreground hover:text-destructive rounded-lg hover:bg-muted disabled:opacity-50" title="Remove person"><Trash2 className="w-4 h-4" /></button>
        )}
      </div>
    </div>
  );
}

// ── Quiet "+ Add another person" area on a subcontractor card ────────────────
// Shows/adds ADDITIONAL workers beyond the primary contact (the pill handles the
// primary contact). The primary contact's own row is filtered out to avoid dupes.
export function SubcontractorPeople({
  subcontractorId, projectId, primaryContactEmail, canManage,
}: {
  subcontractorId: string;
  projectId: string;
  primaryContactEmail?: string;
  canManage: boolean;
}) {
  const { toast } = useToast();
  const params = { projectId };
  const peopleQ = useListSubcontractorPeople(subcontractorId, params, { query: { enabled: canManage, retry: false, queryKey: getListSubcontractorPeopleQueryKey(subcontractorId, params) } });
  const createPerson = useCreateSubcontractorPerson();
  const invite = useCreatePortalInvite();
  const revoke = useRevokeProjectInvite();
  const deletePerson = useDeletePerson();

  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", roleTitle: "" });

  const primary = (primaryContactEmail ?? "").toLowerCase();
  const people = ((peopleQ.data ?? []) as PersonLike[]).filter(p => p.email.toLowerCase() !== primary);
  const busy = createPerson.isPending || invite.isPending || revoke.isPending || deletePerson.isPending;
  const refresh = () => { void peopleQ.refetch(); };

  if (!canManage) return null;

  const addPerson = async (data: PersonInput) => {
    try { await createPerson.mutateAsync({ subcontractorId, data }); refresh(); }
    catch (e: any) { toast({ variant: "destructive", title: "Could not add person", description: e?.data?.message ?? "Please try again." }); }
  };
  const invitePerson = async (personId: string, role: PortalRole) => {
    try {
      const res = await invite.mutateAsync({ projectId, data: { personId, role } });
      if (res.inviteUrl) { try { await navigator.clipboard.writeText(res.inviteUrl); } catch { /* noop */ } toast({ title: "Invite link copied", description: "Share it to grant portal-only access." }); }
      refresh();
    } catch (e: any) { toast({ variant: "destructive", title: "Invite failed", description: e?.data?.message ?? "Please try again." }); }
  };
  const revokePerson = async (inviteId: string) => {
    try { await revoke.mutateAsync({ projectId, inviteId }); refresh(); } catch { toast({ variant: "destructive", title: "Could not revoke access" }); }
  };
  const removePerson = async (personId: string) => {
    try { await deletePerson.mutateAsync({ personId }); refresh(); } catch { toast({ variant: "destructive", title: "Could not remove person" }); }
  };

  return (
    <div className="pt-2">
      <button onClick={() => setOpen(o => !o)} className="text-xs font-medium text-muted-foreground hover:text-primary flex items-center gap-1">
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <UserPlus className="w-3.5 h-3.5" /> Add another person{people.length > 0 ? ` (${people.length})` : ""}
      </button>

      {open && (
        <div className="mt-1.5">
          {peopleQ.isLoading ? (
            <div className="flex justify-center py-2"><Spinner className="size-4 text-primary" /></div>
          ) : (
            <div className="divide-y divide-border/40">
              {people.map(p => (
                <PersonRow key={p.id} person={p} busy={busy} projectId={projectId} onChanged={refresh}
                  onInvite={role => invitePerson(p.id, role)} onRevoke={revokePerson} onDelete={() => removePerson(p.id)} />
              ))}
            </div>
          )}

          {adding ? (
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <Input className="h-8 text-sm" placeholder="Full name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              <Input className="h-8 text-sm" type="email" placeholder="Email" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              <Input className="h-8 text-sm" placeholder="Phone (optional)" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              <Input className="h-8 text-sm" placeholder="Job title (optional)" value={form.roleTitle} onChange={e => setForm(f => ({ ...f, roleTitle: e.target.value }))} />
              <div className="col-span-2 flex items-center gap-2">
                <Button size="sm" className="h-8" isLoading={createPerson.isPending} disabled={!form.name.trim() || !form.email.trim()}
                  onClick={async () => { await addPerson({ name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim() || undefined, roleTitle: form.roleTitle.trim() || undefined }); setForm({ name: "", email: "", phone: "", roleTitle: "" }); setAdding(false); }}>Add</Button>
                <Button size="sm" variant="ghost" className="h-8" onClick={() => setAdding(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAdding(true)} className="mt-1.5 text-xs font-medium text-primary hover:underline">+ Add person</button>
          )}
        </div>
      )}
    </div>
  );
}
