import { useEffect, useState } from "react";
import { Bell, Share, SquarePlus, X } from "lucide-react";
import {
  notifyPromptEligible, iosNeedsInstall, enablePush, skipNotifyPrompt,
} from "@/lib/portal-push";
import { useToast } from "@/hooks/use-toast";

// In-context "get notified" card for the Team Portal. NEVER prompts the browser
// on load — the OS permission dialog only fires when the member taps Enable.
// Appears from the second session onward (see notifyPromptEligible). On iOS
// Safari (not installed) it leads with the Add-to-Home-Screen step, since push
// needs an installed PWA there; every step offers "Maybe later", which dismisses
// without nagging (won't reappear for a week) and never blocks anything else.
export function PortalNotifyPrompt() {
  const { toast } = useToast();
  const [visible, setVisible] = useState(false);
  const [needsInstall, setNeedsInstall] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (notifyPromptEligible()) {
      setNeedsInstall(iosNeedsInstall());
      setVisible(true);
    }
  }, []);

  const later = () => { skipNotifyPrompt(); setVisible(false); };

  const enable = async () => {
    setBusy(true);
    const result = await enablePush();
    setBusy(false);
    if (result === "enabled") {
      toast({ title: "Notifications on", description: "We'll let you know when new drawings or notices are shared with you." });
      setVisible(false);
    } else if (result === "denied") {
      // Don't nag — they can turn it on later from Settings.
      toast({ title: "Notifications blocked", description: "You can enable them anytime from portal Settings.", variant: "destructive" });
      skipNotifyPrompt();
      setVisible(false);
    } else if (result === "needs_install") {
      setNeedsInstall(true);
    } else if (result === "error") {
      toast({ title: "Couldn't enable notifications", description: "Please try again from Settings.", variant: "destructive" });
    }
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pointer-events-none">
      <div className="pointer-events-auto max-w-md mx-auto bg-card border border-border rounded-2xl shadow-2xl p-4">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Bell className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">Get notified when new drawings or notices are shared with you</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {needsInstall
                ? "On iPhone, add the portal to your Home Screen first — then you can turn on notifications."
                : "A quick heads-up whenever your project manager shares something new."}
            </p>
          </div>
          <button onClick={later} aria-label="Maybe later" className="shrink-0 -mr-1 -mt-1 p-1.5 rounded-lg text-muted-foreground hover:bg-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        {needsInstall ? (
          <>
            <ol className="mt-3 space-y-1.5 text-xs text-foreground">
              <li className="flex items-center gap-2">
                <span className="shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center font-semibold text-[11px]">1</span>
                <span className="flex items-center gap-1">Tap the <Share className="w-4 h-4 text-primary inline" /> <span className="font-medium">Share</span> icon in Safari</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center font-semibold text-[11px]">2</span>
                <span className="flex items-center gap-1">Choose <SquarePlus className="w-4 h-4 text-primary inline" /> <span className="font-medium">Add to Home Screen</span></span>
              </li>
              <li className="flex items-center gap-2">
                <span className="shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center font-semibold text-[11px]">3</span>
                <span>Open SiteSort from your Home Screen, then enable notifications in Settings</span>
              </li>
            </ol>
            <div className="mt-3 flex justify-end">
              <button onClick={later} className="px-4 py-2 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">
                Maybe later
              </button>
            </div>
          </>
        ) : (
          <div className="mt-3 flex gap-2">
            <button
              onClick={enable}
              disabled={busy}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <Bell className="w-4 h-4" /> {busy ? "Enabling…" : "Enable notifications"}
            </button>
            <button onClick={later} className="px-4 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">
              Maybe later
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
