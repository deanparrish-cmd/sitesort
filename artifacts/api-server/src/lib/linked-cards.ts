import { db } from "@workspace/db";
import { projectMembersTable, peopleTable, subcontractorsTable } from "@workspace/db/schema";
import { and, eq, isNull, isNotNull, or, inArray, ne } from "drizzle-orm";

// One person can hold more than one contact card (people row) on a project, e.g.
// working there for two firms. Portal ACCESS always rides on exactly one
// membership row: the one carrying their login (project_members.user_id,
// unique per project). A second card of the same login sits on the project as a
// person-backed row with user_id NULL and people.user_id = that login.
//
// Rule (option B, Dean 2026-10-20): such a linked card counts for that login
// (shares to it reach them) only while
//   - it still has its own membership row on the project (a PM removal deletes
//     the row, so a removed card stays excluded), and
//   - it isn't archived, and
//   - the login itself still holds a row on the project (no access, no cards).
// A card linked to a DIFFERENT login's row is never borrowed.

export type LinkedCard = {
  memberId: string;
  personId: string;
  holdsLogin: boolean;
  trades: string[];
  subcontractorId: string | null;
  companyId: string | null;
  addedAt: Date;
};

// Every card that counts for this login on this project, the login-holding
// card first. Empty when the login has no row on the project.
export async function linkedCardsForLogin(userId: string, projectId: string): Promise<LinkedCard[]> {
  const rows = await db.select({
    memberId: projectMembersTable.id, personId: projectMembersTable.personId, rowUserId: projectMembersTable.userId,
    trades: subcontractorsTable.trades, subcontractorId: peopleTable.subcontractorId, companyId: peopleTable.companyId,
    addedAt: projectMembersTable.addedAt,
  })
    .from(projectMembersTable)
    .innerJoin(peopleTable, eq(projectMembersTable.personId, peopleTable.id))
    .leftJoin(subcontractorsTable, eq(peopleTable.subcontractorId, subcontractorsTable.id))
    .where(and(
      eq(projectMembersTable.projectId, projectId),
      isNotNull(projectMembersTable.personId),
      or(
        eq(projectMembersTable.userId, userId),
        and(isNull(projectMembersTable.userId), eq(peopleTable.userId, userId), isNull(peopleTable.archivedAt)),
      ),
    ));
  const cards = rows.map(r => ({
    memberId: r.memberId, personId: r.personId as string, holdsLogin: r.rowUserId === userId,
    trades: (r.trades ?? []) as string[], subcontractorId: r.subcontractorId ?? null, companyId: r.companyId ?? null,
    addedAt: r.addedAt,
  }));
  const primary = cards.filter(c => c.holdsLogin).sort((a, b) => a.addedAt.getTime() - b.addedAt.getTime())[0];
  if (!primary) return [];
  return [primary, ...cards.filter(c => !c.holdsLogin).sort((a, b) => a.addedAt.getTime() - b.addedAt.getTime())];
}

// For a project's person-backed rows with no login of their own: the login each
// one counts for under the rule above (people.user_id, when that login holds a
// row on this project and the card isn't archived). Keyed by membership row id.
export async function borrowedLoginsByRow(projectId: string): Promise<Map<string, string>> {
  const rows = await db.select({
    memberId: projectMembersTable.id, rowUserId: projectMembersTable.userId,
    cardUserId: peopleTable.userId, archivedAt: peopleTable.archivedAt,
  })
    .from(projectMembersTable)
    .innerJoin(peopleTable, eq(projectMembersTable.personId, peopleTable.id))
    .where(eq(projectMembersTable.projectId, projectId));
  const holders = new Set(rows.filter(r => r.rowUserId).map(r => r.rowUserId as string));
  const out = new Map<string, string>();
  for (const r of rows) {
    if (!r.rowUserId && r.cardUserId && !r.archivedAt && holders.has(r.cardUserId)) out.set(r.memberId, r.cardUserId);
  }
  return out;
}

// When a PM removes the card that carries a login, and that login has another
// linked card still on the project, access passes to that card (Dean, binding,
// 2026-10-20): its row takes the login and keeps its own permissions. Returns
// the person id of the card that took over, or null when access ends. Call
// AFTER the removed rows are deleted. Never passes to the removed card itself
// (a stale duplicate row of the same card is not "another card").
export async function passLoginToLinkedCard(userId: string, projectId: string, removedPersonId?: string): Promise<string | null> {
  const stillHolds = await db.select({ id: projectMembersTable.id }).from(projectMembersTable)
    .where(and(eq(projectMembersTable.projectId, projectId), eq(projectMembersTable.userId, userId))).limit(1);
  if (stillHolds[0]) return null;
  const candidates = await db.select({ id: projectMembersTable.id, personId: projectMembersTable.personId, addedAt: projectMembersTable.addedAt })
    .from(projectMembersTable)
    .innerJoin(peopleTable, eq(projectMembersTable.personId, peopleTable.id))
    .where(and(
      eq(projectMembersTable.projectId, projectId),
      isNull(projectMembersTable.userId),
      eq(peopleTable.userId, userId),
      isNull(peopleTable.archivedAt),
      ...(removedPersonId ? [ne(projectMembersTable.personId, removedPersonId)] : []),
    ));
  const next = candidates.sort((a, b) => a.addedAt.getTime() - b.addedAt.getTime())[0];
  if (!next) return null;
  await db.update(projectMembersTable).set({ userId })
    .where(and(eq(projectMembersTable.id, next.id), isNull(projectMembersTable.userId)));
  return next.personId as string;
}

// The other cards of the same person on a project, for the Team tab marker and
// the removal warning. Cards are grouped by login: the row's own login, or the
// card's people.user_id. Keyed by membership row id.
export async function otherCardsByRow(projectId: string, memberIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (memberIds.length === 0) return out;
  const rows = await db.select({ memberId: projectMembersTable.id, rowUserId: projectMembersTable.userId, cardUserId: peopleTable.userId })
    .from(projectMembersTable)
    .innerJoin(peopleTable, eq(projectMembersTable.personId, peopleTable.id))
    .where(and(eq(projectMembersTable.projectId, projectId), inArray(projectMembersTable.id, memberIds)));
  const byLogin = new Map<string, string[]>();
  for (const r of rows) {
    const login = r.rowUserId ?? r.cardUserId;
    if (!login) continue;
    byLogin.set(login, [...(byLogin.get(login) ?? []), r.memberId]);
  }
  for (const ids of byLogin.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) out.set(id, ids.filter(x => x !== id));
  }
  return out;
}
