import Stripe from "stripe";
import type { Logger } from "pino";
import { db } from "@workspace/db";
import { failedStripeCancellationsTable } from "@workspace/db/schema";
import { generateId } from "./id";

// Cancels every live (active/trialing) Stripe subscription for a customer.
// Used both when granting beta access (so they can never be charged again)
// and after a company is deleted (so a removed tenant can't keep billing).
//
// Never throws: a Stripe failure must not block the deletion/grant that
// called this. Instead, each failure is logged loudly AND written to
// failed_stripe_cancellations — a persistent, admin-reviewable record — so a
// missed cancellation can't quietly turn into a subscription that bills
// forever with no trace. Call this AFTER any DB deletion has already
// committed, not before: cancelling Stripe first and then having the DB step
// fail would wrongly cancel a subscription for a company that's still active.
export async function cancelLiveStripeSubscriptions(
  companyId: string,
  companyName: string,
  stripeCustomerId: string | null,
  log: Logger,
): Promise<{ cancelled: number; failed: number }> {
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey || !stripeCustomerId) return { cancelled: 0, failed: 0 };

  const stripe = new Stripe(apiKey);
  let live: Stripe.Subscription[];
  try {
    const subs = await stripe.subscriptions.list({ customer: stripeCustomerId, status: "all", limit: 100 });
    live = subs.data.filter(s => s.status === "active" || s.status === "trialing");
  } catch (err) {
    log.error({ err, companyId, stripeCustomerId }, "STRIPE CANCELLATION FAILED — could not list subscriptions, possible ghost billing");
    await recordFailure(companyId, companyName, stripeCustomerId, null, err);
    return { cancelled: 0, failed: 1 };
  }

  let cancelled = 0, failed = 0;
  for (const s of live) {
    try {
      await stripe.subscriptions.cancel(s.id);
      cancelled++;
    } catch (err) {
      log.error({ err, companyId, stripeCustomerId, subscriptionId: s.id }, "STRIPE CANCELLATION FAILED — subscription may keep billing");
      await recordFailure(companyId, companyName, stripeCustomerId, s.id, err);
      failed++;
    }
  }
  return { cancelled, failed };
}

async function recordFailure(
  companyId: string, companyName: string, stripeCustomerId: string, subscriptionId: string | null, err: unknown,
): Promise<void> {
  try {
    await db.insert(failedStripeCancellationsTable).values({
      id: generateId(),
      companyId,
      companyName,
      stripeCustomerId,
      subscriptionId,
      errorMessage: String((err as Error)?.message ?? err),
    });
  } catch (insertErr) {
    // If even the failure record can't be written, this is the last line of
    // defence — make sure it's in the logs at minimum.
    console.error("CRITICAL: failed to record a failed Stripe cancellation", { companyId, stripeCustomerId, subscriptionId, err, insertErr });
  }
}
