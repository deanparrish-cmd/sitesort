import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { subcontractorsTable } from "./subcontractors";
import { usersTable } from "./users";
import { projectsTable } from "./projects";

// F6 — versioned documents on a subcontractor/merchant contact (T&Cs, tax
// forms, certifications, ID verification — insurance stays in its own
// dedicated insurance_records feature). Null projectId = company-wide base
// doc visible from the directory; set projectId = per-project extra.
export const subcontractorDocumentsTable = pgTable("subcontractor_documents", {
  id: text("id").primaryKey(),
  subcontractorId: text("subcontractor_id").notNull().references(() => subcontractorsTable.id),
  projectId: text("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  uploadedBy: text("uploaded_by").notNull().references(() => usersTable.id),
  name: text("name").notNull(),
  type: text("type").notNull(),
  version: integer("version").notNull().default(1),
  fileUrl: text("file_url").notNull(),
  fileSize: integer("file_size").notNull().default(0),
  previousVersionId: text("previous_version_id"),
  status: text("status").notNull().default("current"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSubcontractorDocumentSchema = createInsertSchema(subcontractorDocumentsTable).omit({ createdAt: true });
export type InsertSubcontractorDocument = z.infer<typeof insertSubcontractorDocumentSchema>;
export type SubcontractorDocument = typeof subcontractorDocumentsTable.$inferSelect;
