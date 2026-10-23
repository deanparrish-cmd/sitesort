import { pgTable, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Every change to a login's password or PIN, and every reset request, with the
// notice sent to the owner (Dean, 2026-10-23: only the owner controls these,
// and the owner hears of every change). Append-only; never the secret itself.
export const credentialEventsTable = pgTable("credential_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  // password_changed | password_reset_requested | pin_set | pin_changed |
  // pin_reset_requested | pin_switched_off | invite_accepted
  kind: text("kind").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  // sent | suppressed | failed | none
  emailNotice: text("email_notice"),
  pushNotice: integer("push_notice"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("credential_events_user_idx").on(t.userId)]);

export type CredentialEvent = typeof credentialEventsTable.$inferSelect;
