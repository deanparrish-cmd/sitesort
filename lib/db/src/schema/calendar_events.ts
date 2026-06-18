import { pgTable, text, date, timestamp } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { usersTable } from "./users";
import { projectsTable } from "./projects";

// Custom, user-authored calendar events. Company-scoped: every member of the
// company sees them on their dashboard Site Calendar. Created by managers
// (admin / project_manager) for the whole team.
// projectId is optional: null = company-wide (shows on every project's site
// board); set = scoped to one project (shows only on that project's board).
export const calendarEventsTable = pgTable("calendar_events", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  createdBy: text("created_by").notNull().references(() => usersTable.id),
  projectId: text("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  eventDate: date("event_date").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type CalendarEvent = typeof calendarEventsTable.$inferSelect;
