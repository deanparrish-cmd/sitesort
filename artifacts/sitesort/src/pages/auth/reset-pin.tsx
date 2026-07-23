import { useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Building2, Lock, CheckCircle, AlertTriangle } from "lucide-react";
import { useResetPin } from "@workspace/api-client-react";

// Emailed-link PIN reset (locked-out path). Token is single-use — an expired
// or spent link shows a friendly "request a new one" state.
export default function ResetPin() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const token = params.get("token");
  const isPortal = params.get("context") === "portal";
  const loginHref = isPortal ? "/portal/login" : "/login";
  const [, setLocation] = useLocation();
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [linkDead, setLinkDead] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reset = useResetPin();

  const onlyDigits = (v: string) => v.replace(/\D/g, "").slice(0, 4);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) { setLinkDead("This reset link is invalid. Please request a new one."); return; }
    if (!/^\d{4}$/.test(pin)) { setError("Your PIN must be exactly 4 digits."); return; }
    if (pin !== confirm) { setError("PINs do not match."); return; }
    setError(null);
    try {
      await reset.mutateAsync({ data: { token, pin } });
      setDone(true);
      setTimeout(() => setLocation(loginHref), 3000);
    } catch (err: any) {
      const code = err?.data?.error;
      if (code === "token_expired" || code === "invalid_token") {
        setLinkDead(err?.data?.message ?? "This reset link has expired. Please request a new one.");
      } else {
        setError(err?.data?.message ?? "Something went wrong. Please try again.");
      }
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-md p-8 bg-card rounded-2xl shadow-2xl border border-border/50 slide-up">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center mb-4 shadow-lg">
            <Building2 className="w-6 h-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-display font-bold text-primary">Set a new PIN</h1>
          <p className="text-muted-foreground mt-2 text-sm text-center">
            Choose a new 4-digit sign-off PIN.
          </p>
        </div>

        {linkDead ? (
          <div className="flex flex-col items-center gap-4 text-center py-4">
            <AlertTriangle className="w-12 h-12 text-amber-500" />
            <h2 className="text-lg font-semibold">This link has expired</h2>
            <p className="text-muted-foreground text-sm">{linkDead}</p>
            <Button className="mt-2 w-full" onClick={() => setLocation(`/forgot-pin${isPortal ? "?context=portal" : ""}`)}>
              Request a new link
            </Button>
          </div>
        ) : done ? (
          <div className="flex flex-col items-center gap-4 text-center py-4">
            <CheckCircle className="w-12 h-12 text-green-500" />
            <h2 className="text-lg font-semibold">PIN updated</h2>
            <p className="text-muted-foreground text-sm">
              Your new sign-off PIN is ready to use. Taking you back to login…
            </p>
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-5 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm font-medium">
                {error}
              </div>
            )}
            <form onSubmit={onSubmit} className="space-y-5">
              <Input
                value={pin}
                onChange={(e) => setPin(onlyDigits(e.target.value))}
                type="password"
                inputMode="numeric"
                placeholder="New 4-digit PIN"
                icon={<Lock className="w-5 h-5" />}
              />
              <Input
                value={confirm}
                onChange={(e) => setConfirm(onlyDigits(e.target.value))}
                type="password"
                inputMode="numeric"
                placeholder="Confirm new PIN"
                icon={<Lock className="w-5 h-5" />}
              />
              <Button type="submit" className="w-full" size="lg" isLoading={reset.isPending}>
                Set new PIN
              </Button>
            </form>
            <p className="mt-6 text-center text-sm text-muted-foreground">
              <Link href={loginHref} className="text-primary hover:underline">Back to login</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
