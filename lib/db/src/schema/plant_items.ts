import { pgTable, text, timestamp, numeric, date, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { subcontractorsTable } from "./subcontractors";

// Plant & Materials — tracks what's on site (plant/equipment or materials).
// supplierOwnerText/supplierContactId are both optional and independent: a PM
// can type a free-text supplier name OR pick a subcontractor-directory contact,
// whichever the item calls for. lastUpdatedBy/lastUpdatedAt are denormalized
// for the "last updated by First Surname, [time]" line — the full diff lives
// in activity_log, this is just a display shortcut.
export const plantItemsTable = pgTable("plant_items", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category").notNull(),        // 'plant_equipment' | 'materials'
  quantity: numeric("quantity"),
  unit: text("unit"),
  supplierOwnerText: text("supplier_owner_text"),
  supplierContactId: text("supplier_contact_id").references(() => subcontractorsTable.id),
  location: text("location"),
  status: text("status").notNull().default("on_site"), // 'on_site'|'on_order'|'off_hired'|'depleted'
  notes: text("notes"),
  onSiteDate: date("on_site_date"),
  expectedOffHireDate: date("expected_off_hire_date"),
  createdBy: text("created_by").notNull().references(() => usersTable.id),
  lastUpdatedBy: text("last_updated_by").references(() => usersTable.id),
  lastUpdatedAt: timestamp("last_updated_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Draft/submit lifecycle for a portal member's proposed edit (Feature: portal
  // save-vs-submit). A member's status/location/notes change lands here first —
  // the live columns above (and the PM's view) are untouched until they submit,
  // at which point the draft is copied onto the live columns and cleared.
  portalDraftStatus: text("portal_draft_status"),
  portalDraftLocation: text("portal_draft_location"),
  portalDraftNotes: text("portal_draft_notes"),
  portalDraftUpdatedBy: text("portal_draft_updated_by").references(() => usersTable.id),
  portalDraftUpdatedAt: timestamp("portal_draft_updated_at"),
  // Soft-delete (archive) — mirrors photos.ts's archive pattern so PMs get the
  // same Archive/Restore actions on items received from the portal. Archived
  // items are hidden from default lists but retained for audit.
  archivedAt: timestamp("archived_at"),
  archivedBy: text("archived_by").references(() => usersTable.id),
  archiveReason: text("archive_reason"),
}, (t) => ({
  projectIdx: index("plant_items_project_idx").on(t.projectId),
}));

export const insertPlantItemSchema = createInsertSchema(plantItemsTable).omit({ createdAt: true });
export type InsertPlantItem = z.infer<typeof insertPlantItemSchema>;
export type PlantItem = typeof plantItemsTable.$inferSelect;
