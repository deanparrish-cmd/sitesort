import { Router } from "express";
import Stripe from "stripe";
import { eq, and } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";
import { db } from "@workspace/db";
import { companiesTable, usersTable, notificationsTable, companyMembersTable, stripeWebhookEventsTable } from "@workspace/db/schema";
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

  // Load company billing state — beta flag + any Stripe customer we've already seen.
  const companyRows = await db
    .select({ betaAccess: companiesTable.betaAccess, stripeCustomerId: companiesTable.stripeCustomerId })
    .from(companiesTable)
    .where(eq(companiesTable.id, user.companyId))
    .limit(1);
  const company = companyRows[0];

  // Beta companies never touch Stripe — they get full access for free, so no
  // customer, subscription, or trial is ever created and they can't be charged.
  if (company?.betaAccess) {
    await db
      .update(companiesTable)
      .set({ subscriptionStatus: "active", subscriptionTier: "pro" })
      .where(eq(companiesTable.id, user.companyId));
    res.json({ beta: true });
    return;
  }

  try {
    // Reuse an existing Stripe customer for this company/email so retries and
    // back-button navigation don't spawn duplicate customers + subscriptions.
    let customerId = company?.stripeCustomerId ?? null;
    if (!customerId) {
      const existing = await stripe.customers.list({ email: user.email, limit: 1 });
      customerId = existing.data[0]?.id ?? null;
    }

    // Still none → create one explicitly with an idempotency key, so a double-click
    // or retry can't mint a second customer (the key collapses concurrent/repeated
    // calls to the same customer for ~24h). We create it ourselves rather than let
    // Checkout do it implicitly precisely so we CAN attach the key.
    if (!customerId) {
      const created = await stripe.customers.create(
        { email: user.email, metadata: { companyId: user.companyId, userId: user.id } },
        { idempotencyKey: `cust:${user.companyId}` },
      );
      customerId = created.id;
    }

    // Persist so future checkouts skip the lookup entirely.
    if (customerId !== company?.stripeCustomerId) {
      await db
        .update(companiesTable)
        .set({ stripeCustomerId: customerId })
        .where(eq(companiesTable.id, user.companyId));
    }

    // Already paying/trialing? Don't create a second subscription — send them to
    // manage the existing one instead.
    const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
    const live = subs.data.find(s => s.status === "active" || s.status === "trialing");
    if (live) {
      res.json({ alreadySubscribed: true });
      return;
    }

    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customerId,
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
      },
      // Same intent (one user + plan) → same session for ~24h, so a double-click or
      // a retried request reuses one Checkout Session → one subscription.
      { idempotencyKey: `checkout:${user.id}:${planId}` },
    );

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

async function isCompanyBeta(companyId: string): Promise<boolean> {
  const rows = await db
    .select({ betaAccess: companiesTable.betaAccess })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId))
    .limit(1);
  return rows[0]?.betaAccess === true;
}

async function handleSubscriptionUpsert(
  subscription: Stripe.Subscription,
): Promise<void> {
  const companyId = subscription.metadata?.companyId;
  const plan = (subscription.metadata?.plan ?? "pro") as PlanId;
  if (!companyId) return;
  if (await isCompanyBeta(companyId)) return; // beta companies are off-billing — never sync from Stripe

  // Stripe API 2025-03-31 moved current_period_end off the subscription onto each item.
  const itemPeriodEnd = subscription.items.data[0]?.current_period_end;
  const periodEnd = itemPeriodEnd ? new Date(itemPeriodEnd * 1000) : null;

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
  if (await isCompanyBeta(companyId)) return; // don't downgrade a beta company (incl. our own beta-grant cancellation)

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
    .from(companyMembersTable)
    .innerJoin(usersTable, eq(usersTable.id, companyMembersTable.userId))
    .where(and(eq(companyMembersTable.companyId, companyId), eq(companyMembersTable.role, "admin")));

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
    .from(companyMembersTable)
    .innerJoin(usersTable, eq(usersTable.id, companyMembersTable.userId))
    .where(and(eq(companyMembersTable.companyId, companyId), eq(companyMembersTable.role, "admin")));

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

  // Signature is verified — acknowledge immediately so Stripe's ~10s delivery
  // window never times out, then do the slow DB work after responding. Handlers
  // are idempotent, so a redelivery (if one still arrives) is harmless.
  res.json({ received: true });
  void processWebhookEvent(stripe, event);
});

// Atomically record this event id. Returns true only if THIS call inserted it
// (i.e. first time we've seen it); a unique-PK conflict → already handled, so a
// concurrent duplicate or a Stripe redelivery returns false and is skipped.
async function claimEvent(event: Stripe.Event): Promise<boolean> {
  const inserted = await db
    .insert(stripeWebhookEventsTable)
    .values({ id: event.id, type: event.type })
    .onConflictDoNothing({ target: stripeWebhookEventsTable.id })
    .returning({ id: stripeWebhookEventsTable.id });
  return inserted.length > 0;
}

// Release a claim so a future Stripe redelivery can re-process the event. Used
// only when handling threw — otherwise the failed event would be swallowed (we
// already returned 200, so Stripe won't retry unless the ledger row is gone).
async function releaseEvent(eventId: string): Promise<void> {
  await db.delete(stripeWebhookEventsTable).where(eq(stripeWebhookEventsTable.id, eventId));
}

async function processWebhookEvent(stripe: Stripe, event: Stripe.Event): Promise<void> {
  // Idempotency gate: skip events we've already handled (Stripe retries/replays).
  try {
    if (!(await claimEvent(event))) {
      console.log(`Stripe webhook: duplicate ${event.type} (${event.id}) — skipping`);
      return;
    }
  } catch (err) {
    // Ledger unavailable — process anyway rather than drop the event; the
    // handlers are upsert-idempotent, so reprocessing is the safe direction.
    console.error("Stripe webhook: claimEvent failed, processing without dedup:", err);
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
    // Handling failed — drop the claim so a Stripe redelivery can re-process.
    await releaseEvent(event.id).catch(() => {});
  }
}

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
    const itemPeriodEnd = updated.items.data[0]?.current_period_end;
    const periodEnd = itemPeriodEnd ? new Date(itemPeriodEnd * 1000) : null;

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
