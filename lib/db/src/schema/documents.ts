import { pgTable, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

export const documentsTable = pgTable("documents", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id),
  uploadedBy: text("uploaded_by").notNull().references(() => usersTable.id),
  name: text("name").notNull(),
  type: text("type").notNull(),
  version: integer("version").notNull().default(1),
  // Alphabetical drawing revision label (F3). Drawings default to A, B, C… by
  // version but can be overridden to match the title block (C, P01, C02…).
  // Null for non-drawing documents that don't use revisions.
  revision: text("revision"),
  fileUrl: text("file_url").notNull(),
  fileSize: integer("file_size").notNull().default(0),
  previousVersionId: text("previous_version_id"),
  status: text("status").notNull().default("current"),
  requiresAcknowledgment: boolean("requires_acknowledgment").notNull().default(false),
  // Per-document PIN override (in addition to the always-PIN safety-critical
  // types: method_statement, permit, safety). When true, sign-off requires the
  // member's 4-digit PIN even for otherwise click-to-confirm doc types.
  requirePinSignoff: boolean("require_pin_signoff").notNull().default(false),
  publicAccess: boolean("public_access").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({ createdAt: true });
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;
