import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

// One row per email the deployed app hands to Resend (2026-10-16). Before this,
// a refused or bounced email left no trace in SiteSort: a builder's portal
// invite could bounce while his card still said "sent". The Resend webhook
// (routes/email-webhook.ts) updates `status` by `provider_id`.
//   status: sent | refused | delivered | delayed | bounced | complained
//   ref_type/ref_id: what the email was for (e.g. project_invite + invite id,
//   reminder + "insurance:<id>:7"), so a bounce can be traced back to it.
// No foreign keys on purpose: the log outlives what it refers to.
export const emailLogTable = pgTable("email_log", {
  id: text("id").primaryKey(),
  providerId: text("provider_id"),
  toAddress: text("to_address").notNull(),
  subject: text("subject").notNull(),
  refType: text("ref_type"),
  refId: text("ref_id"),
  status: text("status").notNull(),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("email_log_provider_idx").on(t.providerId),
  index("email_log_ref_idx").on(t.refType, t.refId),
]);

export type EmailLog = typeof emailLogTable.$inferSelect;
