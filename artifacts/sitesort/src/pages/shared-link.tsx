import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { UpdateBar } from "@/components/update-bar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { FileText, ShieldCheck, Clock, AlertTriangle, CheckCircle2, Loader2, ExternalLink } from "lucide-react";

// Public landing page for a per-share link (#127 Part B): /s/<token>. Shows
// what was shared and which revision, so whoever opens it can check it against
// what they expected. A link that no longer works (expired after 30 days, a
// newer revision issued, or stopped by the sender) offers a request-access
// form; the sender or a project approver decides. No login, deliberately
// outside SidebarLayout/PortalLayout like /site/:token and /guide.

type State = "ok" | "expired" | "superseded" | "revoked" | "removed" | "not_found";
type Landing = {
  state: State;
  message?: string;
  item: { itemType: "document" | "permit"; name: string; revisionLabel: string | null; detail: string | null } | null;
  projectName: string | null;
  companyName: string | null;
  sharedBy: string | null;
  sharedAt: string;
  expiresAt: string;
  canRequestAccess: boolean;
};

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

const DEAD: Record<Exclude<State, "ok">, { title: string; body: string }> = {
  expired: { title: "This link has expired", body: "Shared links work for 30 days." },
  superseded: { title: "A newer revision has replaced this", body: "This link was for an older revision, so it no longer opens." },
  revoked: { title: "This link has been stopped", body: "The person who sent it has stopped it working." },
  removed: { title: "This is no longer available", body: "It has been removed, so it can't be opened or requested." },
  not_found: { title: "This link isn't valid", body: "Check you have the whole link, or ask the person who sent it." },
};

export default function SharedLinkPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Landing | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    fetch(`/api/share/${encodeURIComponent(token)}`)
      .then(async r => {
        const d = await r.json().catch(() => null);
        if (d && typeof d.state === "string") setData(d);
        else setLoadError(true);
      })
      .catch(() => setLoadError(true));
  }, [token]);

  return (
    <div className="min-h-screen bg-background">
      <UpdateBar />
      <div className="border-b bg-card">
        <div className="max-w-xl mx-auto px-4 py-4 flex items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}images/logo.webp?v=5`} alt="SiteSort" className="h-10 w-auto" />
        </div>
      </div>
      <div className="max-w-xl mx-auto px-4 py-6">
        {loadError ? (
          <Message icon={<AlertTriangle className="w-5 h-5 text-amber-600" />} title="This page didn't load" body="Check your connection and try again." />
        ) : !data ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <Content token={token} data={data} />
        )}
      </div>
    </div>
  );
}

function Content({ token, data }: { token: string; data: Landing }) {
  const from = [data.sharedBy, data.companyName].filter(Boolean).join(" at ");
  return (
    <div className="space-y-4">
      {data.item && (
        <div className="rounded-xl border bg-card p-4 sm:p-5 space-y-3">
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              {data.item.itemType === "permit" ? <ShieldCheck className="w-5 h-5 text-primary" /> : <FileText className="w-5 h-5 text-primary" />}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="font-display font-bold text-lg leading-snug break-words">{data.item.name}</h1>
              {data.projectName && <p className="text-sm text-muted-foreground break-words">{data.projectName}</p>}
            </div>
          </div>
          {data.item.revisionLabel && (
            <span className="inline-flex max-w-full px-2.5 py-1 rounded-full bg-primary/10 text-primary text-sm font-semibold break-words">
              {data.item.revisionLabel}
            </span>
          )}
          {data.item.detail && <p className="text-sm text-muted-foreground break-words">{data.item.detail}</p>}
          {from && <p className="text-xs text-muted-foreground break-words">Shared by {from} on {fmt(data.sharedAt)}</p>}
        </div>
      )}

      {data.state === "ok" ? (
        <div className="space-y-3">
          <a
            href={`/api/share/${encodeURIComponent(token)}/file`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full inline-flex items-center justify-center gap-2 h-11 px-6 rounded-md bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors"
          >
            <ExternalLink className="w-4 h-4" /> Open
          </a>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Clock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>This link works until {fmt(data.expiresAt)}, or until a newer revision replaces it.</span>
          </p>
        </div>
      ) : (
        <>
          <Message
            icon={<AlertTriangle className="w-5 h-5 text-amber-600" />}
            title={DEAD[data.state].title}
            body={data.state === "not_found" && data.message ? data.message : DEAD[data.state].body}
          />
          {data.canRequestAccess && <RequestAccess token={token} superseded={data.state === "superseded"} />}
        </>
      )}
    </div>
  );
}

function Message({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 flex items-start gap-3">
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div className="min-w-0">
        <p className="font-semibold break-words">{title}</p>
        <p className="text-sm text-muted-foreground break-words">{body}</p>
      </div>
    </div>
  );
}

function RequestAccess({ token, superseded }: { token: string; superseded: boolean }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim()) { setError("Enter your name and email address."); return; }
    setSending(true);
    try {
      const r = await fetch(`/api/share/${encodeURIComponent(token)}/request-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, organisation, note }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setSent(true);
      else setError(d.message ?? "Your request couldn't be sent. Try again.");
    } catch {
      setError("Your request couldn't be sent. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <Message
        icon={<CheckCircle2 className="w-5 h-5 text-green-600" />}
        title="Request sent"
        body="If it's approved, you'll get an email with a link to the current revision."
      />
    );
  }

  return (
    <form onSubmit={submit} className="rounded-xl border bg-card p-4 sm:p-5 space-y-3">
      <div>
        <p className="font-semibold">Request access</p>
        <p className="text-sm text-muted-foreground">
          {superseded
            ? "Ask for the current revision. The person who sent this, or a project manager, will decide."
            : "Ask for a new link. The person who sent this, or a project manager, will decide."}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
        <div className="space-y-1.5">
          <Label htmlFor="ra-name">Your name</Label>
          <Input id="ra-name" value={name} onChange={e => setName(e.target.value)} autoComplete="name" maxLength={120} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ra-email">Email</Label>
          <Input id="ra-email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" maxLength={200} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ra-org">Company (optional)</Label>
        <Input id="ra-org" value={organisation} onChange={e => setOrganisation(e.target.value)} autoComplete="organization" maxLength={160} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ra-note">Why you need it (optional)</Label>
        <Textarea id="ra-note" value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={1000} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" className="w-full" disabled={sending}>
        {sending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Send request
      </Button>
    </form>
  );
}
