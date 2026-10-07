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
  // Insurance hold: the check-in matched a contact whose insurance is missing
  // or expired. The row (with photo) is kept but the person is NOT on site
  // until an admin / PM approves. holdReason: 'insurance_none' |
  // 'insurance_expired'. holdStatus: 'pending' | 'approved' | 'refused' |
  // 'lapsed' (nobody decided before the site close time). The decision is
  // recorded: holdDecidedBy / holdDecidedAt / holdNote (reason, required to
  // approve). NULL holdStatus = a normal check-in that never needed a decision.
  holdReason: text("hold_reason"),
  holdStatus: text("hold_status"),
  holdDecidedBy: text("hold_decided_by").references(() => usersTable.id, { onDelete: "set null" }),
  holdDecidedAt: timestamp("hold_decided_at"),
  holdNote: text("hold_note"),
  // Set by the end-of-day job when the person never signed out by the
  // project's site close time. It is NOT a sign-out: checkedOutAt stays NULL
  // (they may still be on site), but they stop counting as "on site". The
  // manager's register still lists them for that day, marked.
  autoClosedAt: timestamp("auto_closed_at"),
}, (t) => ({
  projectOpenIdx: index("site_checkins_project_open_idx").on(t.projectId, t.checkedOutAt),
}));

export type SiteCheckin = typeof siteCheckinsTable.$inferSelect;
