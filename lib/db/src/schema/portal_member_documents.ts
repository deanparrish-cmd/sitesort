import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { peopleTable } from "./people";

// Contractor "My Documents": a portal member self-uploads a document (insurance,
// certification, etc.) into a project, which a project manager then reviews and
// approves or rejects. Distinct from the PM-owned documents table — these are
// member-submitted and gated behind a review workflow before they carry weight.
export const portalMemberDocumentsTable = pgTable("portal_member_documents", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => usersTable.id), // uploader (portal member)
  personId: text("person_id").references(() => peopleTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  fileUrl: text("file_url").notNull(),
  fileSize: integer("file_size").notNull().default(0),
  kind: text("kind").notNull(),                 // free text e.g. 'insurance' | 'certification' | 'other'
  status: text("status").notNull().default("pending"), // 'pending' | 'approved' | 'rejected'
  reviewNote: text("review_note"),
  reviewedByUserId: text("reviewed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  projectIdx: index("portal_member_documents_project_idx").on(t.projectId),
  userIdx: index("portal_member_documents_user_idx").on(t.userId),
}));

export const insertPortalMemberDocumentSchema = createInsertSchema(portalMemberDocumentsTable).omit({ createdAt: true });
export type InsertPortalMemberDocument = z.infer<typeof insertPortalMemberDocumentSchema>;
export type PortalMemberDocument = typeof portalMemberDocumentsTable.$inferSelect;
