import { Router } from "express";
import Stripe from "stripe";
import { authenticate } from "../middlewares/auth";

const router = Router();

const APP_URL =
  process.env.APP_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN ?? "sitesort.co.uk"}`;

router.post("/billing/checkout", authenticate, async (req, res) => {
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "STRIPE_SECRET_KEY is not set" });
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
              name: "SiteSort",
              description: "Monthly subscription to SiteSort",
            },
            unit_amount: 2900,
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
