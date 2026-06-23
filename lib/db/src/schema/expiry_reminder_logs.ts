import { pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

// Records which expiry-reminder emails have already been sent so the daily job
// fires each milestone exactly once. `entityType` is 'permit' | 'insurance';
// `milestone` is one of the pre-expiry thresholds ('30','21','14','7','1') or an
// expired-day marker ('exp-0' … 'exp-6', i.e. day-of-expiry through 6 days past).
export const expiryReminderLogsTable = pgTable("expiry_reminder_logs", {
  id: text("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  milestone: text("milestone").notNull(),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
}, (t) => [unique("expiry_reminder_logs_entity_milestone_uq").on(t.entityType, t.entityId, t.milestone)]);

export const insertExpiryReminderLogSchema = z.object({
  id: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  milestone: z.string(),
});
export type InsertExpiryReminderLog = z.infer<typeof insertExpiryReminderLogSchema>;
export type ExpiryReminderLog = typeof expiryReminderLogsTable.$inferSelect;
