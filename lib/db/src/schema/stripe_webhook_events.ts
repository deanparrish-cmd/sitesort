import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Dedup ledger for Stripe webhook deliveries. Stripe redelivers the SAME event
// (its `evt_…` id is stable across retries and dashboard replays), so we record
// each handled event id and skip re-processing — this is what stops a retried
// `checkout.session.completed` from creating duplicate subscriptions / charges
// or duplicate notification rows. `id` IS the Stripe event id (the PK), so the
// insert itself is the idempotency gate (ON CONFLICT DO NOTHING).
export const stripeWebhookEventsTable = pgTable("stripe_webhook_events", {
  id: text("id").primaryKey(), // Stripe event id, e.g. "evt_1a2b3c"
  type: text("type").notNull(),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
});

export type StripeWebhookEvent = typeof stripeWebhookEventsTable.$inferSelect;
