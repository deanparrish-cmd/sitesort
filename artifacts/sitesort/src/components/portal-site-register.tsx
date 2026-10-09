import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { StatusPill, PortalButton } from "@/components/portal-ui";
import { Pill, PillGroup } from "@/components/ui/list-row";
import { RefreshCw, Users, WifiOff, Clock, AlertTriangle, CheckCircle2, XCircle, LogOut, Phone, ShieldAlert } from "lucide-react";

// Team Portal site register (#124): the fire roll for the designated site
// manager and anyone given PM cover. It must work with no signal (basements,
// steel frames), so every successful load is saved on the device and shown
// straight away next time, with the time it was taken shown prominently. A
// copy is only ever as good as its age, so the age drives the colour.

type Row = { id: string; workerName: string; companyName: string | null; checkedInAt: string; autoClosedAt?: string | null };
type HeldRow = Row & {
  holdReason: string; why: string; typedPhone: string | null; photoUrl: string | null;
  claimed: { name: string; company: string | null } | null; insurance: string | null;
};
export type SiteRegister = {
  projectId: string; projectName: string; generatedAt: string; siteTimeZone: string; siteTzLabel: string; siteDate: string;
  onSite: Row[]; notSignedOut: Row[]; held: HeldRow[];
};
type Cached = { data: SiteRegister; savedAt: string };

const CACHE_PREFIX = "sitesort_site_register:";
const CACHE_LAST = "sitesort_site_register_last";
const REFRESH_MS = 30_000;
const FRESH_MS = 2 * 60_000;      // under 2 minutes old: current
const OLD_MS = 15 * 60_000;       // over 15 minutes old: treat as out of date

