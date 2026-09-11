import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

// A Stripe subscription cancellation that failed during company deletion or
// a beta-access grant. Deliberately has NO foreign key to companies/users —
// the whole point of this table is to survive the company row being deleted
// in the same operation, so a missed cancellation can never lose its trail.
// companyId/companyName are a snapshot at the time of failure, not a live
// reference. Never delete rows here; mark them resolved once handled in
// Stripe directly, so a fixed one drops out of the admin-visible list
// without ever losing the record that it happened.
export const failedStripeCancellationsTable = pgTable("failed_stripe_cancellations", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  companyName: text("company_name").notNull(),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  subscriptionId: text("subscription_id"), // null if we failed before even listing subscriptions
  errorMessage: text("error_message").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
  resolvedByUserId: text("resolved_by_user_id"),
}, (t) => [
  index("failed_stripe_cancellations_unresolved_idx").on(t.resolvedAt),
]);

export type FailedStripeCancellation = typeof failedStripeCancellationsTable.$inferSelect;
