import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Append-only audit trail for sign-off PIN set/reset events — never the PIN
// itself, just that an event happened, by whom, and how (only ever insert).
// "reset" covers both a forgotten-PIN recovery and a routine change; both go
// through the same password-reverification endpoint, so the distinction is
// just whether the user already had a PIN when they did it.
export const pinAuditLogTable = pgTable("pin_audit_log", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  userName: text("user_name").notNull(),
  action: text("action").notNull(), // "set" | "reset"
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("pin_audit_user_idx").on(t.userId),
]);

export type PinAuditLog = typeof pinAuditLogTable.$inferSelect;
