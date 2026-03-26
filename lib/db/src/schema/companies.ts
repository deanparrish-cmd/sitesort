import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const companiesTable = pgTable("companies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  size: text("size").notNull().default("1-10"),
  subscriptionTier: text("subscription_tier").notNull().default("free"),
  subscriptionStatus: text("subscription_status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCompanySchema = createInsertSchema(companiesTable).omit({ createdAt: true });
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companiesTable.$inferSelect;
