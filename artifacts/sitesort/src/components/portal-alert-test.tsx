import { useEffect, useRef, useState } from "react";
import { BellRing, Smartphone, Trash2 } from "lucide-react";
import type { PortalPushDevice, PortalPushDevices, PortalPushTestResult } from "@workspace/api-client-react";
import { ListRow, Pill, PillGroup } from "@/components/ui/list-row";
import { PortalButton } from "@/components/portal-ui";
import { portalPushCall, thisDeviceId, isIOS } from "@/lib/portal-push";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// Phone alert receipts (2026-10-22). Apple or Google accepting an alert proves
// nothing about the screen (a gate hold: 4 of 4 accepted, no banner), so each
// phone reports back when an alert arrives. This card sends a test to every
// phone on this login, shows what each phone said, and asks "Did a banner
// appear?": a phone that reported the alert but showed no banner is hiding it
// (Focus, Do Not Disturb, banners off); one that never reported is a dead
// install. The answer is recorded and shown to the project manager.

const SEND_DELAY_S = 10;
const REPLY_WINDOW_MS = 60_000;

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "numeric", month: "short" }) + ", " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

type Phase = { kind: "idle" } | { kind: "countdown"; left: number } | { kind: "sent"; at: number };

export function PortalAlertTestCard({ subscribed }: { subscribed: boolean }) {
  const { toast } = useToast();
  const [devices, setDevices] = useState<PortalPushDevice[] | null>(null);
  const [pruneAfter, setPruneAfter] = useState(7);
  const [loadFailed, setLoadFailed] = useState(false);
  const [mine, setMine] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, tick] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    const r = await portalPushCall<PortalPushDevices>("devices");
    if (r.status === 200 && r.data) { setDevices(r.data.devices); setPruneAfter(r.data.pruneAfter); setLoadFailed(false); }
    else setLoadFailed(true);
  };
  useEffect(() => { void load(); thisDeviceId().then(setMine); }, [subscribed]);

  // Opened by tapping the test alert: bring this card into view.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("alertTest")) cardRef.current?.scrollIntoView({ block: "start" });
  }, []);

  // While a test is out, ask every 3 s what the phones have said.
  const testOut = phase.kind === "sent" && Date.now() - phase.at < REPLY_WINDOW_MS + 5000;
  useEffect(() => {
    if (!testOut) return;
    const t = setInterval(() => { void load(); tick(n => n + 1); }, 3000);
    return () => clearInterval(t);
  }, [testOut]);

  // Coming back to the app after locking the phone: refresh straight away.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // The countdown is display only. The server waits SEND_DELAY_S before
  // sending, so locking the phone (which pauses this page) can't stop the test.
  const start = async () => {
    const req = portalPushCall<PortalPushTestResult & { message?: string }>("test", { delaySeconds: SEND_DELAY_S });
    let done = false;
    void req.finally(() => { done = true; });
    for (let left = SEND_DELAY_S; left > 0 && !done; left--) {
      setPhase({ kind: "countdown", left });
      await new Promise(r => setTimeout(r, 1000));
    }
    const r = await req;
    if (r.status !== 200) {
      setPhase({ kind: "idle" });
      toast({
        title: "Test alert not sent",
        description: r.status === 0 ? "SiteSort couldn't be reached. Check your signal and try again." : r.data?.message ?? "Try again in a minute.",
        variant: "destructive",
      });
      return;
    }
    setPhase({ kind: "sent", at: Date.now() });
    void load();
  };

  const answer = async (alertId: string, a: "yes" | "no", question: "banner" | "icon") => {
    setBusyId(alertId);
    const r = await portalPushCall("test-answer", { alertId, answer: a, question });
    setBusyId(null);
    if (r.status !== 200) { toast({ title: "Answer not saved", description: "Check your signal and try again.", variant: "destructive" }); return; }
    void load();
  };

  const remove = async (deviceId: string) => {
    setBusyId(deviceId);
    const r = await portalPushCall("devices/remove", { deviceId });
    setBusyId(null);
    if (r.status !== 200) { toast({ title: "Phone not removed", description: "Check your signal and try again.", variant: "destructive" }); return; }
    toast({ title: "Removed", description: "That phone no longer gets SiteSort alerts." });
    void load();
  };

  if (!subscribed && (!devices || devices.length === 0)) return null;

  return (
    <div ref={cardRef} className="bg-card border border-border rounded-2xl p-5 space-y-4" data-testid="card-alert-test">
      <div className="min-w-0">
        <p className="font-bold text-base">Test your phone alerts</p>
        <p className="text-sm text-muted-foreground mt-0.5">
          Check that alerts really reach you, for example when someone is waiting at the gate.
          We send a test alert {SEND_DELAY_S} seconds after you tap. Lock your phone straight away and watch for a banner.
          Then unlock it and, before you open SiteSort, look for a number on the SiteSort icon.
        </p>
      </div>
      {phase.kind === "countdown" ? (
        <div className="rounded-xl border-2 border-primary/40 bg-primary/5 p-4 text-center" role="status">
          <p className="text-2xl font-extrabold">{phase.left}</p>
          <p className="text-base font-bold">Lock your phone now</p>
          <p className="text-sm text-muted-foreground">Watch for a banner. Then unlock and look at the SiteSort icon before you open SiteSort.</p>
        </div>
      ) : (
        <PortalButton onClick={start} disabled={phase.kind === "sent" && testOut} icon={<BellRing className="w-5 h-5" />}>
          {phase.kind === "sent" && testOut ? "Test alert sent" : "Send a test alert"}
        </PortalButton>
      )}

      {loadFailed && !devices && <p className="text-sm text-destructive font-semibold">Couldn't load your phones. Check your signal.</p>}
      {devices && devices.length === 0 && (
        <p className="text-sm text-muted-foreground">No phone is set up for alerts yet. Tap Turn on above first.</p>
      )}
      {devices && devices.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-muted-foreground">Phones that get your alerts</p>
          {devices.map(d => (
            <DeviceRow key={d.deviceId} d={d} isMine={d.deviceId === mine} pruneAfter={pruneAfter}
              busy={busyId === d.deviceId || busyId === d.lastTest?.alertId}
              onAnswer={answer} onRemove={() => remove(d.deviceId)} />
          ))}
        </div>
      )}
    </div>
  );
}

