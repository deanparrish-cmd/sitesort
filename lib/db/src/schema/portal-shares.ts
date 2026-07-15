import { pgTable, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { peopleTable } from "./people";
import { usersTable } from "./users";

// Team Portal share targets. A PM shares a Document / Photo (Site Issue) / Permit
// to a portal AUDIENCE, and this table is the source of truth for portal
// visibility (gated: members see only what a rule matches for them, except
// `safety` documents which are always open). Trade shares are stored as a RULE
// (project + trade), resolved at read time via person → subcontractor.trades,
// so they reach members invited later. Polymorphic (item_type/item_id) like
// qr_board_pins — no per-item FK; rows cascade on project delete.
export const portalSharesTable = pgTable("portal_shares", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  itemType: text("item_type").notNull(),       // 'document' | 'photo' | 'permit'
  itemId: text("item_id").notNull(),
  audienceType: text("audience_type").notNull(), // 'all' | 'trade' | 'person'
  trade: text("trade"),                          // set when audience_type='trade'
  personId: text("person_id").references(() => peopleTable.id, { onDelete: "cascade" }), // when 'person'
  sharedByUserId: text("shared_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  // One rule per (item, audience). coalesce so 'all' rows (trade/person NULL) dedupe.
  uq: uniqueIndex("portal_shares_uq").on(
    t.projectId, t.itemType, t.itemId, t.audienceType,
    sql`coalesce(${t.trade}, '')`, sql`coalesce(${t.personId}, '')`,
  ),
  projectIdx: index("portal_shares_project_idx").on(t.projectId),
  itemIdx: index("portal_shares_item_idx").on(t.itemType, t.itemId),
}));

export const insertPortalShareSchema = createInsertSchema(portalSharesTable).omit({ createdAt: true });
export type InsertPortalShare = z.infer<typeof insertPortalShareSchema>;
export type PortalShare = typeof portalSharesTable.$inferSelect;
