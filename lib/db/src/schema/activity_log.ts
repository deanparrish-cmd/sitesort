import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

// Team Portal activity audit (Feature: Team Portal). One row per portal
// section-open / document-view, written automatically by portal middleware (not
// per-page manual calls). `section` is one of the fixed portal sections
// (overview, drawings, ...); `action` is "view" for reads and "blocked" for a
// denied out-of-scope attempt. `itemType`/`itemId` capture the specific document
// or record viewed when applicable. userAgent/ipAddress are best-effort. Powers
// the PM's Team Activity feed + per-member summary on the main dashboard.
export const activityLogTable = pgTable("activity_log", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  companyId: text("company_id").notNull(),
  section: text("section").notNull(),
  action: text("action").notNull().default("view"),
  itemType: text("item_type"),
  itemId: text("item_id"),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  projectIdx: index("activity_log_project_idx").on(t.projectId, t.createdAt),
  userIdx: index("activity_log_user_idx").on(t.userId, t.createdAt),
}));

export type ActivityLog = typeof activityLogTable.$inferSelect;
