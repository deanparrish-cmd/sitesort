// Is this process the deployed (production) app, or the dev workspace / a test?
//
// The workspace and production share secrets, the object storage bucket and,
// through copied rows, real people's addresses. Anything that reaches the
// outside world or destroys data (live Stripe, email, push, scheduled jobs,
// file deletion) checks this first and stays off outside the deployed app.
//
// Production runs with NODE_ENV=production (.replit-artifact/artifact.toml)
// and Replit sets REPLIT_DEPLOYMENT=1 in deployments. REPLIT_ENVIRONMENT is
// NOT usable: it says "production" in the workspace too. /api/health reports
// the result so it can be checked on prod after every publish.
export const IS_DEPLOYED = process.env.REPLIT_DEPLOYMENT === "1" || process.env.NODE_ENV === "production";

// Stripe outside the deployed app: only a test-mode key, never a live one.
// The workspace reads STRIPE_TEST_SECRET_KEY (set it in workspace Secrets), so
// editing workspace secrets can never change what production uses.
export function stripeSecretKey(): string | null {
  if (IS_DEPLOYED) return process.env.STRIPE_SECRET_KEY || null;
  const key = process.env.STRIPE_TEST_SECRET_KEY || null;
  return key && key.startsWith("sk_test_") ? key : null;
}

// Web Push outside the deployed app uses its own VAPID pair (WORKSPACE_VAPID_*),
// so the workspace can never sign a push that production's subscribers accept.
export function vapidKeys(): { publicKey: string; privateKey: string } {
  return IS_DEPLOYED
    ? { publicKey: process.env.VAPID_PUBLIC_KEY ?? "", privateKey: process.env.VAPID_PRIVATE_KEY ?? "" }
    : { publicKey: process.env.WORKSPACE_VAPID_PUBLIC_KEY ?? "", privateKey: process.env.WORKSPACE_VAPID_PRIVATE_KEY ?? "" };
}

export function environmentSummary() {
  const stripe = stripeSecretKey();
  const vapid = vapidKeys();
  return {
    deployed: IS_DEPLOYED,
    stripe: stripe ? (stripe.startsWith("sk_live_") ? "live" : "test") : "off",
    email: IS_DEPLOYED && !!process.env.RESEND_API_KEY ? "on" : "off",
    push: vapid.publicKey && vapid.privateKey ? "on" : "off",
    scheduledJobs: IS_DEPLOYED ? "on" : "off",
    fileDeletion: IS_DEPLOYED ? "on" : "off",
  };
}
