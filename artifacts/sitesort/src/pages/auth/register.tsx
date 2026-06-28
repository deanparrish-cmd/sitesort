import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mail, Lock, Building2, User, Eye, EyeOff, MailCheck } from "lucide-react";
import { useRegister, RegisterRequestCompanySize } from "@workspace/api-client-react";
import { captureAttribution } from "@/lib/attribution";

const PLANS = {
  solo: {
    name: "Solo",
    price: "£29",
    tagline: "Perfect for a single site",
    features: ["1 active project", "Unlimited team members", "QR site boards"],
  },
  team: {
    name: "Team",
    price: "£79",
    tagline: "For growing contractors",
    features: ["Up to 5 active projects", "Unlimited team members", "QR site boards"],
    popular: true as const,
  },
  pro: {
    name: "Pro",
    price: "£149",
    tagline: "Full access to every feature",
    features: ["Unlimited projects", "Unlimited team members", "QR site boards"],
  },
} as const;

type PlanId = keyof typeof PLANS;

const registerSchema = z.object({
  companyName: z.string().min(2, "Company name is required"),
  adminName: z.string().min(2, "Your name is required"),
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string().min(1, "Please confirm your password"),
  companySize: z.nativeEnum(RegisterRequestCompanySize),
}).refine(data => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

const inviteSchema = z.object({
  name: z.string().min(2, "Your name is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type RegisterForm = z.infer<typeof registerSchema>;
type InviteForm = z.infer<typeof inviteSchema>;
type InviteData = { name: string; email: string; companyName: string };

export default function Register() {
  const [, setLocation] = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<PlanId | null>(null);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showInvitePassword, setShowInvitePassword] = useState(false);
  const registerMutation = useRegister();
  // Synchronous re-entrancy guard: a rapid double-click can fire onSubmit twice
  // before React re-renders the disabled button, and both closures would see the
  // stale (false) isSubmitting. A ref flips immediately, so the 2nd call bails.
  const submittingRef = useRef(false);

  // Invite flow
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteData, setInviteData] = useState<InviteData | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);

  useEffect(() => {
    captureAttribution();
    const params = new URLSearchParams(window.location.search);

    const planParam = params.get("plan") as PlanId | null;
    if (planParam && planParam in PLANS) setSelectedPlan(planParam);

    const token = params.get("invite");
    if (!token) return;
    setInviteToken(token);
    setInviteLoading(true);
    fetch(`/api/auth/invite/${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) setError(data.message ?? "Invalid or expired invite link.");
        else setInviteData(data);
      })
      .catch(() => setError("Failed to load invite. Please try again."))
      .finally(() => setInviteLoading(false));
  }, []);

  const { register, handleSubmit, formState: { errors } } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { companySize: "1-10" }
  });

  const { register: inviteRegister, handleSubmit: handleInviteSubmit, formState: { errors: inviteErrors }, setValue: setInviteValue } = useForm<InviteForm>({
    resolver: zodResolver(inviteSchema),
  });

  useEffect(() => {
    if (inviteData) setInviteValue("name", inviteData.name);
  }, [inviteData, setInviteValue]);

  const onSubmit = async (data: RegisterForm) => {
    if (!selectedPlan) return;
    if (submittingRef.current) return; // ignore double-submits while one is in flight
    submittingRef.current = true;
    setError(null);

    try {
      // Registration no longer hands out a session or jumps to Stripe. It creates
      // the (unverified) account and emails a verification link; the user must
      // click it, then log in — at which point the checkout gate takes the card.
      const { confirmPassword: _ignored, ...registerData } = data;
      const response = await registerMutation.mutateAsync({ data: registerData });
      setRegisteredEmail(response.email);
    } catch (err: any) {
      setError(err.message || "Registration failed. Please try again.");
    } finally {
      submittingRef.current = false; // allow a retry on failure
    }
  };

  // Tick down the resend cooldown once a resend has fired.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const resendVerification = async () => {
    if (!registeredEmail || resending || resendCooldown > 0) return;
    setResending(true);
    try {
      await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: registeredEmail }),
      });
    } catch {
      /* resend always reports success to avoid email enumeration; ignore errors */
    }
    setResent(true);
    setResending(false);
    setResendCooldown(45); // rate-limit: one resend per 45s (backend also throttles)
  };

  // "Wrong email?" — return to the details form so the user can correct a typo.
  // The form's values persist (the component stays mounted), so the bad address
  // is still in the field, ready to fix and resubmit.
  const editEmail = () => {
    setRegisteredEmail(null);
    setResent(false);
    setResendCooldown(0);
    setError(null);
  };

  const onInviteSubmit = async (data: InviteForm) => {
    if (!inviteToken) return;
    setError(null);
    setInviteSubmitting(true);
    try {
      const r = await fetch(`/api/auth/invite/${inviteToken}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: data.name, password: data.password }),
      });
      const json = await r.json();
      if (!r.ok) { setError(json.message ?? "Failed to join. Please try again."); return; }
      localStorage.setItem("sitesort_token", json.token);
      setLocation("/dashboard");
    } catch {
      setError("Failed to join. Please try again.");
    } finally {
      setInviteSubmitting(false);
    }
  };

  const plan = selectedPlan ? PLANS[selectedPlan] : null;
  const isSubmitting = registerMutation.isPending;

  // Post-registration: account created, verification email sent. We don't log the
  // user in — they must click the link, then sign in.
  if (registeredEmail) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 relative py-12">
        <div className="absolute inset-0 z-0 opacity-20">
          <img
            src={`${import.meta.env.BASE_URL}images/auth-bg.png`}
            alt="Background"
            className="w-full h-full object-cover"
          />
        </div>
        <div className="w-full max-w-md p-8 bg-card rounded-2xl shadow-2xl border border-border/50 relative z-10 text-center slide-up">
          <div className="flex flex-col items-center mb-6">
            <div className="w-12 h-12 bg-accent rounded-xl flex items-center justify-center mb-4 shadow-lg shadow-accent/20">
              <MailCheck className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-display font-bold text-primary">Check your email</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            We've sent a verification link to{" "}
            <span className="font-semibold text-foreground break-words">{registeredEmail}</span>.
            Click it to confirm your email, then log in to start your free trial.
          </p>
          <p className="text-muted-foreground text-xs mt-3">
            Don't see it within a minute or two? Check your spam or junk folder — and
            mark it "not spam" so future emails reach your inbox.
          </p>

          {resent && (
            <p className="mt-5 text-sm text-emerald-600 font-medium">
              Verification email sent — check your inbox again.
            </p>
          )}

          <Button
            variant="outline"
            className="w-full mt-5"
            onClick={resendVerification}
            isLoading={resending}
            disabled={resending || resendCooldown > 0}
          >
            {resendCooldown > 0
              ? `Resend available in ${resendCooldown}s`
              : resent
                ? "Resend verification email"
                : "Didn't get it? Resend verification email"}
          </Button>

          <button
            type="button"
            onClick={editEmail}
            className="mt-4 text-sm text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            Wrong email? Go back and edit
          </button>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            Already verified?{" "}
            <Link href="/login" className="text-primary font-semibold hover:underline">
              Log in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 relative py-12">
      <div className="absolute inset-0 z-0 opacity-20">
        <img
          src={`${import.meta.env.BASE_URL}images/auth-bg.png`}
          alt="Background"
          className="w-full h-full object-cover"
        />
      </div>

      <div className="w-full max-w-lg p-8 bg-card rounded-2xl shadow-2xl border border-border/50 relative z-10 slide-up">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 bg-accent rounded-xl flex items-center justify-center mb-4 shadow-lg shadow-accent/20">
            <Building2 className="w-6 h-6 text-white" />
          </div>
          {inviteToken ? (
            <>
              <h1 className="text-3xl font-display font-bold text-primary">
                {inviteLoading ? "Loading…" : inviteData ? `Join ${inviteData.companyName}` : "Invalid Invite"}
              </h1>
              {inviteData && <p className="text-muted-foreground mt-2">You've been invited to SiteSort</p>}
            </>
          ) : (
            <>
              <h1 className="text-3xl font-display font-bold text-primary">
                {selectedPlan ? "Create Account" : "Start free trial"}
              </h1>
              <p className="text-muted-foreground mt-2 text-center">
                {selectedPlan
                  ? `SiteSort ${plan!.name} — ${plan!.price}/month`
                  : "Choose your plan, then add your details"}
              </p>
            </>
          )}
        </div>

        {error && (
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm font-medium">
            {error}
          </div>
        )}

        {/* Invite flow */}
        {inviteToken && inviteData && (
          <form onSubmit={handleInviteSubmit(onInviteSubmit)} className="space-y-5">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Email</label>
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border bg-muted/40 text-sm text-muted-foreground">
                <Mail className="w-4 h-4 shrink-0" />
                {inviteData.email}
              </div>
            </div>
            <div>
              <Input
                {...inviteRegister("name")}
                placeholder="Your Full Name"
                icon={<User className="w-5 h-5" />}
              />
              {inviteErrors.name && <p className="text-destructive text-sm mt-1 ml-1">{inviteErrors.name.message}</p>}
            </div>
            <div>
              <Input
                {...inviteRegister("password")}
                type={showInvitePassword ? "text" : "password"}
                placeholder="Create Password"
                icon={<Lock className="w-5 h-5" />}
                rightAction={
                  <button
                    type="button"
                    onClick={() => setShowInvitePassword(p => !p)}
                    className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                  >
                    {showInvitePassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                }
              />
              {inviteErrors.password && <p className="text-destructive text-sm mt-1 ml-1">{inviteErrors.password.message}</p>}
            </div>
            <Button type="submit" variant="accent" className="w-full mt-8" size="lg" isLoading={inviteSubmitting}>
              Join {inviteData.companyName}
            </Button>
          </form>
        )}

        {/* Plan selection — shown when no plan chosen yet */}
        {!inviteToken && !selectedPlan && (
          <div className="space-y-3">
            {(Object.entries(PLANS) as [PlanId, (typeof PLANS)[PlanId]][]).map(([id, p]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSelectedPlan(id)}
                className={`w-full text-left rounded-xl border-2 px-5 py-4 transition-all hover:border-primary/60 hover:shadow-sm ${
                  "popular" in p && p.popular
                    ? "border-primary/30 bg-gradient-to-br from-orange-50/50 to-amber-50/30"
                    : "border-border bg-card"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-foreground flex items-center gap-2">
                      SiteSort {p.name}
                      {"popular" in p && p.popular && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide bg-orange-500 text-white px-2 py-0.5 rounded-full">
                          Popular
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground mt-0.5">{p.tagline}</div>
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    <div className="font-bold text-foreground text-lg">{p.price}</div>
                    <div className="text-xs text-muted-foreground">/month</div>
                  </div>
                </div>
              </button>
            ))}
            <p className="text-center text-xs text-muted-foreground pt-2">
              14-day free trial on every plan. No charge until it ends.
            </p>
          </div>
        )}

        {/* Account details form — shown once a plan is selected */}
        {!inviteToken && selectedPlan && (
          <>
            <div className="flex items-center justify-between mb-6 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg">
              <div className="text-sm">
                <span className="font-semibold text-emerald-900">SiteSort {plan!.name}</span>
                <span className="text-emerald-700"> · {plan!.price}/mo · 14-day free trial</span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPlan(null)}
                className="text-xs text-emerald-700 hover:text-emerald-900 underline underline-offset-2 shrink-0 ml-3"
              >
                Change
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div>
                <Input
                  {...register("companyName")}
                  placeholder="Company Name"
                  icon={<Building2 className="w-5 h-5" />}
                />
                {errors.companyName && <p className="text-destructive text-sm mt-1 ml-1">{errors.companyName.message}</p>}
              </div>

              <div>
                <select
                  {...register("companySize")}
                  className="flex h-11 w-full rounded-lg border-2 border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/10"
                >
                  <option value="1-10">1-10 Employees</option>
                  <option value="11-50">11-50 Employees</option>
                  <option value="51-200">51-200 Employees</option>
                  <option value="201+">201+ Employees</option>
                </select>
                {errors.companySize && <p className="text-destructive text-sm mt-1 ml-1">{errors.companySize.message}</p>}
              </div>

              <div className="h-px bg-border my-1"></div>

              <div>
                <Input
                  {...register("adminName")}
                  placeholder="Your Full Name"
                  icon={<User className="w-5 h-5" />}
                />
                {errors.adminName && <p className="text-destructive text-sm mt-1 ml-1">{errors.adminName.message}</p>}
              </div>

              <div>
                <Input
                  {...register("email")}
                  type="email"
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="Work Email"
                  icon={<Mail className="w-5 h-5" />}
                />
                {errors.email && <p className="text-destructive text-sm mt-1 ml-1">{errors.email.message}</p>}
              </div>

              <div>
                <Input
                  {...register("password")}
                  type={showPassword ? "text" : "password"}
                  placeholder="Create Password"
                  icon={<Lock className="w-5 h-5" />}
                  rightAction={
                    <button
                      type="button"
                      onClick={() => setShowPassword(p => !p)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  }
                />
                {errors.password && <p className="text-destructive text-sm mt-1 ml-1">{errors.password.message}</p>}
              </div>

              <div>
                <Input
                  {...register("confirmPassword")}
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Confirm Password"
                  icon={<Lock className="w-5 h-5" />}
                  rightAction={
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(p => !p)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      tabIndex={-1}
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  }
                />
                {errors.confirmPassword && <p className="text-destructive text-sm mt-1 ml-1">{errors.confirmPassword.message}</p>}
              </div>

              <Button type="submit" variant="accent" className="w-full mt-6" size="lg" isLoading={isSubmitting}>
                <Mail className="w-4 h-4 mr-2" />
                Create account
              </Button>
              <p className="text-center text-xs text-muted-foreground -mt-1">
                We'll email a link to verify your address. No charge for 14 days — then {plan!.price}/month. Cancel any time.
              </p>
            </form>
          </>
        )}

        <div className="mt-8 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-primary font-semibold hover:underline">
            Log in
          </Link>
        </div>
      </div>
    </div>
  );
}
