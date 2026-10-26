import { db } from "@workspace/db";
import { documentDistributionsTable, projectInvitesTable, projectMembersTable, pushSubscriptionsTable } from "@workspace/db/schema";
import { and, eq, gt, inArray, isNotNull } from "drizzle-orm";
import { distributeDocumentToUser } from "./document-distribution";

// A CURRENT safety document skips the share check on purpose (#65): it is
// open to every member of the project, because safety-critical content must
// never be hidden by a missed share. Not an oversight; don't "fix" it. Once
// superseded it is gated like everything else (Dean, 2026-10-24).
// Refusal for a share rule on a current safety document (approved wording).
export const SAFETY_GOES_TO_EVERYONE_MESSAGE = "Safety documents go to everyone on this project. You can't choose who gets a safety document, so nobody can be left out by mistake.";

export function openToEveryMember(doc: { type: string; status: string }): boolean {
  return doc.type === "safety" && doc.status === "current";
}

// Who can open a document that is open to every member: every login with a
// portal card on the project (the portal's own access test, requirePortalMember).
export async function portalMemberUserIds(projectIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (projectIds.length === 0) return out;
  const rows = await db.select({ projectId: projectMembersTable.projectId, userId: projectMembersTable.userId })
    .from(projectMembersTable)
    .where(and(inArray(projectMembersTable.projectId, projectIds), isNotNull(projectMembersTable.personId), isNotNull(projectMembersTable.userId)));
  for (const r of rows) {
    const s = out.get(r.projectId) ?? new Set<string>();
    s.add(r.userId as string);
    out.set(r.projectId, s);
  }
  return out;
}

// Every member of the project owes a signature on a current safety document
// that needs sign-off: the count must match who can open it (Dean,
// 2026-10-26). Before, only people with a distribution row (picked in Share,
// or who had opened it) were counted, so a safety document read as more
// complete than it was. Returns, per such document, the members with NO
// distribution row yet (not opened): they count as owing, like a pending row.
// Members with a row are already counted by the row itself.
export function safetyOwersWithoutRow(
  docs: Array<{ id: string; projectId: string; type: string; status: string; requiresAcknowledgment: boolean }>,
  rowUserIdsByDoc: Map<string, Set<string>>,
  membersByProject: Map<string, Set<string>>,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const d of docs) {
    if (!openToEveryMember(d) || !d.requiresAcknowledgment) continue;
    const rowUsers = rowUserIdsByDoc.get(d.id) ?? new Set<string>();
    const missing = [...(membersByProject.get(d.projectId) ?? [])].filter(u => !rowUsers.has(u));
    if (missing.length > 0) out.set(d.id, missing);
  }
  return out;
}

// Convenience for the one-document paths (upload, detail, edit).
export async function safetyOwersForDoc(doc: { id: string; projectId: string; type: string; status: string; requiresAcknowledgment: boolean }): Promise<string[]> {
  if (!openToEveryMember(doc) || !doc.requiresAcknowledgment) return [];
  const [members, rows] = await Promise.all([
    portalMemberUserIds([doc.projectId]),
    db.select({ userId: documentDistributionsTable.userId }).from(documentDistributionsTable).where(eq(documentDistributionsTable.documentId, doc.id)),
  ]);
  return safetyOwersWithoutRow([doc], new Map([[doc.id, new Set(rows.map(r => r.userId))]]), members).get(doc.id) ?? [];
}

// What the Share and upload dialogs say about a safety document: how many can
// open it now, and how many more will once they accept a portal invite.
// alertsOn: how many of the members have a phone registered for alerts on
// this project right now (push_subscriptions). Present tense on purpose
// (Dean, 2026-10-26): SiteSort can't prove who was alerted for one upload
// (alerts are bundled, the record doesn't name the document, and an accepted
// push isn't a banner, #154), only who has alerts turned on.
export async function everyoneOnProject(projectId: string): Promise<{ members: number; pendingInvites: number; alertsOn: number }> {
  const members = (await portalMemberUserIds([projectId])).get(projectId) ?? new Set<string>();
  const memberCards = await db.select({ personId: projectMembersTable.personId }).from(projectMembersTable)
    .where(and(eq(projectMembersTable.projectId, projectId), isNotNull(projectMembersTable.personId), isNotNull(projectMembersTable.userId)));
  const onPortal = new Set(memberCards.map(c => c.personId as string));
  const invites = await db.select({ personId: projectInvitesTable.personId, email: projectInvitesTable.email }).from(projectInvitesTable)
    .where(and(eq(projectInvitesTable.projectId, projectId), eq(projectInvitesTable.status, "pending"), gt(projectInvitesTable.expiresAt, new Date())));
  // One per person still to join (a card already on the portal isn't "more").
  const waiting = new Set(invites.filter(i => !(i.personId && onPortal.has(i.personId))).map(i => i.personId ?? `e:${i.email.toLowerCase()}`));
  const phones = members.size === 0 ? [] : await db.selectDistinct({ userId: pushSubscriptionsTable.userId }).from(pushSubscriptionsTable)
    .where(and(eq(pushSubscriptionsTable.projectId, projectId), inArray(pushSubscriptionsTable.userId, [...members])));
  return { members: members.size, pendingInvites: waiting.size, alertsOn: phones.length };
}

// "Also email all N" (Dean, 2026-10-26): the one email choice left for a
// current safety document, which goes to every member anyway. Emails every
// portal member through the same tracked path as a share (their row, in-app
// notice, email if their email setting is on). Never changes who can open it.
export async function emailEveryMember(
  projectId: string,
  doc: { id: string; name: string; version: number; requiresAcknowledgment: boolean },
  projectName: string,
  log: (err: unknown) => void,
): Promise<{ recipientCount: number; emailedCount: number }> {
  const members = [...((await portalMemberUserIds([projectId])).get(projectId) ?? [])];
  let emailedCount = 0;
  for (const userId of members) {
    const { emailed } = await distributeDocumentToUser(doc, projectName, userId, `New safety notice: ${doc.name}`, log, { sendEmail: true });
    if (emailed) emailedCount++;
  }
  return { recipientCount: members.length, emailedCount };
}
