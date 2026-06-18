import { pgTable, text, timestamp, date, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { usersTable } from "./users";
import { projectsTable } from "./projects";

export const invoicesTable = pgTable("invoices", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companiesTable.id),
  createdBy: text("created_by").notNull().references(() => usersTable.id),
  projectId: text("project_id").references(() => projectsTable.id),
  direction: text("direction").notNull(), // "inbound" | "outbound"
  counterpartyName: text("counterparty_name").notNull(),
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("GBP"),
  dueDate: date("due_date").notNull(),
  status: text("status").notNull().default("pending"), // "pending" | "paid" | "overdue"
  reference: text("reference"),
  attachmentUrl: text("attachment_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({ createdAt: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;
