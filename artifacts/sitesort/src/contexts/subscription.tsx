import { createContext, useContext, useState, useEffect } from "react";

type SubscriptionCtx = {
  tier: string;
  status: string;
  isCancelled: boolean;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  betaAccess: boolean;
  isLoading: boolean;
};

const SubscriptionContext = createContext<SubscriptionCtx>({
  tier: "free",
  status: "active",
  isCancelled: false,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
  betaAccess: false,
  isLoading: true,
});

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem("sitesort_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const [tier, setTier] = useState("free");
  const [status, setStatus] = useState("active");
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false);
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null);
  const [betaAccess, setBetaAccess] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("sitesort_token");
    if (!token) { setIsLoading(false); return; }
    (async () => {
      try {
        const r = await fetch("/api/companies/mine", { headers: authHeaders() });
        if (r.ok) {
          const data = await r.json() as { subscriptionTier: string; subscriptionStatus: string; betaAccess: boolean; cancelAtPeriodEnd: boolean; currentPeriodEnd: string | null };
          setTier(data.subscriptionTier);
          setStatus(data.subscriptionStatus);
          setBetaAccess(!!data.betaAccess);
          setCancelAtPeriodEnd(!!data.cancelAtPeriodEnd);
          setCurrentPeriodEnd(data.currentPeriodEnd ?? null);
        }
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // Beta companies bypass all subscription restrictions
  const effectiveStatus = betaAccess ? "active" : status;

  return (
    <SubscriptionContext.Provider value={{ tier, status: effectiveStatus, isCancelled: !betaAccess && status === "cancelled", cancelAtPeriodEnd: !betaAccess && cancelAtPeriodEnd, currentPeriodEnd, betaAccess, isLoading }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  return useContext(SubscriptionContext);
}
