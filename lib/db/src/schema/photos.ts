import { pgTable, text, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

export const photosTable = pgTable("photos", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id),
  uploadedBy: text("uploaded_by").notNull().references(() => usersTable.id),
  photoUrl: text("photo_url"),
  category: text("category").notNull(),
  description: text("description"),
  zone: text("zone"),
  referenceNumber: text("reference_number").notNull(),
  latitude: numeric("latitude"),
  longitude: numeric("longitude"),
  takenAt: timestamp("taken_at").notNull().defaultNow(),
});

export const insertPhotoSchema = createInsertSchema(photosTable).omit({ takenAt: true });
export type InsertPhoto = z.infer<typeof insertPhotoSchema>;
export type Photo = typeof photosTable.$inferSelect;
