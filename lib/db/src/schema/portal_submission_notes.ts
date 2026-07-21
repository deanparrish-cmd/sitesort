import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

// Append-only "add a note" thread shared by all 3 portal save-vs-submit
// features (site issues, plant items, daily reports) — once an item is
// submitted, its original fields lock and further updates are additions here,
// never edits to the original. One shared table keyed by (itemType, itemId)
// rather than 3 near-identical tables, since the semantics are identical.
export const portalSubmissionNotesTable = pgTable("portal_submission_notes", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  itemType: text("item_type").notNull(), // 'site_issue' | 'plant_item' | 'daily_report'
  itemId: text("item_id").notNull(),
  authorId: text("author_id").notNull().references(() => usersTable.id),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  itemIdx: index("portal_submission_notes_item_idx").on(t.itemType, t.itemId),
}));

export const insertPortalSubmissionNoteSchema = createInsertSchema(portalSubmissionNotesTable).omit({ createdAt: true });
export type InsertPortalSubmissionNote = z.infer<typeof insertPortalSubmissionNoteSchema>;
export type PortalSubmissionNote = typeof portalSubmissionNotesTable.$inferSelect;
