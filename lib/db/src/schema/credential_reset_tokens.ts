import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Unified "forgot password / forgot PIN" reset tokens. One backbone for all
// three credential types: main account password, portal member password (same
// users row underneath), and the sign-off PIN. The raw token exists ONLY in
// the reset email; we store a sha256 hash at rest. Single-use (usedAt set on
// consumption), 60-minute expiry, and requesting a new token invalidates any
// outstanding unused tokens of the same kind for that user.
export const credentialResetTokensTable = pgTable("credential_reset_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  // "password" resets users.password_hash; "pin" resets users.pin_hash.
  kind: text("kind").notNull(),
  // "app" (PM dashboard) vs "portal" — same account, but controls which reset
  // page the email links to and the email copy. Consumption does not depend on
  // it (a valid token resets the credential either way).
  context: text("context").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  requestIp: text("request_ip"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  tokenHashIdx: index("credential_reset_tokens_hash_idx").on(t.tokenHash),
  userIdx: index("credential_reset_tokens_user_idx").on(t.userId, t.kind),
}));

export type CredentialResetToken = typeof credentialResetTokensTable.$inferSelect;
