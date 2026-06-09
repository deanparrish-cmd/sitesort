import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mail, Lock, Building2 } from "lucide-react";
import { useLogin } from "@workspace/api-client-react";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function Login() {
  const [, setLocation] = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
  const loginMutation = useLogin();
  const checkoutParam = new URLSearchParams(window.location.search).get("checkout");

  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema)
  });

  const onSubmit = async (data: LoginForm) => {
    setError(null);
    setUnverifiedEmail(null);
    setResendState("idle");
    try {
      const response = await loginMutation.mutateAsync({ data });
      localStorage.setItem("sitesort_token", response.token);
      setLocation("/dashboard");
    } catch (err: any) {
      if (err?.data?.error === "email_not_verified") {
        setUnverifiedEmail(data.email);
      } else {
        setError(
          (err?.data?.message || err.message || "Invalid email or password.") +
          " If you've just registered, please try again or contact support@sitesort.co.uk."
        );
      }
    }
  };

  const handleResend = async () => {
    if (!unverifiedEmail || resendState !== "idle") return;
    setResendState("sending");
    try {
      await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: unverifiedEmail }),
      });
    } finally {
      setResendState("sent");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 relative">
      <div className="absolute inset-0 z-0 opacity-20">
        <img
          src={`${import.meta.env.BASE_URL}images/auth-bg.png`}
          alt="Background"
          className="w-full h-full object-cover"
        />
      </div>

      <div className="w-full max-w-md p-8 bg-card rounded-2xl shadow-2xl border border-border/50 relative z-10 slide-up">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center mb-4 shadow-lg">
            <Building2 className="w-6 h-6 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-display font-bold text-primary">Welcome back</h1>
          <p className="text-muted-foreground mt-2">Log in to your SiteSort account</p>
        </div>

        {checkoutParam === "success" && !error && !unverifiedEmail && (
          <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-lg dark:bg-emerald-950/30 dark:border-emerald-800">
            <p className="text-emerald-800 dark:text-emerald-300 text-sm font-semibold mb-1">
              Registration successful — your 14-day free trial has started!
            </p>
            <p className="text-emerald-700 dark:text-emerald-400 text-sm">
              Log in below to access your SiteSort account. No charge will be made during your trial.
            </p>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm font-medium">
            {error}
          </div>
        )}

        {unverifiedEmail && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg dark:bg-amber-950/30 dark:border-amber-800">
            <p className="text-amber-800 dark:text-amber-300 text-sm font-medium mb-2">
              Please verify your email address
            </p>
            <p className="text-amber-700 dark:text-amber-400 text-sm mb-3">
              Check your inbox at <span className="font-semibold">{unverifiedEmail}</span> for a verification link.
            </p>
            {resendState === "sent" ? (
              <p className="text-green-700 dark:text-green-400 text-sm font-medium">Verification email sent — check your inbox.</p>
            ) : (
              <button
                onClick={handleResend}
                disabled={resendState === "sending"}
                className="text-sm text-amber-800 dark:text-amber-300 underline underline-offset-2 hover:no-underline disabled:opacity-50"
              >
                {resendState === "sending" ? "Sending…" : "Resend verification email"}
              </button>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div>
            <Input
              {...register("email")}
              type="email"
              placeholder="Email address"
              icon={<Mail className="w-5 h-5" />}
            />
            {errors.email && <p className="text-destructive text-sm mt-1 ml-1">{errors.email.message}</p>}
          </div>

          <div>
            <Input
              {...register("password")}
              type="password"
              placeholder="Password"
              icon={<Lock className="w-5 h-5" />}
            />
            {errors.password && <p className="text-destructive text-sm mt-1 ml-1">{errors.password.message}</p>}
          </div>

          <Button type="submit" className="w-full" size="lg" isLoading={loginMutation.isPending}>
            Log In
          </Button>
        </form>

        <div className="mt-4 text-right">
          <Link href="/forgot-password" className="text-sm text-muted-foreground hover:text-primary hover:underline">
            Forgot password?
          </Link>
        </div>

        <div className="mt-6 text-center text-sm text-muted-foreground">
          Don't have an account?{" "}
          <Link href="/register" className="text-primary font-semibold hover:underline">
            Register your company
          </Link>
        </div>
      </div>
    </div>
  );
}
