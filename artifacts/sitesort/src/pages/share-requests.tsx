import { useEffect, useState } from "react";
import { Link } from "wouter";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { PageHeader } from "@/components/ui/page-header";
import { ListRow, PillGroup, Pill } from "@/components/ui/list-row";
import { Button } from "@/components/ui/button";
import { itemDeepLink } from "@/lib/deep-link";
import { cn } from "@/lib/utils";
import { KeyRound, Loader2, Check, X } from "lucide-react";

// Access requests from people whose share link stopped working (#127 Part B).
// Reached from the "Access requested" notification. The sender of the link or
// any approver on the project decides; approving emails the requester a fresh
// link to the CURRENT revision (which may be newer than the one they had).

type ItemRef = { itemType: "document" | "permit"; id: string; name: string; revisionLabel: string | null };
type ShareRequest = {
  id: string; status: "pending" | "approved" | "declined";
  name: string; email: string; organisation: string | null; note: string | null;
  createdAt: string; decidedAt: string | null; decidedByName: string | null;
  projectId: string; projectName: string; sentByName: string | null;
  requested: ItemRef | null; willSend: ItemRef | null; canDecide: boolean;
};

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem("sitesort_token");
  return { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) };
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const STATUS: Record<ShareRequest["status"], { label: string; cls: string }> = {
  pending: { label: "Waiting", cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400" },
  approved: { label: "Approved", cls: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400" },
  declined: { label: "Declined", cls: "bg-muted text-muted-foreground" },
};

export default function ShareRequestsPage() {
  const [rows, setRows] = useState<ShareRequest[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const focusId = new URLSearchParams(window.location.search).get("request");

  useEffect(() => {
    setRows(null);
    // A request opened from a notification may already be decided: show all then.
    const all = showAll || !!focusId;
    fetch(`/api/share-requests${all ? "?status=all" : ""}`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then((d: ShareRequest[]) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]));
  }, [showAll, focusId]);

  useEffect(() => {
    if (!focusId || !rows) return;
    document.getElementById(`req-${focusId}`)?.scrollIntoView({ block: "center" });
  }, [rows, focusId]);

  const decide = async (id: string, approve: boolean) => {
    setBusy(id); setError(null);
    try {
      const r = await fetch(`/api/share-requests/${id}/decision`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ approve }) });
      const d = await r.json().catch(() => ({}));
      const updated: ShareRequest | undefined = r.ok ? d : d.request;
      if (updated) setRows(prev => prev?.map(x => x.id === id ? updated : x) ?? prev);
      if (!r.ok && d.message) setError(d.message);
    } finally {
      setBusy(null);
    }
  };

  const visible = rows?.filter(r => showAll || !!focusId || r.status === "pending") ?? [];

  return (
    <SidebarLayout>
      <PageHeader
        className="mb-6"
        icon={<KeyRound className="w-6 h-6" />}
        title="Access requests"
        description="People whose shared link stopped working, asking for the current revision."
        actions={
          <Button variant="outline" size="sm" onClick={() => setShowAll(v => !v)}>
            {showAll ? "Waiting only" : "Show all"}
          </Button>
        }
      />
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {!rows ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground py-12 text-center">No access requests waiting.</p>
      ) : (
        <div className="space-y-2">
          {visible.map(r => {
            const target = r.willSend ?? r.requested;
            const link = target ? itemDeepLink(r.projectId, target.itemType, target.id) : null;
            const newer = r.willSend && r.requested && r.willSend.id !== r.requested.id;
            return (
              <div key={r.id} id={`req-${r.id}`}>
                <ListRow
                  className={cn("bg-card", focusId === r.id && "ring-2 ring-primary/40")}
                  content={
                    <div className="space-y-1">
                      <p className="font-semibold break-words">
                        {r.name}{r.organisation ? <span className="font-normal text-muted-foreground">, {r.organisation}</span> : null}
                      </p>
                      <p className="text-sm text-muted-foreground break-all">{r.email}</p>
                      <p className="text-sm break-words">
                        Wants{" "}
                        {link ? <Link href={link} className="font-medium text-primary hover:underline">{r.requested?.name ?? target?.name}</Link> : <span className="font-medium">{r.requested?.name ?? "a removed item"}</span>}
                        {r.requested?.revisionLabel ? ` (${r.requested.revisionLabel})` : ""} on {r.projectName}
                      </p>
                      {r.status === "pending" && (
                        <p className="text-xs text-muted-foreground break-words">
                          {r.willSend
                            ? newer ? `Approving sends the current one: ${r.willSend.revisionLabel ?? r.willSend.name}.` : "Approving emails them a new 30 day link."
                            : "There's no current revision to send, so this can only be declined."}
                        </p>
                      )}
                      {r.note && <p className="text-sm italic text-muted-foreground break-words">"{r.note}"</p>}
                      <p className="text-xs text-muted-foreground">
                        Asked {fmt(r.createdAt)}{r.sentByName ? `, link sent by ${r.sentByName}` : ""}
                        {r.decidedAt ? `. ${STATUS[r.status].label} by ${r.decidedByName ?? "someone"} on ${fmt(r.decidedAt)}` : ""}
                      </p>
                    </div>
                  }
                  actions={
                    r.canDecide ? (
                      <>
                        <Button size="sm" disabled={busy === r.id || !r.willSend} onClick={() => decide(r.id, true)}>
                          {busy === r.id ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Check className="w-4 h-4 mr-1" />} Approve
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => decide(r.id, false)}>
                          <X className="w-4 h-4 mr-1" /> Decline
                        </Button>
                      </>
                    ) : (
                      <PillGroup><Pill className={STATUS[r.status].cls}>{STATUS[r.status].label}</Pill></PillGroup>
                    )
                  }
                />
              </div>
            );
          })}
        </div>
      )}
    </SidebarLayout>
  );
}
