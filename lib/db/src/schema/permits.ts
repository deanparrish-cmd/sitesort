import { pgTable, text, timestamp, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

export const permitsTable = pgTable("permits", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id),
  type: text("type").notNull(),
  description: text("description").notNull(),
  responsibleUserId: text("responsible_user_id").notNull().references(() => usersTable.id),
  startDate: date("start_date").notNull(),
  expiryDate: date("expiry_date").notNull(),
  documentUrl: text("document_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  archivedAt: timestamp("archived_at"),
});

export const insertPermitSchema = createInsertSchema(permitsTable).omit({ createdAt: true });
export type InsertPermit = z.infer<typeof insertPermitSchema>;
export type Permit = typeof permitsTable.$inferSelect;
