import { createContext, useContext, useState, useEffect } from "react";

type SubscriptionCtx = {
  tier: string;
  status: string;
  isCancelled: boolean;
  isLoading: boolean;
};

const SubscriptionContext = createContext<SubscriptionCtx>({
  tier: "free",
  status: "active",
  isCancelled: false,
  isLoading: true,
});

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem("sitesort_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const [tier, setTier] = useState("free");
  const [status, setStatus] = useState("active");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("sitesort_token");
    if (!token) { setIsLoading(false); return; }
    (async () => {
      try {
        const r = await fetch("/api/companies/mine", { headers: authHeaders() });
        if (r.ok) {
          const data = await r.json() as { subscriptionTier: string; subscriptionStatus: string };
          setTier(data.subscriptionTier);
          setStatus(data.subscriptionStatus);
        }
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  return (
    <SubscriptionContext.Provider value={{ tier, status, isCancelled: status === "cancelled", isLoading }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  return useContext(SubscriptionContext);
}
