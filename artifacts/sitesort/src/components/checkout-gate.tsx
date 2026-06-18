import { useState, useEffect } from "react";
import { CreditCard, Building2, Loader2, LogOut } from "lucide-react";

const PLANS = {
  solo: { name: "Solo", price: "£29", tagline: "Perfect for a single site" },
  team: { name: "Team", price: "£79", tagline: "For growing contractors", popular: true as const },
  pro: { name: "Pro", price: "£149", tagline: "Full access to every feature" },
} as const;

type PlanId = keyof typeof PLANS;

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem("sitesort_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/**
 * Hard gate shown when a company is "incomplete" — registered but never
 * completed Stripe Checkout (no card on file). Blocks the whole app until they
 * add payment details. This is what closes the "abandon Stripe and still use the
 * app for free" hole.
 */
export function CheckoutGate() {
  const [selected, setSelected] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);

  // If we've just returned from a successful Stripe Checkout, the webhook may
  // not have flipped status → trialing yet. Poll until it does, then reload —
  // don't ask a paying user to pay again.
  const justPaid = new URLSearchParams(window.location.search).get("checkout") === "success";

  useEffect(() => {
    if (!justPaid) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch("/api/companies/mine", { headers: authHeaders() });
        if (r.ok) {
          const d = await r.json();
          if (!cancelled && d.subscriptionStatus !== "incomplete") {
            window.location.href = "/dashboard";
            return;
          }
        }
      } catch { /* keep polling */ }
      if (!cancelled) setTimeout(poll, 2000);
    };
    poll();
    return () => { cancelled = true; };
  }, [justPaid]);

  const startCheckout = async (plan: PlanId) => {
    setSelected(plan);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ plan }),
      });
      const json = await res.json().catch(() => ({} as { url?: string; error?: string }));
      if (res.ok && json.url) {
        window.location.href = json.url;
        return;
      }
      setSelected(null);
      setError("We couldn't open the secure payment page. Please try again.");
    } catch {
      setSelected(null);
      setError("Something went wrong starting checkout. Please try again.");
    }
  };

  const logout = () => {
    localStorage.removeItem("sitesort_token");
    window.location.href = "/login";
  };

  if (justPaid) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 p-6 text-center">
        <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
        <h1 className="text-xl font-display font-bold text-primary">Finalizing your subscription…</h1>
        <p className="text-muted-foreground mt-2 text-sm">This only takes a moment. Please don't close this page.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-lg bg-card rounded-2xl shadow-2xl border border-border/50 p-8">
        <div className="flex flex-col items-center mb-6 text-center">
          <div className="w-12 h-12 bg-accent rounded-xl flex items-center justify-center mb-4 shadow-lg shadow-accent/20">
            <CreditCard className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-display font-bold text-primary">Add payment to start your trial</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Your account is ready — choose a plan to begin your <strong>14-day free trial</strong>. No charge today, cancel any time.
          </p>
        </div>

        {error && (
          <div className="mb-5 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm font-medium text-center">
            {error}
          </div>
        )}

        <div className="space-y-3">
          {(Object.entries(PLANS) as [PlanId, (typeof PLANS)[PlanId]][]).map(([id, p]) => (
            <button
              key={id}
              type="button"
              disabled={!!selected}
              onClick={() => startCheckout(id)}
              className={`w-full text-left rounded-xl border-2 px-5 py-4 transition-all hover:border-primary/60 hover:shadow-sm disabled:opacity-60 ${
                "popular" in p && p.popular ? "border-primary/30 bg-gradient-to-br from-orange-50/50 to-amber-50/30" : "border-border bg-card"
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-foreground flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-muted-foreground" /> SiteSort {p.name}
                    {"popular" in p && p.popular && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide bg-orange-500 text-white px-2 py-0.5 rounded-full">Popular</span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground mt-0.5">{p.tagline}</div>
                </div>
                <div className="text-right shrink-0 ml-4">
                  {selected === id ? (
                    <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  ) : (
                    <>
                      <div className="font-bold text-foreground text-lg">{p.price}</div>
                      <div className="text-xs text-muted-foreground">/month</div>
                    </>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>

        <button onClick={logout} className="mt-6 mx-auto flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <LogOut className="w-3.5 h-3.5" /> Log out
        </button>
      </div>
    </div>
  );
}
