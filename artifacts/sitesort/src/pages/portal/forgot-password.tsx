import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mail, CheckCircle, HardHat } from "lucide-react";
import { usePortalForgotPassword } from "@workspace/api-client-react";

// Portal-member "forgot password" — same shared backbone as the main app, but
// the emailed link targets the portal reset page and copy stays member-facing.
export default function PortalForgotPassword() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const forgot = usePortalForgotPassword();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { setError("Enter your email address."); return; }
    setError(null);
    try {
      await forgot.mutateAsync({ data: { email: email.trim().toLowerCase() } });
      setSent(true);
    } catch (err: any) {
      setError(err?.data?.message ?? "Something went wrong. Please try again.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-md p-8 bg-card rounded-2xl shadow-2xl border border-border/50 slide-up">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center mb-4 shadow-lg">
            <HardHat className="w-6 h-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-display font-bold text-primary">Forgot password?</h1>
          <p className="text-muted-foreground mt-2 text-sm text-center">
            Enter your email and we'll send you a reset link.
          </p>
        </div>

        {sent ? (
          <div className="flex flex-col items-center gap-4 text-center py-4">
            <CheckCircle className="w-12 h-12 text-green-500" />
            <h2 className="text-lg font-semibold">Check your inbox</h2>
            <p className="text-muted-foreground text-sm">
              If an account exists for that email, you'll receive a password reset link within a few minutes.
            </p>
            <p className="text-muted-foreground text-sm">
              Don't see it? Check your spam or junk folder.
            </p>
            <Button variant="outline" className="mt-2 w-full" onClick={() => setLocation("/portal/login")}>
              Back to Login
            </Button>
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
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Email address"
                icon={<Mail className="w-5 h-5" />}
              />
              <Button type="submit" className="w-full" size="lg" isLoading={forgot.isPending}>
                Send reset link
              </Button>
            </form>
            <p className="mt-6 text-center text-sm text-muted-foreground">
              Remembered it?{" "}
              <Link href="/portal/login" className="text-primary hover:underline">Back to login</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
