import { pgTable, text, timestamp, date, integer } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

export const milestonesTable = pgTable("milestones", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  dueDate: date("due_date").notNull(),
  completedAt: timestamp("completed_at"),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Milestone = typeof milestonesTable.$inferSelect;
