import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

// Project close-out / handover sign-off (F2). Append-only audit: each formal
// close-out inserts a row (who signed off, role snapshot, optional note, device
// info). Re-opening a project does NOT delete rows — the history is immutable;
// "currently closed out" is derived from projects.status === "complete". A new
// close-out after a re-open simply appends another row.
export const projectCloseoutsTable = pgTable("project_closeouts", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  signedOffByUserId: text("signed_off_by_user_id").notNull().references(() => usersTable.id),
  signedOffByName: text("signed_off_by_name").notNull(),
  signedOffByRole: text("signed_off_by_role").notNull(),
  note: text("note"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ProjectCloseout = typeof projectCloseoutsTable.$inferSelect;
