import { pgTable, text, timestamp, real } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

export const siteCheckinsTable = pgTable("site_checkins", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  workerName: text("worker_name").notNull(),
  photoUrl: text("photo_url").notNull(),
  checkedInAt: timestamp("checked_in_at").notNull().defaultNow(),
  lat: real("lat"),
  lng: real("lng"),
});

export type SiteCheckin = typeof siteCheckinsTable.$inferSelect;
