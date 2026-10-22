import { pgTable, text, timestamp, boolean, integer, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";

// One row per alert sent to one phone (push endpoint). Apple/Google accepting a
// push proves nothing about the screen (2026-10-21: a gate hold, 4 of 4
// accepted, no banner), so the service worker reports back: `received_at` when
// the push reached the phone and the notification was posted, `tapped_at` when
// it was tapped. A test alert also records the person's own answer to "Did a
// banner appear?", the only signal that tells a dead install from Focus / Do
// Not Disturb. `send_result`: accepted | gone (404/410, registration removed) |
// failed | pruned (a marker row: the phone was removed after 7 unanswered).
export const pushAlertsTable = pgTable("push_alerts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull(),
  kind: text("kind").notNull().default("alert"),
  tag: text("tag"),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
  sendResult: text("send_result").notNull(),
  sendStatus: integer("send_status"),
  // Service worker version on the phone when this was sent (null = an old one
  // that can't report back, so silence proves nothing).
  deviceSw: text("device_sw"),
  // The service worker ran: reported before it tries to show anything.
  arrivedAt: timestamp("arrived_at"),
  // showNotification finished: shown = it resolved, showError = what it threw,
  // posted = the notification is in the phone's list afterwards, foreground =
  // a SiteSort window was visible (iOS shows no banner over the open app).
  receivedAt: timestamp("received_at"),
  shown: boolean("shown"),
  showError: text("show_error"),
  posted: boolean("posted"),
  foreground: boolean("foreground"),
  swVersion: text("sw_version"),
  // What setAppBadge did with the payload's count: set:N, cleared, unsupported, or the error.
  badgeResult: text("badge_result"),
  // Test alerts: "Did a number appear on the SiteSort icon?" (Badges can be
  // off in Settings while banners work, and the app is never told).
  iconAnswer: text("icon_answer"),
  iconAnsweredAt: timestamp("icon_answered_at"),
  permission: text("permission"),
  tappedAt: timestamp("tapped_at"),
  bannerAnswer: text("banner_answer"),
  answeredAt: timestamp("answered_at"),
}, (t) => ({
  endpointIdx: index("push_alerts_endpoint_idx").on(t.endpoint, t.sentAt),
  userIdx: index("push_alerts_user_idx").on(t.userId, t.sentAt),
}));

export type PushAlert = typeof pushAlertsTable.$inferSelect;
