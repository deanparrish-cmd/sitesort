import { Router } from "express";
import Stripe from "stripe";
import { eq, and } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";
import { db } from "@workspace/db";
import { companiesTable, usersTable, notificationsTable } from "@workspace/db/schema";
import { generateId } from "../lib/id";

const router = Router();

const APP_URL =
  process.env.APP_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN ?? "sitesort.co.uk"}`;

const PLANS = {
  solo: {
    name: "SiteSort Solo",
    description: "1 project — monthly subscription",
    priceId: process.env.STRIPE_PRICE_SOLO,
  },
  team: {
    name: "SiteSort Team",
    description: "Up to 5 projects — monthly subscription",
    priceId: process.env.STRIPE_PRICE_TEAM,
  },
  pro: {
    name: "SiteSort Pro",
    description: "Unlimited projects — monthly subscription",
    priceId: process.env.STRIPE_PRICE_PRO,
  },
} as const;

type PlanId = keyof typeof PLANS;

router.post("/billing/checkout", authenticate, async (req, res) => {
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "STRIPE_SECRET_KEY is not set" });
    return;
  }

  const planId = (req.body?.plan ?? "pro") as PlanId;
  const plan = PLANS[planId];
  if (!plan) {
    res.status(400).json({ error: `Unknown plan: ${planId}` });
    return;
  }
  if (!plan.priceId) {
    res.status(500).json({ error: `Stripe price ID is not configured for plan: ${planId}` });
    return;
  }

  const user = req.user!;
  const stripe = new Stripe(apiKey);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: user.email,
      line_items: [
        {
          price: plan.priceId,
          quantity: 1,
        },
      ],
      success_url: `${APP_URL}/dashboard?checkout=success`,
      cancel_url: `${APP_URL}/register`,
      payment_method_collection: "always",
      subscription_data: {
        trial_period_days: 14,
        trial_settings: {
          end_behavior: { missing_payment_method: "cancel" },
        },
        metadata: {
          userId: user.id,
          companyId: user.companyId,
          plan: planId,
        },
      },
      metadata: {
        userId: user.id,
        companyId: user.companyId,
        plan: planId,
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Stripe checkout error:", message);
    res.status(500).json({ error: message });
  }
});

function mapSubscriptionStatus(status: Stripe.Subscription.Status): string {
  switch (status) {
    case "active": return "active";
    case "trialing": return "trialing";
    case "past_due": return "past_due";
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
      return "cancelled";
    default:
      return status;
  }
}

async function handleSubscriptionUpsert(
  subscription: Stripe.Subscription,
): Promise<void> {
  const companyId = subscription.metadata?.companyId;
  const plan = (subscription.metadata?.plan ?? "pro") as PlanId;
  if (!companyId) return;

  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000)
    : null;

  await db
    .update(companiesTable)
    .set({
      subscriptionTier: plan,
      subscriptionStatus: mapSubscriptionStatus(subscription.status),
      stripeCustomerId: subscription.customer as string,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      currentPeriodEnd: periodEnd,
    })
    .where(eq(companiesTable.id, companyId));
}

async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription,
): Promise<void> {
  const companyId = subscription.metadata?.companyId;
  if (!companyId) return;

  await db
    .update(companiesTable)
    .set({ subscriptionTier: "free", subscriptionStatus: "cancelled", cancelAtPeriodEnd: false, currentPeriodEnd: null })
    .where(eq(companiesTable.id, companyId));
}

async function handleTrialWillEnd(subscription: Stripe.Subscription): Promise<void> {
  const companyId = subscription.metadata?.companyId;
  if (!companyId) return;

  const admins = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.companyId, companyId), eq(usersTable.role, "admin")));

  if (admins.length === 0) return;

  const trialEnd = subscription.trial_end
    ? new Date(subscription.trial_end * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "long" })
    : "soon";

  await db.insert(notificationsTable).values(
    admins.map(admin => ({
      id: generateId(),
      userId: admin.id,
      type: "trial_ending",
      title: "Your free trial ends soon",
      message: `Your SiteSort trial ends on ${trialEnd}. Add a payment method in billing settings to keep full access.`,
      relatedEntityType: "billing",
    })),
  );
}

async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId = invoice.customer as string | null;
  if (!customerId) return;

  const companyRows = await db
    .select({ id: companiesTable.id })
    .from(companiesTable)
    .where(eq(companiesTable.stripeCustomerId, customerId))
    .limit(1);

  const companyId = companyRows[0]?.id;
  if (!companyId) return;

  const admins = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.companyId, companyId), eq(usersTable.role, "admin")));

  if (admins.length === 0) return;

  await db.insert(notificationsTable).values(
    admins.map(admin => ({
      id: generateId(),
      userId: admin.id,
      type: "payment_failed",
      title: "Payment failed",
      message: "We couldn't process your subscription payment. Update your payment method to avoid losing access.",
      relatedEntityType: "billing",
    })),
  );
}

router.post("/billing/webhook", async (req, res) => {
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "STRIPE_SECRET_KEY is not set" });
    return;
  }

  const stripe = new Stripe(apiKey);
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: Stripe.Event;
  try {
    if (webhookSecret) {
      const sig = req.headers["stripe-signature"] as string;
      event = stripe.webhooks.constructEvent(req.body as Buffer, sig, webhookSecret);
    } else {
      event = JSON.parse((req.body as Buffer).toString()) as Stripe.Event;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Stripe webhook error:", message);
    res.status(400).json({ error: `Webhook error: ${message}` });
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription" && session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(
            session.subscription as string,
          );
          await handleSubscriptionUpsert(subscription);

          // Completing Stripe checkout proves the user controls their email,
          // so auto-verify to avoid blocking login after the redirect back.
          const userId = session.metadata?.userId;
          if (userId) {
            await db.update(usersTable)
              .set({ emailVerified: true, emailVerificationToken: null, emailVerificationExpiry: null })
              .where(and(eq(usersTable.id, userId), eq(usersTable.emailVerified, false)));
          }
        }
        break;
      }
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpsert(subscription);
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription);
        break;
      }
      case "customer.subscription.trial_will_end": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleTrialWillEnd(subscription);
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentFailed(invoice);
        break;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Stripe webhook handler error:", message);
    res.status(500).json({ error: message });
    return;
  }

  res.json({ received: true });
});

router.post("/billing/portal", authenticate, async (req, res) => {
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "STRIPE_SECRET_KEY is not set" });
    return;
  }

  const stripe = new Stripe(apiKey);
  const user = req.user!;

  const companyRows = await db
    .select({ stripeCustomerId: companiesTable.stripeCustomerId })
    .from(companiesTable)
    .where(eq(companiesTable.id, user.companyId))
    .limit(1);

  let customerId = companyRows[0]?.stripeCustomerId ?? null;

  if (!customerId) {
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    customerId = customers.data[0]?.id ?? null;
  }

  if (!customerId) {
    res.status(404).json({ error: "no_subscription", message: "No Stripe customer found for this account." });
    return;
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${APP_URL}/settings?tab=billing`,
    });
    res.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Stripe portal error:", message);
    res.status(500).json({ error: message });
  }
});

