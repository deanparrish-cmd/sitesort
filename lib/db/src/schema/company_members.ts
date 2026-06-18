import { pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { companiesTable } from "./companies";

// A person (users row, identity) can belong to MANY companies, each with its
// own role. This decouples identity from company so one email can be a member
// of several companies. users.companyId stays as the user's "home" company
// (where they registered); company_members is the source of truth for "who is
// in company X" and "what is this user's role in company X".
export const companyMembersTable = pgTable("company_members", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  companyId: text("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("site_worker"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniqMember: unique("company_members_user_company_unique").on(t.userId, t.companyId),
}));

export const insertCompanyMemberSchema = createInsertSchema(companyMembersTable).omit({ createdAt: true });
export type InsertCompanyMember = z.infer<typeof insertCompanyMemberSchema>;
export type CompanyMember = typeof companyMembersTable.$inferSelect;
