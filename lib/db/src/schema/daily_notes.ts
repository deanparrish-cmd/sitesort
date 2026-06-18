import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

export const dailyNotesTable = pgTable("daily_notes", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id),
  authorId: text("author_id").notNull().references(() => usersTable.id),
  noteDate: text("note_date").notNull(),
  body: text("body").notNull(),
  source: text("source").notNull().default("voice"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertDailyNoteSchema = createInsertSchema(dailyNotesTable).omit({ createdAt: true });
export type InsertDailyNote = z.infer<typeof insertDailyNoteSchema>;
export type DailyNote = typeof dailyNotesTable.$inferSelect;
