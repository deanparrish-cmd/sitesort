import { db } from "@workspace/db";
import { companyMembersTable, companiesTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { generateId } from "./id";

export type Membership = { companyId: string; companyName: string; role: string };

// All companies a user belongs to, with their role in each.
export async function getMemberships(userId: string): Promise<Membership[]> {
  return db
    .select({
      companyId: companyMembersTable.companyId,
      companyName: companiesTable.name,
      role: companyMembersTable.role,
    })
    .from(companyMembersTable)
    .innerJoin(companiesTable, eq(companiesTable.id, companyMembersTable.companyId))
    .where(eq(companyMembersTable.userId, userId))
    .orderBy(companiesTable.name);
}

// Role for a user in a specific company, or null if they are not a member.
export async function membershipRole(userId: string, companyId: string): Promise<string | null> {
  const rows = await db
    .select({ role: companyMembersTable.role })
    .from(companyMembersTable)
    .where(and(eq(companyMembersTable.userId, userId), eq(companyMembersTable.companyId, companyId)))
    .limit(1);
  return rows[0]?.role ?? null;
}

// Add a membership (idempotent). Returns false if it already existed.
export async function addMembership(userId: string, companyId: string, role: string): Promise<boolean> {
  const existing = await membershipRole(userId, companyId);
  if (existing !== null) return false;
  await db.insert(companyMembersTable).values({ id: generateId(), userId, companyId, role });
  return true;
}

// Resolve which company a freshly-authenticated user should land in: their home
// company if they still belong to it, else their first membership.
export function resolveActiveCompany(homeCompanyId: string, memberships: Membership[]): Membership | null {
  if (memberships.length === 0) return null;
  return memberships.find(m => m.companyId === homeCompanyId) ?? memberships[0];
}