function DeviceRow({ d, isMine, pruneAfter, busy, onAnswer, onRemove }: {
  d: PortalPushDevice; isMine: boolean; pruneAfter: number; busy: boolean;
  onAnswer: (alertId: string, a: "yes" | "no", question: "banner" | "icon") => void; onRemove: () => void;
}) {
  const t = d.lastTest;
  const fresh = t && Date.now() - new Date(t.sentAt).getTime() < 15 * 60_000;
  const waited = t ? Date.now() - new Date(t.sentAt).getTime() > REPLY_WINDOW_MS : false;

  let line: { text: string; tone: "ok" | "warn" | "bad" | "muted" };
  if (fresh && t) {
    if (t.sendResult === "gone") line = { text: "This phone's alert registration had expired, so it has been removed. Open SiteSort on that phone to set it up again.", tone: "bad" };
    else if (t.sendResult === "failed") line = { text: "Couldn't send to this phone. Try again in a minute.", tone: "bad" };
    else if (t.outcome === "show_failed") line = { text: `The alert reached this phone, but SiteSort couldn't show it${t.showError ? ` (${t.showError})` : ""}. Remove SiteSort from the Home Screen, add it again and turn alerts on.`, tone: "bad" };
    else if (t.outcome === "arrived_no_result") line = { text: "The alert reached this phone, but it stopped before showing it.", tone: "bad" };
    else if (t.outcome === "not_posted") line = { text: "This phone said it showed the alert, but it isn't in the phone's notifications.", tone: "bad" };
    else if (t.outcome === "displayed_app_open") line = { text: `Test alert reached this phone at ${fmtTime(t.receivedAt ?? t.sentAt)}, while SiteSort was open on screen. An iPhone shows no banner over the open app: lock the phone and test again.`, tone: "warn" };
    else if (t.receivedAt || t.outcome === "displayed") line = { text: `Test alert reached this phone at ${fmtTime(t.receivedAt ?? t.sentAt)}${t.tappedAt ? " and was tapped" : ""}.`, tone: "ok" };
    else if (t.outcome === "no_receipt_old_app") line = { text: "This phone has an older copy of SiteSort that can't reply. Open SiteSort on it, then send another test.", tone: "warn" };
    else if (!waited) line = { text: "Waiting for this phone to reply.", tone: "muted" };
    else line = { text: "No reply from this phone. The alert didn't reach it.", tone: "bad" };
  } else if (d.lastConfirmedAt) {
    line = { text: `Last alert reached this phone: ${fmtTime(d.lastConfirmedAt)}.`, tone: "ok" };
  } else {
    line = { text: "This phone has never told SiteSort an alert arrived. Send a test alert to check it.", tone: "warn" };
  }

  // Ask once the result is in: the phone replied, or the reply window passed.
  const settled = !!(fresh && t && t.sendResult === "accepted" && (t.receivedAt || waited));
  const askBanner = settled && !t!.bannerAnswer;
  const askIcon = settled && !t!.iconAnswer;
  const answered = fresh && t?.bannerAnswer ? t : null;
  const iconAnswered = fresh && t?.iconAnswer ? t : null;

  return (
    <ListRow
      className={cn(isMine && "border-primary/40")}
      content={
        <div className="space-y-1.5 min-w-0">
          <PillGroup>
            <span className="inline-flex items-center gap-1.5 font-bold text-base min-w-0"><Smartphone className="w-4 h-4 shrink-0" /> <span className="truncate">{d.label}</span></span>
            {isMine && <Pill className="bg-primary/10 text-primary">This phone</Pill>}
          </PillGroup>
          <p className={cn("text-sm", line.tone === "ok" && "text-emerald-700 dark:text-emerald-400", line.tone === "warn" && "text-amber-700 dark:text-amber-400", line.tone === "bad" && "text-destructive font-semibold", line.tone === "muted" && "text-muted-foreground")}>{line.text}</p>
          {d.unansweredInARow > 0 && d.lastConfirmedAt && !(fresh && t?.receivedAt) && (
            <p className="text-sm text-muted-foreground">{d.unansweredInARow} alert{d.unansweredInARow === 1 ? "" : "s"} in a row with no reply. A phone is removed after {pruneAfter} in a row; opening SiteSort on it sets it up again.</p>
          )}
          {askBanner && t && (
            <div className="space-y-2 pt-1" data-testid="banner-question">
              <p className="text-base font-bold">Did a banner appear on this phone?</p>
              <div className="flex flex-wrap gap-2">
                <PortalButton full={false} tone="outline" disabled={busy} onClick={() => onAnswer(t.alertId, "yes", "banner")}>Yes</PortalButton>
                <PortalButton full={false} tone="outline" disabled={busy} onClick={() => onAnswer(t.alertId, "no", "banner")}>No, nothing appeared</PortalButton>
              </div>
            </div>
          )}
          {answered && <BannerAdvice answer={answered.bannerAnswer!} reached={!!answered.receivedAt} label={d.label} />}
          {askIcon && t && (
            <div className="space-y-2 pt-1" data-testid="icon-question">
              <p className="text-base font-bold">Did a number appear on the SiteSort icon?</p>
              <p className="text-sm text-muted-foreground">On your Home Screen, before you opened SiteSort. Opening it changes the number.</p>
              <div className="flex flex-wrap gap-2">
                <PortalButton full={false} tone="outline" disabled={busy} onClick={() => onAnswer(t.alertId, "yes", "icon")}>Yes</PortalButton>
                <PortalButton full={false} tone="outline" disabled={busy} onClick={() => onAnswer(t.alertId, "no", "icon")}>No number</PortalButton>
              </div>
            </div>
          )}
          {iconAnswered && <IconAdvice answer={iconAnswered.iconAnswer!} badgeResult={iconAnswered.badgeResult} label={d.label} />}
        </div>
      }
      actions={!isMine ? (
        <button type="button" onClick={onRemove} disabled={busy}
          className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-xl border-2 border-border text-sm font-bold hover:bg-muted disabled:opacity-50">
          <Trash2 className="w-4 h-4" /> Remove
        </button>
      ) : undefined}
    />
  );
}

