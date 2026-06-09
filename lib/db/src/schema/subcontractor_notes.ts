import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { subcontractorsTable } from "./subcontractors";
import { usersTable } from "./users";
import { projectsTable } from "./projects";

export const subcontractorNotesTable = pgTable("subcontractor_notes", {
  id: text("id").primaryKey(),
  subcontractorId: text("subcontractor_id").notNull().references(() => subcontractorsTable.id),
  authorId: text("author_id").notNull().references(() => usersTable.id),
  body: text("body").notNull(),
  projectId: text("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSubcontractorNoteSchema = createInsertSchema(subcontractorNotesTable).omit({ createdAt: true });
export type InsertSubcontractorNote = z.infer<typeof insertSubcontractorNoteSchema>;
export type SubcontractorNote = typeof subcontractorNotesTable.$inferSelect;
