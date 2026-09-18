import { pgTable, text, timestamp, real, index } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

export const siteCheckinsTable = pgTable("site_checkins", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  workerName: text("worker_name").notNull(),
  companyName: text("company_name"),
  photoUrl: text("photo_url").notNull(),
  checkedInAt: timestamp("checked_in_at").notNull().defaultNow(),
  lat: real("lat"),
  lng: real("lng"),
  // Sign-out. One row = one in/out cycle: NULL checkedOutAt means the person is
  // still on site. A second visit in the same day is a NEW row, never an
  // overwrite. checkoutMethod is 'self' (QR sign-out) or 'manual' (a manager
  // closed it, with checkoutNote + checkedOutBy recorded).
  checkedOutAt: timestamp("checked_out_at"),
  checkedOutBy: text("checked_out_by").references(() => usersTable.id, { onDelete: "set null" }),
  checkoutNote: text("checkout_note"),
  checkoutMethod: text("checkout_method"),
  // Identity of the REGISTERED person this check-in matched (user:<id> |
  // person:<id> | sub:<id>), so one human can't show up as two people when they
  // type "Amy" one day and "Amy Parrish" the next. NULL on rows from before this
  // existed; those fall back to matching on the stored name + company text.
  personKey: text("person_key"),
}, (t) => ({
  projectOpenIdx: index("site_checkins_project_open_idx").on(t.projectId, t.checkedOutAt),
}));

export type SiteCheckin = typeof siteCheckinsTable.$inferSelect;
