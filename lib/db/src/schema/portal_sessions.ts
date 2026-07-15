import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";

// Team Portal member sessions — the server-side source of truth for portal login
// lifetime. A portal JWT carries only a session id (`sid`); this row decides
// whether that session is still alive on every request:
//   • sliding 30-day expiry — `expires_at` is pushed forward on activity, so a
//     worker in regular use never has to re-type their password;
//   • 12-hour inactivity timeout — if `last_active_at` is older than 12h the
//     session is dead (a site/shared device left idle must re-authenticate);
//   • explicit logout / dashboard revoke — `revoked_at` is stamped, killing the
//     session immediately on its next request (not just clearing the client).
// Rows cascade away with the user or project.
export const portalSessionsTable = pgTable("portal_sessions", {
  id: text("id").primaryKey(), // the JWT's `sid`
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastActiveAt: timestamp("last_active_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(), // sliding; bumped to now+30d on activity
  revokedAt: timestamp("revoked_at"),           // explicit logout / access revoke
}, (t) => ({
  userProjectIdx: index("portal_sessions_user_project_idx").on(t.userId, t.projectId),
}));

export type PortalSession = typeof portalSessionsTable.$inferSelect;
