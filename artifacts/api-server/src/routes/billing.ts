import { Router } from "express";
import Stripe from "stripe";
import { authenticate } from "../middlewares/auth";

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

export default router;
