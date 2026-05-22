import { Router } from "express";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";
import { db } from "@workspace/db";
import { companiesTable } from "@workspace/db/schema";

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
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Stripe webhook handler error:", message);
    res.status(500).json({ error: message });
    return;
  }

  res.json({ received: true });
});

export default router;