// "Did a number appear on the SiteSort icon?" The phone's own report says
// whether it accepted the number (badgeResult); the person says whether it
// showed. Accepted but not shown = Badges is off in Settings, or SiteSort was
// opened from Safari instead of the Home Screen icon.
function IconAdvice({ answer, badgeResult, label }: { answer: string; badgeResult: string | null; label: string }) {
  if (answer === "yes") {
    return <p className="text-sm text-emerald-700 dark:text-emerald-400">Thanks. The SiteSort icon shows how many people are waiting at the gate. Your project manager can see this.</p>;
  }
  const apple = /iPhone|iPad/.test(label) || isIOS();
  if (badgeResult === "unsupported") {
    return (
      <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 text-sm space-y-1">
        <p className="font-bold">This phone can't show a number on the SiteSort icon.</p>
        <p>{apple ? "Open SiteSort from its Home Screen icon, not from Safari, then send another test." : "Alerts still work. Check the Site Register when you get one."}</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 text-sm space-y-1">
      <p className="font-bold">{badgeResult?.startsWith("set:") ? "The phone took the number, but it's hidden." : "No number showed on the icon."}</p>
      {apple ? (
        <p>On the {label.includes("iPad") ? "iPad" : "iPhone"}: Settings, then Notifications, then SiteSort. Turn on Badges. Use SiteSort from its Home Screen icon.</p>
      ) : (
        <p>In the phone's settings, find SiteSort or your browser under Notifications (or Apps) and turn on app icon badges or dots.</p>
      )}
      <p>Then send another test. Your project manager can see your answer.</p>
    </div>
  );
}

function BannerAdvice({ answer, reached, label }: { answer: string; reached: boolean; label: string }) {
  if (answer === "yes") {
    return <p className="text-sm text-emerald-700 dark:text-emerald-400">Thanks. Alerts work on this phone. Your project manager can see this.</p>;
  }
  const apple = /iPhone|iPad/.test(label) || isIOS();
  if (reached) {
    return (
      <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 text-sm space-y-1">
        <p className="font-bold">The alert reached this phone, but the phone hid it.</p>
        {apple ? (
          <p>On the iPhone: Settings, then Notifications, then SiteSort. Turn on Allow Notifications and Banners. Then check Focus (the moon icon in Control Centre): turn it off, or allow SiteSort in it.</p>
        ) : (
          <p>In the phone's settings, open Notifications (or Apps), find SiteSort or your browser, and allow notifications and pop-up banners. Check Do Not Disturb is off.</p>
        )}
        <p>Then send another test. Your project manager can see your answer.</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3 text-sm space-y-1">
      <p className="font-bold">The alert never reached this phone.</p>
      <p>On that phone, open SiteSort{apple ? " from the Home Screen icon" : ""}, go to Settings, tap Turn off, then Turn on, and send another test. If it still fails, remove SiteSort from the Home Screen, add it again and turn alerts on.</p>
    </div>
  );
}