function readCache(projectId?: string | null): Cached | null {
  try {
    const id = projectId || localStorage.getItem(CACHE_LAST);
    if (!id) return null;
    const raw = localStorage.getItem(CACHE_PREFIX + id);
    return raw ? (JSON.parse(raw) as Cached) : null;
  } catch { return null; }
}
function writeCache(data: SiteRegister): Cached {
  const c = { data, savedAt: data.generatedAt };
  try {
    localStorage.setItem(CACHE_PREFIX + data.projectId, JSON.stringify(c));
    localStorage.setItem(CACHE_LAST, data.projectId);
  } catch { /* storage full or blocked: still shown on screen */ }
  return c;
}
/** Explicit portal logout removes the saved registers from this device. */
export function clearSiteRegisterCaches(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && (k.startsWith(CACHE_PREFIX) || k === CACHE_LAST)) localStorage.removeItem(k);
    }
  } catch { /* nothing saved */ }
}
/** The most recent saved register on this device, for the login screen. */
export function lastSavedRegister(): { projectName: string; savedAt: string } | null {
  const c = readCache();
  return c ? { projectName: c.data.projectName, savedAt: c.savedAt } : null;
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
function ago(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60} min ago` : `${Math.floor(h / 24)} day${h >= 48 ? "s" : ""} ago`;
}
function sameDay(a: string, b: Date) {
  return new Date(a).toDateString() === b.toDateString();
}

// The age banner: the first thing the site manager reads before counting heads.
// live: true = the last refresh worked, false = it failed (no signal), null = still checking.
function LastUpdated({ savedAt, live, refreshing, onRefresh, now }: { savedAt: string; live: boolean | null; refreshing?: boolean; onRefresh?: () => void; now: Date }) {
  const age = now.getTime() - new Date(savedAt).getTime();
  const notToday = !sameDay(savedAt, now);
  const tone: "good" | "warning" | "bad" = notToday || age > OLD_MS ? "bad" : live !== true || age > FRESH_MS ? "warning" : "good";
  const box = { good: "border-success bg-success/10", warning: "border-warning bg-warning/15", bad: "border-destructive bg-destructive/10" }[tone];
  return (
    <div className={cn("rounded-2xl border-2 p-4 space-y-2", box)} data-testid="register-last-updated" data-tone={tone}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Clock className="w-5 h-5 shrink-0" />
        <span className="text-sm font-bold uppercase tracking-wide">Last updated</span>
        <StatusPill tone={tone} icon={live === false ? <WifiOff className="w-4 h-4" /> : undefined}>{live === null ? "Checking" : live ? (tone === "good" ? "Live" : "Delayed") : "No signal"}</StatusPill>
      </div>
      <p className="text-4xl font-display font-bold tabular-nums leading-none">{hhmm(savedAt)}</p>
      <p className="text-base font-semibold">
        {notToday ? `Saved ${new Date(savedAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}, not today. ` : `${ago(age)}. `}
        {live === false && "This is the copy saved on your phone. People may have arrived or left since."}
      </p>
      {onRefresh && (
        <PortalButton tone="outline" onClick={onRefresh} disabled={refreshing} icon={<RefreshCw className={cn("w-5 h-5", refreshing && "animate-spin")} />}>
          {refreshing ? "Refreshing" : "Refresh now"}
        </PortalButton>
      )}
    </div>
  );
}

function PersonLine({ r, action }: { r: Row; action?: React.ReactNode }) {
  return (
    <li className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-3 border-b last:border-b-0 min-w-0">
      <div className="min-w-0 flex-1">
        <p className="text-lg font-bold break-words">{r.workerName}</p>
        <p className="text-sm text-muted-foreground break-words">{r.companyName || "No company given"} · in at {hhmm(r.checkedInAt)}</p>
      </div>
      {action}
    </li>
  );
}

// The read-only roll: used live, and on its own from the login screen.
function Roll({ data, onSignOut }: { data: SiteRegister; onSignOut?: (r: Row) => void }) {
  return (
    <>
      <section className="rounded-2xl border bg-card overflow-hidden" data-testid="register-on-site">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b bg-muted/40">
          <Users className="w-6 h-6 shrink-0" />
          <h2 className="text-xl font-display font-bold">On site now</h2>
          <span className="ml-auto text-3xl font-display font-bold tabular-nums" data-testid="register-on-site-count">{data.onSite.length}</span>
        </div>
        {data.onSite.length === 0
          ? <p className="px-4 py-6 text-base text-muted-foreground">Nobody is signed in.</p>
          : <ul>{data.onSite.map(r => <PersonLine key={r.id} r={r} action={onSignOut && (
              <PortalButton tone="outline" full={false} onClick={() => onSignOut(r)} icon={<LogOut className="w-5 h-5" />}>Sign out</PortalButton>
            )} />)}</ul>}
      </section>
      {data.notSignedOut.length > 0 && (
        <section className="rounded-2xl border border-warning bg-card overflow-hidden" data-testid="register-not-signed-out">
          <div className="px-4 py-3 border-b bg-warning/15">
            <h2 className="text-lg font-display font-bold">Didn't sign out ({data.notSignedOut.length})</h2>
            <p className="text-sm">Signed in today but never signed out before the site closed. Check whether they are still here.</p>
          </div>
          <ul>{data.notSignedOut.map(r => <PersonLine key={r.id} r={r} action={onSignOut && (
            <PortalButton tone="outline" full={false} onClick={() => onSignOut(r)} icon={<LogOut className="w-5 h-5" />}>Confirm left</PortalButton>
          )} />)}</ul>
        </section>
      )}
    </>
  );
}

function HeldCard({ h, online, onDone }: { h: HeldRow; online: boolean; onDone: (msg: string) => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const decide = async (decision: "approve" | "refuse") => {
    if (decision === "approve" && !note.trim()) { setErr("Give a reason for letting them on site."); return; }
    setBusy(true); setErr("");
    try {
      const r = await fetch(`/api/portal/site-register/${h.id}/hold-decision`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, note: note.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.message ?? "That didn't save. Try again."); return; }
      onDone(decision === "approve"
        ? `${h.workerName} is signed in.${d.phoneFiled ? " Their mobile number is now on file." : ""}`
        : `${h.workerName} has been refused.`);
    } catch {
      setErr("No signal. Try again when you have signal.");
    } finally { setBusy(false); }
  };
  const insuranceBad = h.insurance === "expired" || h.insurance === "none";
  return (
    <li className="rounded-2xl border-2 border-warning bg-card p-4 space-y-3 min-w-0" data-testid="register-held">
      <div className="flex flex-col sm:flex-row gap-3 min-w-0">
        {h.photoUrl && <img src={h.photoUrl} alt={`Gate photo of ${h.workerName}`} onError={e => { e.currentTarget.style.display = "none"; }} className="w-full sm:w-32 max-h-48 object-cover rounded-xl bg-muted shrink-0" />}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-lg font-bold break-words">{h.workerName}</p>
          <p className="text-sm text-muted-foreground break-words">{h.companyName || "No company given"} · at the gate since {hhmm(h.checkedInAt)}</p>
          <PillGroup>
            {h.holdReason === "unverified" && <Pill className="bg-warning/20 text-foreground">Mobile not on file</Pill>}
            {(h.holdReason === "insurance_none" || h.holdReason === "insurance_expired" || insuranceBad) && <Pill className="bg-destructive/15 text-destructive" icon={<ShieldAlert className="w-3.5 h-3.5" />}>{h.holdReason === "insurance_expired" || h.insurance === "expired" ? "Insurance expired" : "No insurance on file"}</Pill>}
          </PillGroup>
          {h.typedPhone && <p className="text-sm flex items-center gap-1.5 break-all"><Phone className="w-4 h-4 shrink-0" /> Gave {h.typedPhone}</p>}
          {h.holdReason === "unverified" && (
            <p className="text-sm break-words">{h.claimed
              ? <>Matches <strong>{h.claimed.name}</strong>{h.claimed.company ? `, ${h.claimed.company}` : ""} on this project. Approving saves this number to their record.</>
              : <>Not on this project's team under that name and company. Check who they are before letting them on.</>}</p>
          )}
        </div>
      </div>
      <div>
        <label htmlFor={`hold-note-${h.id}`} className="block text-sm font-semibold mb-1">Reason (needed to let them on)</label>
        <input id={`hold-note-${h.id}`} value={note} onChange={e => setNote(e.target.value)} disabled={!online || busy}
          placeholder="e.g. Checked photo ID; certificate to follow"
          className="w-full min-w-0 border-2 border-input rounded-xl px-4 min-h-14 text-base bg-background" />
      </div>
      {err && <p className="text-sm text-destructive font-semibold">{err}</p>}
      {!online && <p className="text-sm font-semibold">You need signal to approve or refuse.</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <PortalButton tone="success" onClick={() => decide("approve")} disabled={!online || busy} icon={<CheckCircle2 className="w-5 h-5" />}>Let on site</PortalButton>
        <PortalButton tone="danger-outline" onClick={() => decide("refuse")} disabled={!online || busy} icon={<XCircle className="w-5 h-5" />}>Refuse</PortalButton>
      </div>
    </li>
  );
}

function SignOutPanel({ r, online, onCancel, onDone }: { r: Row; online: boolean; onCancel: () => void; onDone: (msg: string) => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    if (!note.trim()) { setErr("Add a note, e.g. Left at 4pm, forgot to sign out."); return; }
    setBusy(true); setErr("");
    try {
      const res = await fetch(`/api/portal/site-register/${r.id}/sign-out`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: note.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.message ?? "That didn't save. Try again."); return; }
      onDone(`${r.workerName} is signed out.`);
    } catch { setErr("No signal. Try again when you have signal."); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-2xl border-2 border-primary bg-card p-4 space-y-3" data-testid="register-sign-out-panel">
      <p className="text-lg font-bold break-words">Sign out {r.workerName}</p>
      <label htmlFor="register-signout-note" className="block text-sm font-semibold">Note</label>
      <input id="register-signout-note" value={note} onChange={e => setNote(e.target.value)} disabled={!online || busy}
        placeholder="e.g. Left at 4pm, forgot to sign out"
        className="w-full min-w-0 border-2 border-input rounded-xl px-4 min-h-14 text-base bg-background" />
      {err && <p className="text-sm text-destructive font-semibold">{err}</p>}
      {!online && <p className="text-sm font-semibold">You need signal to sign someone out.</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <PortalButton onClick={submit} disabled={!online || busy} icon={<LogOut className="w-5 h-5" />}>Sign out</PortalButton>
        <PortalButton tone="outline" onClick={onCancel}>Cancel</PortalButton>
      </div>
    </div>
  );
}

function useNow(ms = 10_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

/** The live register inside the portal. `projectId` comes from the portal context when it loaded. */
export function SiteRegisterView({ projectId }: { projectId?: string | null }) {
  const [cached, setCached] = useState<Cached | null>(() => readCache(projectId));
  const [live, setLive] = useState<boolean | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [denied, setDenied] = useState(false);
  const [signingOut, setSigningOut] = useState<Row | null>(null);
  const [flash, setFlash] = useState("");
  const now = useNow();

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await fetch("/api/portal/site-register", { cache: "no-store" });
      if (r.status === 403) { setDenied(true); setLive(true); return; }
      if (!r.ok) throw new Error(String(r.status));
      const data = (await r.json()) as SiteRegister;
      setCached(writeCache(data));
      setLive(true);
      setDenied(false);
    } catch {
      setLive(false);
    } finally { setRefreshing(false); }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, REFRESH_MS);
    const onOnline = () => void load();
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(t); window.removeEventListener("online", onOnline); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  const done = (msg: string) => { setFlash(msg); setSigningOut(null); void load(); };

  if (denied) {
    return <p className="text-base">Only the site manager, or someone covering for the project manager, can see the site register.</p>;
  }
  if (!cached) {
    return (
      <div className="space-y-3" data-testid="register-empty">
        <h1 className="text-2xl font-display font-bold">Site register</h1>
        <p className="text-base">{refreshing ? "Loading the register." : "No signal, and no saved copy on this phone yet. Open this page once with signal and it will be saved for later."}</p>
        {!refreshing && <PortalButton tone="outline" onClick={() => void load()} icon={<RefreshCw className="w-5 h-5" />}>Try again</PortalButton>}
      </div>
    );
  }
  const data = cached.data;
  return (
    <div className="space-y-4 min-w-0" data-testid="site-register">
      <div className="min-w-0">
        <h1 className="text-2xl font-display font-bold">Site register</h1>
        <p className="text-sm text-muted-foreground break-words">{data.projectName} · times in {data.siteTzLabel}</p>
      </div>
      <LastUpdated savedAt={cached.savedAt} live={live} refreshing={refreshing} onRefresh={() => void load()} now={now} />
      {flash && (
        <div className="rounded-xl border-2 border-success bg-success/10 p-3 flex flex-wrap items-center gap-2" role="status">
          <CheckCircle2 className="w-5 h-5 shrink-0" /><span className="text-base font-semibold min-w-0 break-words">{flash}</span>
        </div>
      )}
      {data.held.length > 0 && (
        <a href="#register-gate" className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-warning bg-warning/15 px-4 min-h-14 py-2 font-bold" data-testid="register-gate-link">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span className="min-w-0">{data.held.length} waiting at the gate: see below</span>
        </a>
      )}
      {signingOut && <SignOutPanel r={signingOut} online={live === true} onCancel={() => setSigningOut(null)} onDone={done} />}
      {/* The fire roll comes first; the gate queue follows (they're not on site yet). */}
      <Roll data={data} onSignOut={r => { setFlash(""); setSigningOut(r); }} />
      {data.held.length > 0 && (
        <section id="register-gate" className="space-y-3 scroll-mt-4" data-testid="register-gate">
          <div className="flex flex-wrap items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-warning shrink-0" />
            <h2 className="text-xl font-display font-bold">Waiting at the gate ({data.held.length})</h2>
          </div>
          <p className="text-sm">Not on site yet, and not on the fire roll until you let them on.</p>
          <ul className="space-y-3">{data.held.map(h => <HeldCard key={h.id} h={h} online={live === true} onDone={done} />)}</ul>
        </section>
      )}
    </div>
  );
}

/** Standalone saved copy, opened from the portal login screen with no session and no signal. */
export function SiteRegisterCopyPage() {
  const [cached] = useState<Cached | null>(() => readCache());
  const now = useNow();
  return (
    <div className="min-h-screen w-full bg-background p-4 pt-[calc(1rem+env(safe-area-inset-top))]">
      <div className="max-w-2xl mx-auto space-y-4 min-w-0">
        <Link href="/portal/login" className="inline-flex items-center min-h-11 text-sm font-semibold underline">Back to sign in</Link>
        {!cached ? (
          <p className="text-base">There's no saved site register on this phone.</p>
        ) : (
          <>
            <div className="min-w-0">
              <h1 className="text-2xl font-display font-bold">Saved site register</h1>
              <p className="text-sm text-muted-foreground break-words">{cached.data.projectName} · times in {cached.data.siteTzLabel}</p>
            </div>
            <LastUpdated savedAt={cached.savedAt} live={false} now={now} />
            <p className="text-sm">Sign in with signal to refresh it, approve people at the gate or sign someone out.</p>
            <Roll data={cached.data} />
          </>
        )}
      </div>
    </div>
  );
}
