import { createContext, useContext, useState, useEffect, useReducer, useCallback } from "react";
import { useLocation } from "wouter";

type SubscriptionCtx = {
  tier: string;
  status: string;
  isCancelled: boolean;
  // Account created but no payment method taken yet (registered, then abandoned
  // Stripe Checkout). The app shell shows a blocking gate until they complete it.
  needsCheckout: boolean;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  betaAccess: boolean;
  isLoading: boolean;
  // True only once the billing state has been read for the token in use now.
  // The app shell renders nothing until it is: an unknown state never counts as
  // paid (fail closed, same rule as the gate in #163).
  billingKnown: boolean;
  // The read for the current token failed (network, server error, bad reply).
  billingFailed: boolean;
  retry: () => void;
};

const SubscriptionContext = createContext<SubscriptionCtx>({
  tier: "free",
  status: "unknown",
  isCancelled: false,
  needsCheckout: false,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
  betaAccess: false,
  isLoading: true,
  billingKnown: false,
  billingFailed: false,
  retry: () => {},
});

type Billing = { tier: string; status: string; betaAccess: boolean; cancelAtPeriodEnd: boolean; currentPeriodEnd: string | null };

function readToken(): string | null {
  try { return localStorage.getItem("sitesort_token"); } catch { return null; }
}

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  // This provider sits above the router. Login, invite accept and register store
  // the token and navigate without a reload, so re-render on every navigation
  // (and on another tab's login/logout) and re-read whenever the token changes.
  // Before 2026-10-29 it read once at page load: on /login there was no token
  // yet, it settled on "active", and a new signup reached the dashboard with no
  // checkout gate.
  useLocation();
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    window.addEventListener("storage", bump);
    return () => window.removeEventListener("storage", bump);
  }, []);

  const token = readToken();
  const [loaded, setLoaded] = useState<{ token: string; billing: Billing | null } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) return;
    let stale = false;
    (async () => {
      let billing: Billing | null = null;
      try {
        const r = await fetch("/api/companies/mine", { headers: { Authorization: `Bearer ${token}` } });
        if (r.ok) {
          const d = await r.json() as { subscriptionTier?: unknown; subscriptionStatus?: unknown; betaAccess?: unknown; cancelAtPeriodEnd?: unknown; currentPeriodEnd?: unknown };
          if (typeof d.subscriptionStatus === "string" && typeof d.subscriptionTier === "string") {
            billing = {
              tier: d.subscriptionTier,
              status: d.subscriptionStatus,
              betaAccess: d.betaAccess === true,
              cancelAtPeriodEnd: d.cancelAtPeriodEnd === true,
              currentPeriodEnd: typeof d.currentPeriodEnd === "string" ? d.currentPeriodEnd : null,
            };
          }
        }
      } catch { /* billing stays null: unknown */ }
      if (!stale) setLoaded({ token, billing });
    })();
    return () => { stale = true; };
  }, [token, attempt]);

  const retry = useCallback(() => { setLoaded(null); setAttempt(a => a + 1); }, []);

  // Only a result read for THIS token counts: a previous login's (or company's)
  // state never carries over.
  const current = token && loaded?.token === token ? loaded : null;
  const billing = current?.billing ?? null;
  const betaAccess = billing?.betaAccess ?? false;
  const status = billing?.status ?? "unknown";

  return (
    <SubscriptionContext.Provider value={{
      tier: billing?.tier ?? "free",
      // Beta companies bypass all subscription restrictions
      status: betaAccess ? "active" : status,
      isCancelled: !!billing && !betaAccess && status === "cancelled",
      needsCheckout: !!billing && !betaAccess && status === "incomplete",
      cancelAtPeriodEnd: !!billing && !betaAccess && billing.cancelAtPeriodEnd,
      currentPeriodEnd: billing?.currentPeriodEnd ?? null,
      betaAccess,
      isLoading: !!token && !current,
      billingKnown: !!billing,
      billingFailed: !!current && !billing,
      retry,
    }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  return useContext(SubscriptionContext);
}
