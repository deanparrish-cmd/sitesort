import { useMemo, useState } from "react";
import {
  useListProjectInvites, useRevokeProjectInvite,
  useGetProjectActivity, useGetProjectActivitySummary,
  useListMemberDocuments, useReviewMemberDocument, useCreatePersonCertification,
  getListProjectInvitesQueryKey, getGetProjectActivityQueryKey, getGetProjectActivitySummaryQueryKey,
  getListMemberDocumentsQueryKey,
} from "@workspace/api-client-react";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { LinkRow } from "@/components/ui/link-row";
import { useToast } from "@/hooks/use-toast";
import { openDocument } from "@/lib/documents";
import { itemDeepLink } from "@/lib/deep-link";
import { formatBytes } from "@/lib/utils";
import { SECTION_NAV } from "@/pages/portal/layout";
import {
  UserPlus, Trash2, Activity, Eye, ShieldAlert, ShieldOff, Clock,
  FileCheck, Check, X, ExternalLink, UserRoundPlus,
} from "lucide-react";

function fmtRelative(iso?: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short", year: "numeric" });
}

const INVITE_BADGE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  accepted: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  revoked: "bg-muted text-muted-foreground",
};

// A compact "recent team activity" indicator for the project Overview (glance).
// Only renders for managers (the endpoint is manager-gated).
export function RecentActivityGlance({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const { data } = useGetProjectActivity(projectId, { limit: 1 }, { query: { enabled: canManage, retry: false, queryKey: getGetProjectActivityQueryKey(projectId, { limit: 1 }) } });
  if (!canManage) return null;
  const latest = data?.entries?.[0];
  return (
    <div className="mb-4 flex items-center gap-2 text-sm bg-primary/5 border border-primary/15 rounded-xl px-4 py-2.5">
      <Activity className="w-4 h-4 text-primary shrink-0" />
      {latest ? (
        <span className="text-muted-foreground truncate">
          <span className="font-medium text-foreground">{latest.memberName}</span>{" "}
          {latest.action === "blocked" ? "was blocked from" : "viewed"}{" "}
          <span className="font-medium text-foreground">{latest.sectionLabel}</span> · {fmtRelative(latest.createdAt)}
        </span>
      ) : (
        <span className="text-muted-foreground">No portal activity yet. Invite people from the Team tab.</span>
      )}
    </div>
  );
}

const MEMBER_DOC_BADGE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  rejected: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
};

