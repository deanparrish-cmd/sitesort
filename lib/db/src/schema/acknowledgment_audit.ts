import { pgTable, text, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { documentsTable } from "./documents";
import { usersTable } from "./users";

// Append-only audit trail for document acknowledgments / sign-offs.
// Rows are only ever inserted — never updated or deleted — so there is a
// permanent, defensible record of who signed off what, when, and how.
export const acknowledgmentAuditTable = pgTable("acknowledgment_audit_log", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull().references(() => documentsTable.id),
  documentVersion: integer("document_version").notNull(),
  userId: text("user_id").notNull().references(() => usersTable.id),
  // Snapshot of the actor's name/role at sign-off time so the record stays
  // accurate even if the user is later renamed or has their role changed.
  userName: text("user_name").notNull(),
  userRole: text("user_role").notNull(),
  action: text("action").notNull().default("acknowledged"),
  signedOffWithPin: boolean("signed_off_with_pin").notNull().default(false),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("ack_audit_document_idx").on(t.documentId),
  index("ack_audit_user_idx").on(t.userId),
]);

export const insertAcknowledgmentAuditSchema = createInsertSchema(acknowledgmentAuditTable).omit({ createdAt: true });
export type InsertAcknowledgmentAudit = z.infer<typeof insertAcknowledgmentAuditSchema>;
export type AcknowledgmentAudit = typeof acknowledgmentAuditTable.$inferSelect;
