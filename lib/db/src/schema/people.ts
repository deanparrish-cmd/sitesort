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
  email: text("email").notNull(),
  phone: text("phone"),
  // Optional free-text job title, e.g. "Site Foreman". NOT the portal role.
  roleTitle: text("role_title"),
  // Whether this person's email/phone are shown on their portal Team row. NULL =
  // use the role-based default (managers ON, workers OFF); a non-null value is the
  // PM's explicit choice, set from the dashboard Team tab.
  showContactInPortal: boolean("show_contact_in_portal"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
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
