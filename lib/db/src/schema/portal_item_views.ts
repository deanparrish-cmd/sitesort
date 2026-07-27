import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

// Per-member "opened it" receipts for portal-shared items that have no other
// per-viewer tracking. Documents already use document_distributions.viewed_at
// (the PM dashboard reads those counts) — this table covers everything else
// shared through portal_shares: permits, daily reports, photos. First open
// wins; the timestamp never moves after that, so "Received <when>" is stable.
export const portalItemViewsTable = pgTable("portal_item_views", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  itemType: text("item_type").notNull(), // 'permit' | 'daily_report' | 'photo'
  itemId: text("item_id").notNull(),
  viewedAt: timestamp("viewed_at").notNull().defaultNow(),
}, (t) => ({
  uq: uniqueIndex("portal_item_views_uq").on(t.userId, t.itemType, t.itemId),
}));
