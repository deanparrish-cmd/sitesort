import { useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Building2, Mail, CheckCircle } from "lucide-react";
import { useForgotPin } from "@workspace/api-client-react";

const schema = z.object({
  email: z.string().email("Please enter a valid email address"),
});
type FormData = z.infer<typeof schema>;

// Locked-out "forgot sign-off PIN" — emails a single-use reset link. A signed-in
// user resets their PIN with their password from the PIN prompt instead.
export default function ForgotPin() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const isPortal = new URLSearchParams(search).get("context") === "portal";
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const forgot = useForgotPin();

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    setError(null);
    try {
      await forgot.mutateAsync({ data: { email: data.email, context: isPortal ? "portal" : "app" } });
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
            <Building2 className="w-6 h-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-display font-bold text-primary">Forgot your PIN?</h1>
          <p className="text-muted-foreground mt-2 text-sm text-center">
            Enter your email and we'll send you a link to set a new sign-off PIN.
          </p>
        </div>

        {sent ? (
          <div className="flex flex-col items-center gap-4 text-center py-4">
            <CheckCircle className="w-12 h-12 text-green-500" />
            <h2 className="text-lg font-semibold">Check your inbox</h2>
            <p className="text-muted-foreground text-sm">
              If an account exists for that email, you'll receive a PIN reset link within a few minutes.
            </p>
            <p className="text-muted-foreground text-sm">
              Don't see it? Check your spam or junk folder.
            </p>
            <Button variant="outline" className="mt-2 w-full" onClick={() => setLocation(isPortal ? "/portal/login" : "/login")}>
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
              <Input
                {...register("email")}
                type="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Email address"
                icon={<Mail className="w-5 h-5" />}
              />
              {errors.email && <p className="text-sm text-destructive -mt-3">{errors.email.message}</p>}
              <Button type="submit" className="w-full" size="lg" isLoading={forgot.isPending}>
                Send reset link
              </Button>
            </form>
            <p className="mt-6 text-center text-sm text-muted-foreground">
              Remembered it?{" "}
              <Link href={isPortal ? "/portal/login" : "/login"} className="text-primary hover:underline">Back to login</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
