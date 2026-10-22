import { pgTable, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";

// Web Push subscriptions — one row per device PER PROJECT (the browser's push
// endpoint is the device identity). A device registers for every project its
// member is on, so alerts for one project don't stop when the phone opens
// another. Presence of a row = push on for that device on that project. Rows are deleted on explicit logout,
// on a settings toggle-off, and when a member's portal access is revoked (so a
// revoked member receives nothing). Cascades with the user + project.
export const pushSubscriptionsTable = pgTable("push_subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  // Service worker version reported at the last registration (null = old, no receipts).
  swVersion: text("sw_version"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
}, (t) => ({
  endpointProjectUq: uniqueIndex("push_subscriptions_endpoint_project_uq").on(t.endpoint, t.projectId),
  userIdx: index("push_subscriptions_user_idx").on(t.userId, t.projectId),
}));

export type PushSubscription = typeof pushSubscriptionsTable.$inferSelect;
