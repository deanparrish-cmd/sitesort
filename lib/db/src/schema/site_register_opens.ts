import { pgTable, text, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";

// When a dashboard login (company admin / PM) last opened a project's Site
// Register (2026-10-22). Portal holders record theirs on project_members
// (register_opened_at); admins and PMs often have no membership row. Feeds
// fire-roll readiness check 5 ("today's copy is on a phone").
export const siteRegisterOpensTable = pgTable("site_register_opens", {
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  openedAt: timestamp("opened_at").notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.projectId, t.userId] }) }));
