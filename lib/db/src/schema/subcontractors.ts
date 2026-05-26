import { pgTable, text, timestamp, boolean, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

export const subcontractorsTable = pgTable("subcontractors", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companiesTable.id),
  companyName: text("company_name").notNull(),
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email").notNull(),
  contactPhone: text("contact_phone"),
  avatarUrl: text("avatar_url"),
  trades: text("trades").array().notNull().default([]),
  reliabilityRating: numeric("reliability_rating"),
  paymentHold: boolean("payment_hold").notNull().default(false),
  notes: text("notes"),
  inviteToken: text("invite_token"),
  inviteUsedAt: timestamp("invite_used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSubcontractorSchema = createInsertSchema(subcontractorsTable).omit({ createdAt: true });
export type InsertSubcontractor = z.infer<typeof insertSubcontractorSchema>;
export type Subcontractor = typeof subcontractorsTable.$inferSelect;
