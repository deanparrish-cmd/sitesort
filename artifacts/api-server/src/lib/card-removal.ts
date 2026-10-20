import { db } from "@workspace/db";
import { projectMembersTable, peopleTable, projectInvitesTable } from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { passLoginToLinkedCard } from "./linked-cards";
import { revokePortalSessionsForMember } from "./portal-sessions";

// Removes a card (people row) from a project: EVERY membership row of that card,
// not one picked by .limit(1). One card can carry a stale duplicate row (Amy,
// 2026-10-20: a no-login row from 25 Jul beside her real row from 30 Jul), and
// removing only one of them either left her on the project or, under #141,
// passed her login to the stale row of the same card in silence.
//
// Its live invites (pending AND accepted) are revoked: the boot repair in
// ensure-schema.ts recreates a row for any accepted invite whose login has no
// row, so a removed person would otherwise come back at the next restart.
//
// If a row carried a login and that person has ANOTHER card on the project,
// access passes to it (Dean, binding, 2026-10-20; the confirmation named it).
// Otherwise their portal sessions on this project end now.
export async function removeCardFromProject(projectId: string, personId: string): Promise<{ passedToPersonId: string | null; rowsRemoved: number }> {
  const rows = await db.select({ id: projectMembersTable.id, userId: projectMembersTable.userId }).from(projectMembersTable)
    .where(and(eq(projectMembersTable.projectId, projectId), eq(projectMembersTable.personId, personId)));
  await db.update(projectInvitesTable)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(and(
      eq(projectInvitesTable.personId, personId),
      eq(projectInvitesTable.projectId, projectId),
      inArray(projectInvitesTable.status, ["pending", "accepted"]),
    ));
  if (rows.length) await db.delete(projectMembersTable).where(inArray(projectMembersTable.id, rows.map(r => r.id)));

  const rowLogins = new Set(rows.map(r => r.userId).filter((u): u is string => !!u));
  const logins = new Set(rowLogins);
  const card = (await db.select({ userId: peopleTable.userId }).from(peopleTable).where(eq(peopleTable.id, personId)).limit(1))[0];
  if (card?.userId) logins.add(card.userId);

  let passedToPersonId: string | null = null;
  for (const login of logins) {
    const next = rowLogins.has(login) ? await passLoginToLinkedCard(login, projectId, personId) : null;
    if (next) { passedToPersonId = next; continue; }
    await endSessionsIfNoAccess(login, projectId);
  }
  return { passedToPersonId, rowsRemoved: rows.length };
}

// A login left with no row on a project has lost access there: end its portal
// sessions, and revoke every live invite it accepted on the project (any card),
// or the boot repair would put the login back on one of its cards' rows at the
// next restart.
export async function endSessionsIfNoAccess(userId: string, projectId: string): Promise<void> {
  const still = await db.select({ id: projectMembersTable.id }).from(projectMembersTable)
    .where(and(eq(projectMembersTable.projectId, projectId), eq(projectMembersTable.userId, userId))).limit(1);
  if (still[0]) return;
  await revokeAcceptedInvitesOfLogin(userId, projectId);
  await revokePortalSessionsForMember(userId, projectId);
}

export async function revokeAcceptedInvitesOfLogin(userId: string, projectId: string): Promise<void> {
  await db.update(projectInvitesTable)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(and(
      eq(projectInvitesTable.projectId, projectId),
      eq(projectInvitesTable.acceptedUserId, userId),
      inArray(projectInvitesTable.status, ["pending", "accepted"]),
    ));
}
