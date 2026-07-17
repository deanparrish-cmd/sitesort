import { db } from "@workspace/db";
import {
  projectMembersTable, projectsTable, peopleTable,
  activityLogTable, documentDistributionsTable, acknowledgmentAuditTable,
} from "@workspace/db/schema";
import { and, eq, or, inArray } from "drizzle-orm";

// Distinct names of ACTIVE projects a subcontractor (or any of its people) is
// currently linked to. Non-empty → deletion/archiving must be blocked.
export async function activeProjectsForSubcontractor(subcontractorId: string): Promise<string[]> {
  const people = await db.select({ id: peopleTable.id }).from(peopleTable).where(eq(peopleTable.subcontractorId, subcontractorId));
  const personIds = people.map(p => p.id);
  const memberFilter = personIds.length
    ? or(eq(projectMembersTable.subcontractorId, subcontractorId), inArray(projectMembersTable.personId, personIds))
    : eq(projectMembersTable.subcontractorId, subcontractorId);

  const rows = await db.select({ name: projectsTable.name })
    .from(projectMembersTable)
    .innerJoin(projectsTable, eq(projectMembersTable.projectId, projectsTable.id))
    .where(and(memberFilter, eq(projectsTable.status, "active")));
  return [...new Set(rows.map(r => r.name))];
}

// Distinct names of ACTIVE projects a single person is currently linked to.
export async function activeProjectsForPerson(personId: string): Promise<string[]> {
  const rows = await db.select({ name: projectsTable.name })
    .from(projectMembersTable)
    .innerJoin(projectsTable, eq(projectMembersTable.projectId, projectsTable.id))
    .where(and(eq(projectMembersTable.personId, personId), eq(projectsTable.status, "active")));
  return [...new Set(rows.map(r => r.name))];
}

// True if there is zero footprint anywhere for this set of people/userIds:
// no project_members row ever (any project, any status) and no
// activity_log/document_distributions/acknowledgment_audit_log rows for any
// linked userId. Zero footprint → safe to hard-delete; any footprint →
// must archive instead, since those history tables key off users.id and are
// never touched by contact removal.
export async function hasAnyHistoricalFootprint(params: { personIds: string[]; subcontractorId?: string; userIds: string[] }): Promise<boolean> {
  const { personIds, subcontractorId, userIds } = params;

  if (personIds.length || subcontractorId) {
    const memberFilter = personIds.length && subcontractorId
      ? or(eq(projectMembersTable.subcontractorId, subcontractorId), inArray(projectMembersTable.personId, personIds))
      : subcontractorId
      ? eq(projectMembersTable.subcontractorId, subcontractorId)
      : inArray(projectMembersTable.personId, personIds);
    const memberRows = await db.select({ id: projectMembersTable.id }).from(projectMembersTable).where(memberFilter).limit(1);
    if (memberRows.length > 0) return true;
  }

  const distinctUserIds = [...new Set(userIds)];
  if (distinctUserIds.length === 0) return false;

  const [activity, distributions, audit] = await Promise.all([
    db.select({ id: activityLogTable.id }).from(activityLogTable).where(inArray(activityLogTable.userId, distinctUserIds)).limit(1),
    db.select({ id: documentDistributionsTable.id }).from(documentDistributionsTable).where(inArray(documentDistributionsTable.userId, distinctUserIds)).limit(1),
    db.select({ id: acknowledgmentAuditTable.id }).from(acknowledgmentAuditTable).where(inArray(acknowledgmentAuditTable.userId, distinctUserIds)).limit(1),
  ]);
  return activity.length > 0 || distributions.length > 0 || audit.length > 0;
}
