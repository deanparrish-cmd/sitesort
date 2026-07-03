import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

export const usersTable = pgTable("users", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companiesTable.id),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("site_worker"),
  phone: text("phone"),
  pinHash: text("pin_hash"),
  avatarUrl: text("avatar_url"),
  emailVerified: boolean("email_verified").notNull().default(false),
  emailNotifications: boolean("email_notifications").notNull().default(true),
  // Team Portal: a portal-only member (onboarded via a project invite) can log
  // in ONLY through the member portal, never the main dashboard. The main
  // /auth/login rejects these accounts (→ use portal login) and portal login
  // accepts only these. A regular dashboard user has this false.
  portalOnly: boolean("portal_only").notNull().default(false),
  emailVerificationToken: text("email_verification_token"),
  emailVerificationExpiry: timestamp("email_verification_expiry"),
  passwordResetToken: text("password_reset_token"),
  passwordResetExpiry: timestamp("password_reset_expiry"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastActiveAt: timestamp("last_active_at"),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ createdAt: true, lastActiveAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
