import { pgTable, text, timestamp, date, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { peopleTable } from "./people";
import { usersTable } from "./users";

// Individual certifications/tickets held by a person (CSCS, SSSTS/SMSTS, gas
// safe, plant tickets, etc.) — distinct from a company's PLI/insurance, which
// stays on insurance_records keyed by subcontractorId. Attaches to ANY person
// regardless of employment shape (in-house, subcontractor employee, or
// self-employed). Same expiry-band + auto-archive-on-renew conventions as
// insurance_records/permits (Feature #47): uploading a new cert with the same
// `name` for the same person archives the previous one.
export const personCertificationsTable = pgTable("person_certifications", {
  id: text("id").primaryKey(),
  personId: text("person_id").notNull().references(() => peopleTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  certNumber: text("cert_number"),
  expiryDate: date("expiry_date").notNull(),
  documentUrl: text("document_url"),
  createdBy: text("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  archivedAt: timestamp("archived_at"),
}, (t) => ({
  personIdx: index("person_certifications_person_idx").on(t.personId),
}));

export const insertPersonCertificationSchema = createInsertSchema(personCertificationsTable).omit({ createdAt: true });
export type InsertPersonCertification = z.infer<typeof insertPersonCertificationSchema>;
export type PersonCertification = typeof personCertificationsTable.$inferSelect;