// Contractor-uploaded documents awaiting manager review. Managers can open the
// file and approve/reject each submission (reject prompts for an optional note).
function MemberDocumentsReview({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const docsQ = useListMemberDocuments(projectId, { query: { retry: false, queryKey: getListMemberDocumentsQueryKey(projectId) } });
  const review = useReviewMemberDocument();
  const [busyId, setBusyId] = useState("");

  const docs = docsQ.data ?? [];
  const pendingCount = docs.filter(d => d.status === "pending").length;
  // Reject flow opens a proper dialog with a notes box (the note is stored on
  // the doc and shown to the uploader in their portal "My documents" section).
  const [rejectTarget, setRejectTarget] = useState<{ id: string; name: string; uploaderName: string } | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  // "Add to contact" — file an approved submission onto the sender's contact
  // record as a certification/insurance entry (needs a name + expiry date).
  const createCert = useCreatePersonCertification();
  const [fileTarget, setFileTarget] = useState<{ docId: string; personId: string; fileUrl: string; docName: string; uploaderName: string } | null>(null);
  const [certName, setCertName] = useState("");
  const [certNumber, setCertNumber] = useState("");
  const [certExpiry, setCertExpiry] = useState("");
  const [filedIds, setFiledIds] = useState<Record<string, boolean>>({});

  const doFile = async () => {
    if (!fileTarget || !certName.trim() || !certExpiry) return;
    const docId = fileTarget.docId;
    try {
      await createCert.mutateAsync({
        personId: fileTarget.personId,
        data: {
          name: certName.trim(),
          certNumber: certNumber.trim() || undefined,
          expiryDate: certExpiry,
          documentUrl: fileTarget.fileUrl,
        },
      });
      setFiledIds(prev => ({ ...prev, [docId]: true }));
      setFileTarget(null);
      toast({ title: "Added to contact", description: `Saved to ${fileTarget.uploaderName}'s records. You'll find it on their contact page and in Compliance.` });
      // The server now drops filed submissions from the review list — refetch
      // so the row disappears from "Documents for review".
      await docsQ.refetch();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Couldn't add to contact", description: e?.data?.message ?? "Please try again." });
    }
  };

  const doReview = async (id: string, action: "approve" | "reject", note?: string) => {
    setBusyId(id);
    try {
      await review.mutateAsync({ projectId, id, data: { action, note: note?.trim() || undefined } });
      toast({
        title: action === "approve" ? "Document approved" : "Document rejected",
        description: action === "reject" ? "The sender will see the decision and your note in their portal." : undefined,
      });
      await docsQ.refetch();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Could not update", description: e?.data?.message ?? "Please try again." });
    } finally {
      setBusyId("");
    }
  };

  return (
    <section>
      <h3 className="text-lg font-display font-bold mb-3 flex items-center gap-2">
        <FileCheck className="w-5 h-5 text-primary" /> Documents for review
        {pendingCount > 0 && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{pendingCount} pending</span>
        )}
      </h3>
      {docsQ.isLoading ? <div className="flex justify-center py-6"><Spinner className="size-5 text-primary" /></div> : (
        docs.length === 0 ? <p className="text-sm text-muted-foreground">No documents submitted for review yet.</p> : (
          <div className="space-y-2">
            {docs.map(d => (
              <div key={d.id} className="flex items-center justify-between gap-3 p-3 bg-card border border-border rounded-lg">
                <div className="min-w-0">
                  <p className="font-medium truncate flex items-center gap-2">
                    <span className="truncate">{d.name}</span>
                    <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-medium capitalize bg-muted text-muted-foreground">{d.kind}</span>
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {d.uploaderName} · {formatBytes(d.fileSize)} · {fmtRelative(d.createdAt)}
                  </p>
                  {d.status === "rejected" && d.reviewNote && (
                    <p className="text-xs text-rose-600 dark:text-rose-400 mt-0.5">Note: {d.reviewNote}</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${MEMBER_DOC_BADGE[d.status] ?? "bg-muted text-muted-foreground"}`}>{d.status}</span>
                  <button onClick={() => openDocument(d.fileUrl, d.name)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/25 bg-primary/5 text-primary text-xs font-medium hover:bg-primary/15 transition-colors">
                    <ExternalLink className="w-3 h-3" />Open
                  </button>
                  {d.status === "approved" && d.personId && (
                    filedIds[d.id] ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-emerald-700 dark:text-emerald-300">
                        <Check className="w-3 h-3" />Added
                      </span>
                    ) : (
                      <button
                        onClick={() => {
                          setCertName(d.name);
                          setCertNumber("");
                          setCertExpiry("");
                          setFileTarget({ docId: d.id, personId: d.personId!, fileUrl: d.fileUrl, docName: d.name, uploaderName: d.uploaderName });
                        }}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/25 bg-primary/5 text-primary text-xs font-medium hover:bg-primary/15 transition-colors">
                        <UserRoundPlus className="w-3 h-3" />Add to contact
                      </button>
                    )
                  )}
                  {d.status === "pending" && (
                    <>
                      <button disabled={busyId === d.id} onClick={() => doReview(d.id, "approve")}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-background text-muted-foreground text-xs font-medium hover:text-success hover:bg-muted transition-colors disabled:opacity-50">
                        {busyId === d.id && review.variables?.data.action === "approve" ? <Spinner className="size-3" /> : <Check className="w-3 h-3" />}Approve
                      </button>
                      <button disabled={busyId === d.id} onClick={() => { setRejectNote(""); setRejectTarget({ id: d.id, name: d.name, uploaderName: d.uploaderName }); }}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-background text-muted-foreground text-xs font-medium hover:text-destructive hover:bg-muted transition-colors disabled:opacity-50">
                        <X className="w-3 h-3" />Reject
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Reject-with-notes dialog — the note is saved on the document and shown
          to the sender in their portal "My documents" list, plus a notification. */}
      <Dialog open={!!rejectTarget} onOpenChange={v => { if (!v) setRejectTarget(null); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive"><X className="w-4 h-4" /> Reject "{rejectTarget?.name}"?</DialogTitle>
          <p className="text-sm text-muted-foreground">Add a note explaining why, so {rejectTarget?.uploaderName ?? "the sender"} knows what to fix. They'll see the decision and your note in their portal.</p>
        </DialogHeader>
        <textarea
          value={rejectNote}
          onChange={e => setRejectNote(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="e.g. Certificate has expired, please upload the current one"
          className="w-full rounded-lg border-2 border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary resize-none"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setRejectTarget(null)}>Cancel</Button>
          <Button
            variant="destructive"
            isLoading={busyId === rejectTarget?.id}
            onClick={async () => {
              if (!rejectTarget) return;
              await doReview(rejectTarget.id, "reject", rejectNote);
              setRejectTarget(null);
            }}
          >
            Reject document
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Add-to-contact dialog — files the approved doc onto the sender's
          contact record as a certification/insurance entry with an expiry date,
          so it shows on their contact page and feeds compliance reminders. */}
      <Dialog open={!!fileTarget} onOpenChange={v => { if (!v) setFileTarget(null); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserRoundPlus className="w-4 h-4 text-primary" /> Add to {fileTarget?.uploaderName ?? "contact"}'s records</DialogTitle>
          <p className="text-sm text-muted-foreground">The approved file will be saved to their contact record with an expiry date, so it appears in Compliance and expiry reminders.</p>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Name (e.g. Public Liability Insurance, CSCS card)</label>
            <input value={certName} onChange={e => setCertName(e.target.value)} maxLength={120}
              className="mt-1 w-full rounded-lg border-2 border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Certificate / policy number (optional)</label>
            <input value={certNumber} onChange={e => setCertNumber(e.target.value)} maxLength={80}
              className="mt-1 w-full rounded-lg border-2 border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Expiry date</label>
            <input type="date" value={certExpiry} onChange={e => setCertExpiry(e.target.value)}
              className="mt-1 w-full rounded-lg border-2 border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setFileTarget(null)}>Cancel</Button>
          <Button
            disabled={!certName.trim() || !certExpiry}
            isLoading={createCert.isPending}
            onClick={() => void doFile()}
          >
            Add to contact
          </Button>
        </DialogFooter>
      </Dialog>
    </section>
  );
}

export function ProjectTeamActivity({ projectId }: { projectId: string }) {
  // ---- invites (READ-ONLY here) ----
  // Invites are CREATED per-person from the project Team tab (each subcontractor
  // person / in-house member has their own "Invite to Portal" action). This tab
  // only manages the resulting invites — one source of truth, no duplicate form.
  const invitesQ = useListProjectInvites(projectId, { query: { retry: false, queryKey: getListProjectInvitesQueryKey(projectId) } });
  const revokeInvite = useRevokeProjectInvite();
  // Whole-portal-login revoke — same endpoint + same confirm-first pattern as
  // the "Portal member" pill on the Team tab card (portal-people.tsx). "accepted"
  // means an active member: revoking here ends any live session immediately.
  // "pending" means the invite hasn't been used yet: revoking just cancels it.
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; name: string; status: string } | null>(null);

  const revoke = async (inviteId: string) => {
    await revokeInvite.mutateAsync({ projectId, inviteId }).catch(() => {});
    invitesQ.refetch();
  };

  // ---- activity ----
  const [memberId, setMemberId] = useState("");
  const [section, setSection] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const activityParams = useMemo(() => ({
    ...(memberId ? { memberId } : {}),
    ...(section ? { section } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    limit: 100,
  }), [memberId, section, from, to]);
  const activityQ = useGetProjectActivity(projectId, activityParams, { query: { retry: false, queryKey: getGetProjectActivityQueryKey(projectId, activityParams) } });
  const summaryQ = useGetProjectActivitySummary(projectId, { query: { retry: false, queryKey: getGetProjectActivitySummaryQueryKey(projectId) } });

  const memberOptions = summaryQ.data ?? [];

  return (
    <div className="space-y-8">
      {/* ---- Contractor document review ---- */}
      <MemberDocumentsReview projectId={projectId} />

      {/* ---- Invite management (create happens per-person on the Team tab) ---- */}
      <section>
        <h3 className="text-lg font-display font-bold mb-1 flex items-center gap-2"><UserPlus className="w-5 h-5 text-primary" /> Portal invites</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Invite people from the <span className="font-medium text-foreground">Team</span> tab. Each subcontractor person and in-house member has their own “Invite to Portal” action. Manage the resulting invites and revoke access here.
        </p>

        <div className="mt-1">
          {invitesQ.isLoading ? <div className="flex justify-center py-6"><Spinner className="size-5 text-primary" /></div> : (
            (invitesQ.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No invites yet.</p> : (
              <div className="space-y-2">
                {(invitesQ.data ?? []).map(inv => (
                  <div key={inv.id} className="flex items-center justify-between gap-3 p-3 bg-card border border-border rounded-lg">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{inv.name} <span className="text-xs text-muted-foreground font-normal">· {inv.email}</span></p>
                      <p className="text-xs text-muted-foreground capitalize">{inv.role} · invited {fmtRelative(inv.createdAt)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${INVITE_BADGE[inv.status]}`}>{inv.status}</span>
                      {inv.status !== "revoked" && (
                        <button
                          onClick={() => setConfirmTarget({ id: inv.id, name: inv.name, status: inv.status })}
                          className="p-1.5 text-muted-foreground hover:text-destructive rounded-lg hover:bg-muted"
                          title={inv.status === "accepted" ? "Remove portal access" : "Cancel invite"}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </section>

      <Dialog open={!!confirmTarget} onOpenChange={v => { if (!v) setConfirmTarget(null); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <ShieldOff className="w-4 h-4" />
            {confirmTarget?.status === "accepted" ? `Remove ${confirmTarget?.name}'s portal access completely?` : `Cancel ${confirmTarget?.name}'s pending invite?`}
          </DialogTitle>
        </DialogHeader>
        {confirmTarget?.status === "accepted" ? (
          <div className="space-y-2 text-sm">
            <p>This ends any active portal session immediately and cancels any pending invite for them.</p>
            <p className="text-muted-foreground">This removes their whole portal login. Section permissions (Site Issues, Plant &amp; Materials, Daily Report) are managed separately, from their card on the Team tab.</p>
            <p className="text-muted-foreground">You can re-invite them to the portal afterwards.</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">They won't be able to use the link they were sent. You can invite them again later.</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirmTarget(null)}>{confirmTarget?.status === "accepted" ? "Cancel" : "Keep invite"}</Button>
          <Button
            variant="destructive"
            isLoading={revokeInvite.isPending}
            onClick={async () => { if (confirmTarget) { await revoke(confirmTarget.id); setConfirmTarget(null); } }}
          >
            {confirmTarget?.status === "accepted" ? "Remove access" : "Cancel invite"}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* ---- Per-member summary ---- */}
      <section>
        <h3 className="text-lg font-display font-bold mb-3 flex items-center gap-2"><Eye className="w-5 h-5 text-primary" /> Member activity</h3>
        {summaryQ.isLoading ? <div className="flex justify-center py-6"><Spinner className="size-5 text-primary" /></div> : (
          memberOptions.length === 0 ? <p className="text-sm text-muted-foreground">No members have joined the portal yet.</p> : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {memberOptions.map(m => (
                <div key={m.userId} className="p-3 bg-card border border-border rounded-lg">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium truncate">{m.memberName}</p>
                    <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> {fmtRelative(m.lastActiveAt)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{m.totalViews} views</p>
                  {m.topSections.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {m.topSections.map(s => (
                        <span key={s.section} className="px-1.5 py-0.5 rounded bg-muted text-xs text-muted-foreground">{s.sectionLabel} ({s.count})</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        )}
      </section>

      {/* ---- Activity feed + filters ---- */}
      <section>
        <h3 className="text-lg font-display font-bold mb-3 flex items-center gap-2"><Activity className="w-5 h-5 text-primary" /> Activity feed</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4 [&>*]:min-w-0">
          <select value={memberId} onChange={e => setMemberId(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-2 text-sm">
            <option value="">All members</option>
            {memberOptions.map(m => <option key={m.userId} value={m.userId}>{m.memberName}</option>)}
          </select>
          <select value={section} onChange={e => setSection(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-2 text-sm">
            <option value="">All sections</option>
            {SECTION_NAV.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-2 text-sm" title="From date" />
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-2 text-sm" title="To date" />
        </div>

        {activityQ.isLoading ? <div className="flex justify-center py-8"><Spinner className="size-6 text-primary" /></div> : (
          (activityQ.data?.entries ?? []).length === 0 ? <p className="text-sm text-muted-foreground py-4">No activity for these filters.</p> : (
            <>
              <p className="text-xs text-muted-foreground mb-2">{activityQ.data?.total} total events{(activityQ.data?.total ?? 0) > (activityQ.data?.entries.length ?? 0) ? ` (showing latest ${activityQ.data?.entries.length})` : ""}</p>
              <div className="divide-y divide-border border border-border rounded-lg overflow-hidden">
                {activityQ.data?.entries.map(en => {
                  const label = (
                    <>
                      <span className="font-medium">{en.memberName}</span>
                      {en.removedFromProject && <span className="text-muted-foreground"> (removed from project)</span>}{" "}
                      <span className="text-muted-foreground">
                        {en.action === "blocked" ? "was blocked from" : "viewed"} {en.sectionLabel}
                      </span>
                    </>
                  );
                  const icon = en.action === "blocked" ? <ShieldAlert className="w-4 h-4 text-rose-500" /> : <Eye className="w-4 h-4 text-muted-foreground" />;
                  const href = en.itemId ? itemDeepLink(projectId, en.itemType, en.itemId) ?? undefined : undefined;
                  return href ? (
                    <LinkRow
                      key={en.id}
                      href={href}
                      icon={icon}
                      label={label}
                      detail={fmtDateTime(en.createdAt)}
                      className="rounded-none border-0 min-h-0 px-3 py-2.5 bg-card"
                    />
                  ) : (
                    <div key={en.id} className="flex items-center gap-3 px-3 py-2.5 bg-card text-sm">
                      {icon}
                      <div className="min-w-0 flex-1">{label}</div>
                      <span className="text-xs text-muted-foreground shrink-0">{fmtDateTime(en.createdAt)}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )
        )}
      </section>
    </div>
  );
}
