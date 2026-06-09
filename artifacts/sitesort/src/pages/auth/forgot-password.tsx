import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Building2, Mail, CheckCircle } from "lucide-react";

const schema = z.object({
  email: z.string().email("Please enter a valid email address"),
});
type FormData = z.infer<typeof schema>;

export default function ForgotPassword() {
  const [, setLocation] = useLocation();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    setError(null);
    setLoading(true);
    try {
      const r = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.email }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setError(body.message ?? "Something went wrong. Please try again.");
      } else {
        setSent(true);
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
              Don't see it? Check your spam or junk folder. If you still can't find it, email us at{" "}
              <a href="mailto:support@sitesort.co.uk" className="text-primary hover:underline">support@sitesort.co.uk</a>.
            </p>
            <Button variant="outline" className="mt-2 w-full" onClick={() => setLocation("/login")}>
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
              <Button type="submit" className="w-full" size="lg" isLoading={loading}>
                Send Reset Link
              </Button>
            </form>
            <div className="mt-6 text-center text-sm text-muted-foreground">
              <Link href="/login" className="text-primary font-semibold hover:underline">
                Back to Login
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
