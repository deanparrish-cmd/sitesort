import { pgTable, text, timestamp, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { usersTable } from "./users";

export const projectsTable = pgTable("projects", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companiesTable.id),
  name: text("name").notNull(),
  address: text("address").notNull(),
  status: text("status").notNull().default("active"),
  startDate: date("start_date").notNull(),
  targetEndDate: date("target_end_date"),
  trades: text("trades").array().default([]),
  // Deliberately PM-chosen (never auto-picked) — see lib/site-board.ts. Null
  // means "not set", shown as such rather than falling back to any member.
  siteManagerId: text("site_manager_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({ createdAt: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
