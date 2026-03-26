import { pgTable, text, timestamp, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { subcontractorsTable } from "./subcontractors";

export const insuranceRecordsTable = pgTable("insurance_records", {
  id: text("id").primaryKey(),
  subcontractorId: text("subcontractor_id").notNull().references(() => subcontractorsTable.id),
  type: text("type").notNull(),
  certificateUrl: text("certificate_url").notNull(),
  expiryDate: date("expiry_date").notNull(),
  status: text("status").notNull().default("valid"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertInsuranceRecordSchema = createInsertSchema(insuranceRecordsTable).omit({ createdAt: true });
export type InsertInsuranceRecord = z.infer<typeof insertInsuranceRecordSchema>;
export type InsuranceRecord = typeof insuranceRecordsTable.$inferSelect;
