import { db } from "@workspace/db";
import { companyMembersTable, companiesTable, usersTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { generateId } from "./id";

export type Membership = { companyId: string; companyName: string; role: string };

// The user's home company as a single-membership fallback — used if the
// company_members table is somehow unavailable, so login never breaks.
async function homeMembership(userId: string): Promise<Membership[]> {
  const rows = await db
    .select({ companyId: usersTable.companyId, role: usersTable.role, companyName: companiesTable.name })
    .from(usersTable)
    .leftJoin(companiesTable, eq(companiesTable.id, usersTable.companyId))
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!rows[0]) return [];
  return [{ companyId: rows[0].companyId, companyName: rows[0].companyName ?? "", role: rows[0].role }];
}

// All companies a user belongs to, with their role in each.
export async function getMemberships(userId: string): Promise<Membership[]> {
  try {
    const rows = await db
      .select({
        companyId: companyMembersTable.companyId,
        companyName: companiesTable.name,
        role: companyMembersTable.role,
      })
      .from(companyMembersTable)
      .innerJoin(companiesTable, eq(companiesTable.id, companyMembersTable.companyId))
      .where(eq(companyMembersTable.userId, userId))
      .orderBy(companiesTable.name);
    return rows.length > 0 ? rows : await homeMembership(userId);
  } catch {
    return homeMembership(userId);
  }
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
