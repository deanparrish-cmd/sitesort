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
    amount: 2900,
  },
  team: {
    name: "SiteSort Team",
    description: "Up to 5 projects — monthly subscription",
    amount: 7900,
  },
  pro: {
    name: "SiteSort Pro",
    description: "Unlimited projects — monthly subscription",
    amount: 14900,
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

  const user = req.user!;
  const stripe = new Stripe(apiKey);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: user.email,
      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: plan.name,
              description: plan.description,
            },
            unit_amount: plan.amount,
            recurring: { interval: "month" },
          },
          quantity: 1,
        },
      ],
      success_url: `${APP_URL}/settings?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/settings?checkout=cancelled`,
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

  await db
    .update(companiesTable)
    .set({
      subscriptionTier: plan,
      subscriptionStatus: mapSubscriptionStatus(subscription.status),
      stripeCustomerId: subscription.customer as string,
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
    .set({ subscriptionTier: "free", subscriptionStatus: "cancelled" })
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

export default router;
