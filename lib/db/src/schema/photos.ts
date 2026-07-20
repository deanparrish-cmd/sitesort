import { pgTable, text, timestamp, numeric, date } from "drizzle-orm/pg-core";
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
  status: text("status"),
  resolvedAt: timestamp("resolved_at"),
  // Assignment & accountability (F1) — who is responsible for actioning this
  // issue and by when. Nullable; "overdue" is derived (dueDate < today && not resolved).
  assignedToUserId: text("assigned_to_user_id").references(() => usersTable.id),
  dueDate: date("due_date"),
  // Portal-triage closure detail. "resolved" is the sole terminal status for every
  // closure path (normal completion, invalid, duplicate) — these two columns
  // distinguish which. closureNote is required server-side when closureReason is
  // "invalid" or "duplicate".
  closureReason: text("closure_reason"),
  closureNote: text("closure_note"),
  updatedAt: timestamp("updated_at"),
  // Soft-delete for site issues (manager-only). Archived issues drop out of
  // normal lists/counts but remain in the record — auditable via an
  // "Archived" filter, never actually removed here (see the separate
  // admin-only hard-delete for genuine test/mistake data).
  archivedAt: timestamp("archived_at"),
  archivedBy: text("archived_by").references(() => usersTable.id),
  archiveReason: text("archive_reason"),
  // Removing just the attached photo (not the whole issue) is also soft —
  // photoUrl is left untouched in the DB, only hidden from normal reads once
  // photoRemovedAt is set, so the record can't be silently corrupted.
  photoRemovedAt: timestamp("photo_removed_at"),
  photoRemovedBy: text("photo_removed_by").references(() => usersTable.id),
});

export const insertPhotoSchema = createInsertSchema(photosTable).omit({ takenAt: true });
export type InsertPhoto = z.infer<typeof insertPhotoSchema>;
export type Photo = typeof photosTable.$inferSelect;
