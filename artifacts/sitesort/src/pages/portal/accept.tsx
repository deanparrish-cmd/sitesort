import { useState } from "react";
import { useLocation, useRoute, Link } from "wouter";
import { useGetPortalInvite, useAcceptPortalInvite, getGetPortalInviteQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock, Eye, EyeOff, HardHat, CheckCircle2 } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";

// Invite acceptance — the link `/portal/accept/:token`. Name + email are shown
// pre-filled and locked (they come from the invite); the worker only sets a
// password, then lands straight in the portal.
export default function PortalAccept() {
  const [, params] = useRoute("/portal/accept/:token");
  const token = params?.token ?? "";
  const [, setLocation] = useLocation();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invite = useGetPortalInvite(token, { query: { enabled: !!token, retry: false, queryKey: getGetPortalInviteQueryKey(token) } });
  const accept = useAcceptPortalInvite();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError("Please choose a password of at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    try {
      const res = await accept.mutateAsync({ token, data: { password } });
      if (res.token) {
        localStorage.setItem("sitesort_portal_token", res.token);
        setLocation("/portal/overview");
      }
    } catch (err: any) {
      setError(err?.data?.message || "Could not complete sign-up. The invite may have expired.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm p-6 sm:p-8 bg-card rounded-2xl shadow-2xl border border-border/50">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center mb-4 shadow-lg">
            <HardHat className="w-6 h-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-display font-bold text-primary text-center">Join your project</h1>
        </div>

        {invite.isLoading && (
          <div className="flex justify-center py-8"><Spinner className="size-6 text-primary" /></div>
        )}

        {invite.isError && (() => {
          const code = (invite.error as any)?.data?.error;
          const expired = code === "invite_expired";
          const used = code === "invite_used";
          return (
            <div className="text-center">
              <p className="text-destructive font-semibold mb-2">
                {expired ? "This invite has expired" : used ? "This invite has already been used" : "This invite link isn't valid"}
              </p>
              <p className="text-sm text-muted-foreground mb-4">
                {expired
                  ? "Invite links are valid for 7 days. Ask your project manager to resend it, then open the new link."
                  : used
                  ? "If this is your account, log in to the portal below. Otherwise ask your project manager for a fresh invite."
                  : "Check you copied the whole link, or ask your project manager to resend the invite."}
              </p>
              <Link href="/portal/login" className="text-primary font-semibold hover:underline">Go to portal login</Link>
            </div>
          );
        })()}

        {invite.data?.valid && (
          <>
            <div className="mb-6 p-4 bg-primary/5 border border-primary/20 rounded-lg text-sm">
              <div className="flex items-center gap-2 text-primary font-semibold mb-2">
                <CheckCircle2 className="w-4 h-4" /> {invite.data.projectName}
              </div>
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">{invite.data.name}</span> · {invite.data.email}
              </p>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm font-medium">
                {error}
              </div>
            )}

            <form onSubmit={onSubmit} className="space-y-4">
              <Input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type={showPassword ? "text" : "password"}
                placeholder="Choose a password (min 8 chars)"
                icon={<Lock className="w-5 h-5" />}
                rightAction={
                  <button type="button" onClick={() => setShowPassword(p => !p)} className="p-1 text-muted-foreground hover:text-foreground" tabIndex={-1}>
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                }
              />
              <Input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                type={showPassword ? "text" : "password"}
                placeholder="Confirm password"
                icon={<Lock className="w-5 h-5" />}
              />
              <Button type="submit" className="w-full" size="lg" isLoading={accept.isPending}>
                Set password & continue
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
