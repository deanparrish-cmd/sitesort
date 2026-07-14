import { useState } from "react";
import {
  useListSubcontractorPeople, useCreateSubcontractorPerson, useDeletePerson,
  useListInHousePeople, useCreateInHousePerson, useCreatePortalInvite, useRevokeProjectInvite,
  getListSubcontractorPeopleQueryKey, getListInHousePeopleQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/hooks/use-toast";
import {
  Users2, UserPlus, Copy, Check, Trash2, Mail, ShieldCheck, Clock, Send,
} from "lucide-react";

type PortalStatus = { status: "not_invited" | "invited" | "member"; role?: string; inviteId?: string; lastActiveAt?: string };
type PersonLike = { id: string; name: string; email: string; phone?: string; roleTitle?: string; portal?: PortalStatus };
type PortalRole = "worker" | "manager" | "subcontractor";
type PersonInput = { name: string; email: string; phone?: string; roleTitle?: string };

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

// One person row: name/email/title + the per-person portal control. A portal
// invite always yields a portal-only login (no dashboard access) once accepted.
function PersonRow({
  person, canManage, onInvite, onRevoke, onDelete, busy,
}: {
  person: PersonLike;
  canManage: boolean;
  onInvite: (role: PortalRole) => Promise<void>;
  onRevoke: (inviteId: string) => Promise<void>;
  onDelete: () => Promise<void>;
  busy: boolean;
}) {
  const portal = person.portal ?? { status: "not_invited" };
  // Seed from the current invite's role so re-issuing a link ("Copy link") never
  // silently downgrades the role (e.g. manager → worker) after a reload.
  const [role, setRole] = useState<PortalRole>((portal.role as PortalRole) ?? "worker");
  const [copied, setCopied] = useState(false);

  const invite = async () => { await onInvite(role); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  return (
    <div className="flex items-center justify-between gap-2 py-2 px-2.5 rounded-lg hover:bg-muted/40">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">
          {person.name}
          {person.roleTitle && <span className="text-xs text-muted-foreground font-normal"> · {person.roleTitle}</span>}
        </p>
        <p className="text-xs text-muted-foreground truncate flex items-center gap-1"><Mail className="w-3 h-3 shrink-0" />{person.email}</p>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {portal.status === "member" ? (
          <>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
              <ShieldCheck className="w-3 h-3" /> Portal member
            </span>
            <span className="text-[11px] text-muted-foreground hidden sm:flex items-center gap-1"><Clock className="w-3 h-3" />{fmtRelative(portal.lastActiveAt)}</span>
            {canManage && portal.inviteId && (
              <button onClick={() => onRevoke(portal.inviteId!)} disabled={busy} className="p-1.5 text-muted-foreground hover:text-destructive rounded-lg hover:bg-muted disabled:opacity-50" title="Revoke portal access">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </>
        ) : portal.status === "invited" ? (
          <>
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">Invited</span>
            {canManage && (
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={invite} isLoading={busy} title="Copy a fresh invite link">
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}<span className="ml-1 hidden sm:inline">Copy link</span>
              </Button>
            )}
            {canManage && portal.inviteId && (
              <button onClick={() => onRevoke(portal.inviteId!)} disabled={busy} className="p-1.5 text-muted-foreground hover:text-destructive rounded-lg hover:bg-muted disabled:opacity-50" title="Revoke invite">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </>
        ) : (
          canManage && (
            <>
              <select value={role} onChange={e => setRole(e.target.value as PortalRole)} className="h-7 rounded-lg border border-input bg-background px-1.5 text-xs" title="Portal role">
                <option value="worker">Worker</option>
                <option value="manager">Manager</option>
                <option value="subcontractor">Subcontractor</option>
              </select>
              <Button size="sm" className="h-7 px-2 text-xs" onClick={invite} isLoading={busy}>
                <Send className="w-3.5 h-3.5 sm:mr-1" /><span className="hidden sm:inline">Invite to Portal</span>
              </Button>
            </>
          )
        )}
        {canManage && portal.status === "not_invited" && (
          <button onClick={onDelete} disabled={busy} className="p-1.5 text-muted-foreground hover:text-destructive rounded-lg hover:bg-muted disabled:opacity-50" title="Remove person">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// Inline "add a person" form (name/email/±phone/±title).
function AddPersonForm({ onAdd, onClose, pending }: { onAdd: (d: PersonInput) => Promise<void>; onClose: () => void; pending: boolean }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", roleTitle: "" });
  return (
    <div className="mt-2 grid grid-cols-2 gap-1.5">
      <Input className="h-8 text-sm" placeholder="Full name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
      <Input className="h-8 text-sm" type="email" placeholder="Email" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
      <Input className="h-8 text-sm" placeholder="Phone (optional)" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
      <Input className="h-8 text-sm" placeholder="Job title (optional)" value={form.roleTitle} onChange={e => setForm(f => ({ ...f, roleTitle: e.target.value }))} />
      <div className="col-span-2 flex items-center gap-2">
        <Button size="sm" className="h-8" isLoading={pending} disabled={!form.name.trim() || !form.email.trim()}
          onClick={async () => { await onAdd({ name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim() || undefined, roleTitle: form.roleTitle.trim() || undefined }); onClose(); }}>
          Add
        </Button>
        <Button size="sm" variant="ghost" className="h-8" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

// Shared list body: renders people rows, an add form, and (optionally) a
// one-click "add primary contact" shortcut. Both the subcontractor People
// section and the in-house panel render through this.
function PeopleListBody({
  people, loading, canManage, busy, addPending, onInvite, onRevoke, onDelete, onAdd, primaryContact,
}: {
  people: PersonLike[];
  loading: boolean;
  canManage: boolean;
  busy: boolean;
  addPending: boolean;
  onInvite: (personId: string, role: PortalRole) => Promise<void>;
  onRevoke: (inviteId: string) => Promise<void>;
  onDelete: (personId: string) => Promise<void>;
  onAdd: (d: PersonInput) => Promise<void>;
  primaryContact?: { name?: string; email?: string; phone?: string };
}) {
  const [adding, setAdding] = useState(false);
  const hasPrimary = !!primaryContact?.email && people.some(p => p.email.toLowerCase() === primaryContact.email!.toLowerCase());

  if (loading) return <div className="flex justify-center py-3"><Spinner className="size-4 text-primary" /></div>;

  return (
    <>
      {people.length === 0 && !adding && <p className="text-xs text-muted-foreground italic mb-2">No individual people added yet.</p>}

      <div className="divide-y divide-border/40">
        {people.map(p => (
          <PersonRow key={p.id} person={p} canManage={canManage} busy={busy}
            onInvite={role => onInvite(p.id, role)} onRevoke={onRevoke} onDelete={() => onDelete(p.id)} />
        ))}
      </div>

      {canManage && primaryContact && !hasPrimary && primaryContact.email && !adding && (
        <button
          onClick={() => onAdd({ name: primaryContact.name || primaryContact.email!, email: primaryContact.email!, phone: primaryContact.phone })}
          disabled={busy}
          className="mt-2 text-xs font-medium text-primary hover:underline flex items-center gap-1 disabled:opacity-50"
        >
          <UserPlus className="w-3.5 h-3.5" /> Add primary contact ({primaryContact.name || primaryContact.email})
        </button>
      )}

      {canManage && !adding && (
        <button onClick={() => setAdding(true)} className="mt-2 ml-0 block text-xs font-medium text-primary hover:underline">+ Add person</button>
      )}
      {adding && <AddPersonForm onAdd={onAdd} onClose={() => setAdding(false)} pending={addPending} />}
    </>
  );
}

// "People" section shown inside each subcontractor card on the project Team tab.
export function SubcontractorPeople({
  subcontractorId, projectId, primaryContact, canManage,
}: {
  subcontractorId: string;
  projectId: string;
  primaryContact: { name?: string; email?: string; phone?: string };
  canManage: boolean;
}) {
  const { toast } = useToast();
  const params = { projectId };
  const peopleQ = useListSubcontractorPeople(subcontractorId, params, { query: { retry: false, queryKey: getListSubcontractorPeopleQueryKey(subcontractorId, params) } });
  const createPerson = useCreateSubcontractorPerson();
  const invite = useCreatePortalInvite();
  const revoke = useRevokeProjectInvite();
  const deletePerson = useDeletePerson();

  const people = (peopleQ.data ?? []) as PersonLike[];
  const busy = createPerson.isPending || invite.isPending || revoke.isPending || deletePerson.isPending;
  const refresh = () => peopleQ.refetch();

  const handlers = makePeopleHandlers({
    toast, refresh, projectId, invite, revoke, deletePerson,
    addPerson: (data) => createPerson.mutateAsync({ subcontractorId, data }),
  });

  return (
    <div className="pt-3 border-t border-border/50">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 mb-1.5"><Users2 className="w-3.5 h-3.5" /> People</p>
      <PeopleListBody
        people={people} loading={peopleQ.isLoading} canManage={canManage} busy={busy} addPending={createPerson.isPending}
        onInvite={handlers.invitePerson} onRevoke={handlers.revokePerson} onDelete={handlers.removePerson} onAdd={handlers.addPerson}
        primaryContact={primaryContact}
      />
    </div>
  );
}

// "In-House Team — Portal Access" panel on the project Team tab: portal-only
// in-house people (not tied to a subcontractor firm) with add + invite/revoke.
export function InHousePortalPanel({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const { toast } = useToast();
  const peopleQ = useListInHousePeople(projectId, { query: { retry: false, queryKey: getListInHousePeopleQueryKey(projectId) } });
  const createPerson = useCreateInHousePerson();
  const invite = useCreatePortalInvite();
  const revoke = useRevokeProjectInvite();
  const deletePerson = useDeletePerson();

  const people = (peopleQ.data ?? []) as PersonLike[];
  const busy = createPerson.isPending || invite.isPending || revoke.isPending || deletePerson.isPending;
  const refresh = () => peopleQ.refetch();

  const handlers = makePeopleHandlers({
    toast, refresh, projectId, invite, revoke, deletePerson,
    addPerson: (data) => createPerson.mutateAsync({ projectId, data }),
  });

  return (
    <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
      <div className="px-5 py-4 border-b">
        <p className="font-bold flex items-center gap-2"><Users2 className="w-5 h-5 text-primary" /> In-House Team — Portal Access</p>
        <p className="text-xs text-muted-foreground mt-0.5">Add in-house people and give each a portal-only login scoped to this project (no dashboard access).</p>
      </div>
      <div className="p-3">
        <PeopleListBody
          people={people} loading={peopleQ.isLoading} canManage={canManage} busy={busy} addPending={createPerson.isPending}
          onInvite={handlers.invitePerson} onRevoke={handlers.revokePerson} onDelete={handlers.removePerson} onAdd={handlers.addPerson}
        />
      </div>
    </div>
  );
}

// Shared mutation handlers (toast + refetch) for both wrappers.
function makePeopleHandlers({
  toast, refresh, projectId, invite, revoke, deletePerson, addPerson,
}: {
  toast: ReturnType<typeof useToast>["toast"];
  refresh: () => void;
  projectId: string;
  invite: ReturnType<typeof useCreatePortalInvite>;
  revoke: ReturnType<typeof useRevokeProjectInvite>;
  deletePerson: ReturnType<typeof useDeletePerson>;
  addPerson: (data: PersonInput) => Promise<unknown>;
}) {
  const copyLink = async (url: string) => {
    try { await navigator.clipboard.writeText(url); } catch { /* noop */ }
    toast({ title: "Invite link copied", description: "Share it with the person to grant portal-only access." });
  };
  return {
    addPerson: async (data: PersonInput) => {
      try { await addPerson(data); refresh(); }
      catch (e: any) { toast({ variant: "destructive", title: "Could not add person", description: e?.data?.message ?? "Please try again." }); }
    },
    invitePerson: async (personId: string, role: PortalRole) => {
      try {
        const res = await invite.mutateAsync({ projectId, data: { personId, role } });
        if (res.inviteUrl) await copyLink(res.inviteUrl);
        refresh();
      } catch (e: any) { toast({ variant: "destructive", title: "Invite failed", description: e?.data?.message ?? "Please try again." }); }
    },
    revokePerson: async (inviteId: string) => {
      try { await revoke.mutateAsync({ projectId, inviteId }); refresh(); }
      catch { toast({ variant: "destructive", title: "Could not revoke access" }); }
    },
    removePerson: async (personId: string) => {
      try { await deletePerson.mutateAsync({ personId }); refresh(); }
      catch { toast({ variant: "destructive", title: "Could not remove person" }); }
    },
  };
}
