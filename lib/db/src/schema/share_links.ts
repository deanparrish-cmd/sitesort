import { pgTable, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

// Per-share links for drawings, project documents and permits (#127 Part B).
// The only way one of these files is opened without a SiteSort login: a link
// minted when someone shares it, valid for 30 days or until the item is
// superseded (a newer revision, a re-uploaded permit), whichever comes first.
// The token itself is never stored, only its SHA-256.
export const shareLinksTable = pgTable("share_links", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  companyId: text("company_id").notNull(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  itemType: text("item_type").notNull(), // document | permit
  itemId: text("item_id").notNull(),
  createdByUserId: text("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  // How it went out: email | whatsapp | qr | copy (first use, set by the share
  // log), or "request" for a link sent by approving an access request. Null =
  // minted for the share dialog but never sent; no reminder for those.
  method: text("method"),
  recipientInfo: text("recipient_info"),
  sentAt: timestamp("sent_at"),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
  revokedByUserId: text("revoked_by_user_id"),
  reminderSentAt: timestamp("reminder_sent_at"),
  openCount: integer("open_count").notNull().default(0),
  lastOpenedAt: timestamp("last_opened_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => [index("share_links_item_idx").on(t.itemType, t.itemId)]);

// Someone opened a link that no longer works and asked for access. The sender
// of that link or any approver on the project can approve, which emails the
// requester a fresh link to the item's CURRENT revision.
export const shareAccessRequestsTable = pgTable("share_access_requests", {
  id: text("id").primaryKey(),
  shareLinkId: text("share_link_id").notNull().references(() => shareLinksTable.id, { onDelete: "cascade" }),
  companyId: text("company_id").notNull(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  organisation: text("organisation"),
  note: text("note"),
  status: text("status").notNull().default("pending"), // pending | approved | declined
  decidedByUserId: text("decided_by_user_id"),
  decidedAt: timestamp("decided_at"),
  grantedShareLinkId: text("granted_share_link_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => [index("share_access_requests_company_idx").on(t.companyId, t.status)]);

export type ShareLink = typeof shareLinksTable.$inferSelect;
export type ShareAccessRequest = typeof shareAccessRequestsTable.$inferSelect;
