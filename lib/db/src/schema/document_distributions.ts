import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { documentsTable } from "./documents";
import { usersTable } from "./users";

export const documentDistributionsTable = pgTable("document_distributions", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull().references(() => documentsTable.id),
  userId: text("user_id").notNull().references(() => usersTable.id),
  status: text("status").notNull().default("pending"),
  distributedAt: timestamp("distributed_at").notNull().defaultNow(),
  viewedAt: timestamp("viewed_at"),
  acknowledgedAt: timestamp("acknowledged_at"),
  signedOffWithPin: boolean("signed_off_with_pin").notNull().default(false),
  // Reached the end before sign-off (2026-10-24): when, and how the phone
  // reported it (scrolled | one_screen | opened_outside_render_failed | opened_outside).
  reachedEndAt: timestamp("reached_end_at"),
  reachedEndHow: text("reached_end_how"),
  deviceInfo: text("device_info"),
});

export const insertDocumentDistributionSchema = createInsertSchema(documentDistributionsTable).omit({ distributedAt: true });
export type InsertDocumentDistribution = z.infer<typeof insertDocumentDistributionSchema>;
export type DocumentDistribution = typeof documentDistributionsTable.$inferSelect;
