import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { subcontractorsTable } from "./subcontractors";

export const projectMembersTable = pgTable("project_members", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id),
  userId: text("user_id").references(() => usersTable.id),
  subcontractorId: text("subcontractor_id").references(() => subcontractorsTable.id),
  role: text("role").notNull().default("worker"),
  addedAt: timestamp("added_at").notNull().defaultNow(),
});

export const insertProjectMemberSchema = createInsertSchema(projectMembersTable).omit({ addedAt: true });
export type InsertProjectMember = z.infer<typeof insertProjectMemberSchema>;
export type ProjectMember = typeof projectMembersTable.$inferSelect;
