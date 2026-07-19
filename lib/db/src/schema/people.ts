import { pgTable, text, timestamp, uniqueIndex, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { subcontractorsTable } from "./subcontractors";
import { usersTable } from "./users";

// A single "individual person" concept underpinning Team Portal access. One row
// per real human. It powers BOTH cases the portal invites:
//   • a person who works for a subcontractor firm → `subcontractorId` set
//   • an in-house team member                     → `subcontractorId` NULL
// so `subcontractorId IS NULL` is the in-house vs subcontractor discriminator.
// EVERY portal member is portal-only: a person has no login until they accept an
// invite link, at which point `userId` is filled in with the new `portalOnly`
// account (never an existing dashboard user). Portal invites and memberships
// reference `people.id`, giving one uniform FK target for both cases.
export const peopleTable = pgTable("people", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  subcontractorId: text("subcontractor_id").references(() => subcontractorsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  // First/last split (Feature: person name split). Nullable — existing
  // records are backfilled by splitting `name` on the first space; a record
  // left with an empty lastName shows a "surname missing" badge and must be
  // completed before a new portal invite can be sent to them. New writes are
  // Zod-validated (min 2 chars each, trimmed) — `name` stays as a derived
  // "First Last" display field for backward compatibility.
  firstName: text("first_name"),
  lastName: text("last_name"),
  email: text("email").notNull(),
  phone: text("phone"),
  // Optional free-text job title, e.g. "Site Foreman". NOT the portal role.
  roleTitle: text("role_title"),
  // Whether this person's email/phone are shown on their portal Team row. NULL =
  // use the role-based default (managers ON, workers OFF); a non-null value is the
  // PM's explicit choice, set from the dashboard Team tab.
  showContactInPortal: boolean("show_contact_in_portal"),
  // True for the one auto-created row mirroring a subcontructor's own
  // contactFirstName/contactLastName/contactEmail fields (Feature: person-first
  // cards). Lets every subcontractor's default contact be a real, addressable
  // `people` row instead of a UI-only pseudo-person — subcontractors.ts keeps
  // this row's name/email/phone mirrored bidirectionally with the parent
  // subcontructor row so legacy readers (Compliance Centre, invoices, Contacts
  // directory) that still read subcontructors.contactName etc. see no change.
  isPrimaryContact: boolean("is_primary_contact").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Soft-delete (same convention as subcontractors.archivedAt) — set when a
  // person has history and can't be safely hard-deleted; null = active.
  archivedAt: timestamp("archived_at"),
}, (t) => ({
  // One person per email within a subcontractor firm (dedupe repeat adds).
  subPersonUq: uniqueIndex("people_subcontractor_email_uq")
    .on(t.subcontractorId, t.email)
    .where(sql`${t.subcontractorId} is not null`),
  // One in-house person per email per company (dedupe repeat adds).
  inHousePersonUq: uniqueIndex("people_company_inhouse_email_uq")
    .on(t.companyId, t.email)
    .where(sql`${t.subcontractorId} is null`),
}));

export const insertPersonSchema = createInsertSchema(peopleTable).omit({ createdAt: true });
export type InsertPerson = z.infer<typeof insertPersonSchema>;
export type Person = typeof peopleTable.$inferSelect;
