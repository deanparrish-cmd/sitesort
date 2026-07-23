import { useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock, CheckCircle, AlertTriangle, HardHat } from "lucide-react";
import { usePortalResetPassword } from "@workspace/api-client-react";

// Portal-member password reset via emailed single-use token. Expired or spent
// links show a friendly "request a new one" state instead of a raw error.
export default function PortalResetPassword() {
  const search = useSearch();
  const token = new URLSearchParams(search).get("token");
  const [, setLocation] = useLocation();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [linkDead, setLinkDead] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reset = usePortalResetPassword();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) { setLinkDead("This reset link is invalid. Please request a new one."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setError(null);
    try {
      await reset.mutateAsync({ data: { token, password } });
      setDone(true);
      setTimeout(() => setLocation("/portal/login"), 3000);
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
            <HardHat className="w-6 h-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-display font-bold text-primary">Set a new password</h1>
          <p className="text-muted-foreground mt-2 text-sm text-center">
            Choose a new password for your portal account.
          </p>
        </div>

        {linkDead ? (
          <div className="flex flex-col items-center gap-4 text-center py-4">
            <AlertTriangle className="w-12 h-12 text-amber-500" />
            <h2 className="text-lg font-semibold">This link has expired</h2>
            <p className="text-muted-foreground text-sm">{linkDead}</p>
            <Button className="mt-2 w-full" onClick={() => setLocation("/portal/forgot-password")}>
              Request a new link
            </Button>
          </div>
        ) : done ? (
          <div className="flex flex-col items-center gap-4 text-center py-4">
            <CheckCircle className="w-12 h-12 text-green-500" />
            <h2 className="text-lg font-semibold">Password updated</h2>
            <p className="text-muted-foreground text-sm">
              You can now log in with your new password. Taking you to login…
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
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                autoComplete="new-password"
                placeholder="New password"
                icon={<Lock className="w-5 h-5" />}
              />
              <Input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                type="password"
                autoComplete="new-password"
                placeholder="Confirm new password"
                icon={<Lock className="w-5 h-5" />}
              />
              <Button type="submit" className="w-full" size="lg" isLoading={reset.isPending}>
                Set new password
              </Button>
            </form>
            <p className="mt-6 text-center text-sm text-muted-foreground">
              <Link href="/portal/login" className="text-primary hover:underline">Back to login</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
