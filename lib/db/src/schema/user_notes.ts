import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { companiesTable } from "./companies";

export const userNotesTable = pgTable("user_notes", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  authorId: text("author_id").notNull().references(() => usersTable.id),
  // The company the note was written in; notes never cross companies (#121).
  companyId: text("company_id").references(() => companiesTable.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserNoteSchema = createInsertSchema(userNotesTable).omit({ createdAt: true });
export type InsertUserNote = z.infer<typeof insertUserNoteSchema>;
export type UserNote = typeof userNotesTable.$inferSelect;
