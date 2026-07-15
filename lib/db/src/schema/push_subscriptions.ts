import { pgTable, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";

// Web Push subscriptions — one row per member PER DEVICE (the browser's push
// endpoint is the device identity, and is unique). Presence of a row = that
// member has push enabled on that device. Rows are deleted on explicit logout,
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
}, (t) => ({
  endpointUq: uniqueIndex("push_subscriptions_endpoint_uq").on(t.endpoint),
  userIdx: index("push_subscriptions_user_idx").on(t.userId, t.projectId),
}));

export type PushSubscription = typeof pushSubscriptionsTable.$inferSelect;
