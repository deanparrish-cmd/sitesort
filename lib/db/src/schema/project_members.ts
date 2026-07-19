import { pgTable, text, timestamp, time, uniqueIndex, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { subcontractorsTable } from "./subcontractors";
import { peopleTable } from "./people";

export const projectMembersTable = pgTable("project_members", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id),
  userId: text("user_id").references(() => usersTable.id),
  subcontractorId: text("subcontractor_id").references(() => subcontractorsTable.id),
  // The individual person behind a portal membership (subcontractor person or
  // in-house member). Nullable: the pre-existing subcontractor-company link rows
  // (subcontractorId set, no person) and legacy user rows keep personId NULL.
  personId: text("person_id").references(() => peopleTable.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("worker"),
  scheduledDays: text("scheduled_days").array().default([]),
  siteStartTime: time("site_start_time"),
  siteEndTime: time("site_end_time"),
  // Portal write permissions (per-project grants — a person may be trusted
  // differently on different jobs). Enforced server-side by
  // requirePortalPermission, not just hidden in the UI.
  canLogIssues: boolean("can_log_issues").notNull().default(true),
  canUpdatePlantMaterials: boolean("can_update_plant_materials").notNull().default(false),
  canEditDailyReport: boolean("can_edit_daily_report").notNull().default(false),
  addedAt: timestamp("added_at").notNull().defaultNow(),
}, (t) => ({
  // Team Portal: a user is a member of a project at most once (the same email
  // can still be invited to OTHER projects — that's a different row). Partial so
  // it never conflicts with subcontractor-only rows (user_id NULL).
  userUq: uniqueIndex("project_members_project_user_uq")
    .on(t.projectId, t.userId)
    .where(sql`${t.userId} is not null`),
}));

export const insertProjectMemberSchema = createInsertSchema(projectMembersTable).omit({ addedAt: true });
export type InsertProjectMember = z.infer<typeof insertProjectMemberSchema>;
export type ProjectMember = typeof projectMembersTable.$inferSelect;
