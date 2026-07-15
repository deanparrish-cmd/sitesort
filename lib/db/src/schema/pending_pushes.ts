import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";

// Debounce/batch queue for member push notifications. A trigger (a share, a new
// site notice) enqueues one row here instead of pushing immediately; a flush job
// collapses all of a member's rows that have settled (no new row for a short
// quiet period) into ONE notification — so "3 drawings shared at once" is a
// single push, not three. Rows are deleted once flushed. Cascades with user/project.
export const pendingPushesTable = pgTable("pending_pushes", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  // 'document' (drawings/docs shared) | 'site_update' (daily note / safety notice)
  kind: text("kind").notNull(),
  itemType: text("item_type"), // e.g. 'drawing', 'document', 'note', 'safety'
  itemId: text("item_id"),
  title: text("title").notNull(),   // human label of the single item (for 1-item pushes)
  projectName: text("project_name").notNull(),
  deepLink: text("deep_link").notNull(), // portal path for a single-item notification
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  userIdx: index("pending_pushes_user_idx").on(t.userId, t.createdAt),
}));

export type PendingPush = typeof pendingPushesTable.$inferSelect;