async function getActiveSubscription(stripe: Stripe, customerId: string): Promise<Stripe.Subscription | null> {
  const subs = await stripe.subscriptions.list({ customer: customerId, limit: 1 });
  return subs.data[0] ?? null;
}

router.post("/billing/cancel", authenticate, async (req, res) => {
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) { res.status(500).json({ error: "STRIPE_SECRET_KEY is not set" }); return; }

  const stripe = new Stripe(apiKey);
  const user = req.user!;

  const companyRows = await db
    .select({ stripeCustomerId: companiesTable.stripeCustomerId })
    .from(companiesTable)
    .where(eq(companiesTable.id, user.companyId))
    .limit(1);

  const customerId = companyRows[0]?.stripeCustomerId;
  if (!customerId) { res.status(404).json({ error: "no_subscription", message: "No active subscription found." }); return; }

  try {
    const sub = await getActiveSubscription(stripe, customerId);
    if (!sub) { res.status(404).json({ error: "no_subscription", message: "No active subscription found." }); return; }

    const updated = await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
    const periodEnd = updated.current_period_end ? new Date(updated.current_period_end * 1000) : null;

    await db.update(companiesTable)
      .set({ cancelAtPeriodEnd: true, currentPeriodEnd: periodEnd })
      .where(eq(companiesTable.id, user.companyId));

    res.json({ cancelAtPeriodEnd: true, currentPeriodEnd: periodEnd?.toISOString() ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.post("/billing/resume", authenticate, async (req, res) => {
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) { res.status(500).json({ error: "STRIPE_SECRET_KEY is not set" }); return; }

  const stripe = new Stripe(apiKey);
  const user = req.user!;

  const companyRows = await db
    .select({ stripeCustomerId: companiesTable.stripeCustomerId })
    .from(companiesTable)
    .where(eq(companiesTable.id, user.companyId))
    .limit(1);

  const customerId = companyRows[0]?.stripeCustomerId;
  if (!customerId) { res.status(404).json({ error: "no_subscription", message: "No subscription found." }); return; }

  try {
    const sub = await getActiveSubscription(stripe, customerId);
    if (!sub) { res.status(404).json({ error: "no_subscription", message: "No subscription found." }); return; }

    await stripe.subscriptions.update(sub.id, { cancel_at_period_end: false });

    await db.update(companiesTable)
      .set({ cancelAtPeriodEnd: false })
      .where(eq(companiesTable.id, user.companyId));

    res.json({ cancelAtPeriodEnd: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

export default router;
