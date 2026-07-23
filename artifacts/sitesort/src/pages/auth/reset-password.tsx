import { useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Building2, Lock, CheckCircle, AlertTriangle } from "lucide-react";

const schema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirm: z.string(),
}).refine((d) => d.password === d.confirm, {
  message: "Passwords do not match",
  path: ["confirm"],
});
type FormData = z.infer<typeof schema>;

export default function ResetPassword() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const token = params.get("token");
  const [, setLocation] = useLocation();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkDead, setLinkDead] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    if (!token) {
      setError("Invalid reset link. Please request a new one.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const r = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: data.password }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        if (body.error === "token_expired" || body.error === "invalid_token") {
          setLinkDead(body.message ?? "This reset link has expired or was already used. Please request a new one.");
        } else {
          setError(body.message ?? "Something went wrong. Please try again.");
        }
      } else {
        setDone(true);
        setTimeout(() => setLocation("/login"), 3000);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30">
      <div className="w-full max-w-md p-8 bg-card rounded-2xl shadow-2xl border border-border/50 slide-up">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center mb-4 shadow-lg">
            <Building2 className="w-6 h-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-display font-bold text-primary">Set new password</h1>
          <p className="text-muted-foreground mt-2 text-sm text-center">
            Choose a strong password for your SiteSort account.
          </p>
        </div>

        {linkDead ? (
          <div className="flex flex-col items-center gap-4 text-center py-4">
            <AlertTriangle className="w-12 h-12 text-amber-500" />
            <h2 className="text-lg font-semibold">This link has expired</h2>
            <p className="text-muted-foreground text-sm">{linkDead}</p>
            <Button className="mt-2 w-full" onClick={() => setLocation("/forgot-password")}>
              Request a new link
            </Button>
          </div>
        ) : done ? (
          <div className="flex flex-col items-center gap-4 text-center py-4">
            <CheckCircle className="w-12 h-12 text-green-500" />
            <h2 className="text-lg font-semibold">Password updated!</h2>
            <p className="text-muted-foreground text-sm">
              Your password has been changed. Redirecting you to login…
            </p>
            <Button className="mt-2 w-full" onClick={() => setLocation("/login")}>
              Log in now
            </Button>
          </div>
        ) : (
          <>
            {!token && (
              <div className="mb-5 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm font-medium">
                This reset link is invalid. Please request a new one.
              </div>
            )}
            {error && (
              <div className="mb-5 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm font-medium">
                {error}
              </div>
            )}
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div>
                <Input
                  {...register("password")}
                  type="password"
                  placeholder="New password"
                  icon={<Lock className="w-5 h-5" />}
                />
                {errors.password && <p className="text-destructive text-sm mt-1 ml-1">{errors.password.message}</p>}
              </div>
              <div>
                <Input
                  {...register("confirm")}
                  type="password"
                  placeholder="Confirm new password"
                  icon={<Lock className="w-5 h-5" />}
                />
                {errors.confirm && <p className="text-destructive text-sm mt-1 ml-1">{errors.confirm.message}</p>}
              </div>
              <Button type="submit" className="w-full" size="lg" isLoading={loading} disabled={!token}>
                Update Password
              </Button>
            </form>
            <div className="mt-6 text-center text-sm text-muted-foreground">
              <Link href="/forgot-password" className="text-primary font-semibold hover:underline">
                Request a new link
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
