import { pgTable, text, timestamp, date } from "drizzle-orm/pg-core";
// archivedAt is set when a newer certificate for the same type is uploaded, preserving the old record for audit
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { subcontractorsTable } from "./subcontractors";
import { usersTable } from "./users";

export const insuranceRecordsTable = pgTable("insurance_records", {
  id: text("id").primaryKey(),
  subcontractorId: text("subcontractor_id").notNull().references(() => subcontractorsTable.id),
  type: text("type").notNull(),
  certificateUrl: text("certificate_url").notNull(),
  expiryDate: date("expiry_date").notNull(),
  status: text("status").notNull().default("valid"),
  // Assignment & accountability (F1 Phase 3) — the company user accountable for
  // chasing this cert's renewal, plus the (optional) action deadline. Insurance
  // has no pre-existing responsible field, so both are added here. "Overdue" is
  // derived (dueDate < today && not yet archived/renewed), never stored.
  assignedToUserId: text("assigned_to_user_id").references(() => usersTable.id),
  dueDate: date("due_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  archivedAt: timestamp("archived_at"),
});

export const insertInsuranceRecordSchema = createInsertSchema(insuranceRecordsTable).omit({ createdAt: true });
export type InsertInsuranceRecord = z.infer<typeof insertInsuranceRecordSchema>;
export type InsuranceRecord = typeof insuranceRecordsTable.$inferSelect;
