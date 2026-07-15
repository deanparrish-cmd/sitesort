import { useEffect, useState } from "react";
import { Download, Share, SquarePlus, X } from "lucide-react";

// Dismissible "install this app" card for the member-facing Team Portal. Shows at
// most once per week if dismissed, never when already installed. Android/Chrome
// gets the native install prompt; iOS Safari (no programmatic prompt) gets the
// Share → Add to Home Screen steps.
const DISMISS_KEY = "sitesort_portal_install_dismissed";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}
function isIOS(): boolean {
  const ua = window.navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream;
}
function recentlyDismissed(): boolean {
  const t = Number(localStorage.getItem(DISMISS_KEY) || 0);
  return t > 0 && Date.now() - t < WEEK_MS;
}

export function PortalInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    if (isStandalone() || recentlyDismissed()) return;
    if (isIOS()) { setIos(true); setVisible(true); return; }
    const onPrompt = (e: Event) => { e.preventDefault(); setDeferred(e as BeforeInstallPromptEvent); setVisible(true); };
    const onInstalled = () => { localStorage.setItem(DISMISS_KEY, String(Date.now())); setVisible(false); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = () => { localStorage.setItem(DISMISS_KEY, String(Date.now())); setVisible(false); };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => {});
    setDeferred(null);
    dismiss();
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pointer-events-none">
      <div className="pointer-events-auto max-w-md mx-auto bg-card border border-border rounded-2xl shadow-2xl p-4">
        <div className="flex items-start gap-3">
          <img src="/icon-192.png" alt="" className="w-11 h-11 rounded-xl shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">Add SiteSort to your home screen</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {ios ? "Get one-tap access to your project portal." : "Install the portal for quick, one-tap access."}
            </p>
          </div>
          <button onClick={dismiss} aria-label="Dismiss" className="shrink-0 -mr-1 -mt-1 p-1.5 rounded-lg text-muted-foreground hover:bg-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        {ios ? (
          <ol className="mt-3 space-y-1.5 text-xs text-foreground">
            <li className="flex items-center gap-2">
              <span className="shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center font-semibold text-[11px]">1</span>
              <span className="flex items-center gap-1">Tap the <Share className="w-4 h-4 text-primary inline" /> <span className="font-medium">Share</span> icon in Safari</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center font-semibold text-[11px]">2</span>
              <span className="flex items-center gap-1">Choose <SquarePlus className="w-4 h-4 text-primary inline" /> <span className="font-medium">Add to Home Screen</span></span>
            </li>
          </ol>
        ) : (
          <div className="mt-3 flex gap-2">
            <button
              onClick={install}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              <Download className="w-4 h-4" /> Install app
            </button>
            <button onClick={dismiss} className="px-4 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">
              Not now
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
