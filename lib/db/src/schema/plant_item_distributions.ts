import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { plantItemsTable } from "./plant_items";
import { usersTable } from "./users";

// Mirrors document_distributions exactly (including its no-cascade FKs) — the
// "Allocate" pending/viewed/acknowledged tracking mechanism, for plant/material
// items instead of documents.
export const plantItemDistributionsTable = pgTable("plant_item_distributions", {
  id: text("id").primaryKey(),
  plantItemId: text("plant_item_id").notNull().references(() => plantItemsTable.id),
  userId: text("user_id").notNull().references(() => usersTable.id),
  status: text("status").notNull().default("pending"),
  distributedAt: timestamp("distributed_at").notNull().defaultNow(),
  viewedAt: timestamp("viewed_at"),
  acknowledgedAt: timestamp("acknowledged_at"),
  signedOffWithPin: boolean("signed_off_with_pin").notNull().default(false),
  deviceInfo: text("device_info"),
});

export const insertPlantItemDistributionSchema = createInsertSchema(plantItemDistributionsTable).omit({ distributedAt: true });
export type InsertPlantItemDistribution = z.infer<typeof insertPlantItemDistributionSchema>;
export type PlantItemDistribution = typeof plantItemDistributionsTable.$inferSelect;
