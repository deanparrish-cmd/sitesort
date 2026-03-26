import { pgTable, text, timestamp, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

export const projectsTable = pgTable("projects", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companiesTable.id),
  name: text("name").notNull(),
  address: text("address").notNull(),
  status: text("status").notNull().default("active"),
  startDate: date("start_date").notNull(),
  targetEndDate: date("target_end_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({ createdAt: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
