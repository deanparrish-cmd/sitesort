import { db } from "@workspace/db";
import { projectMembersTable } from "@workspace/db/schema";
import { eq, and, inArray } from "drizzle-orm";

// Given a set of user ids who have historical activity/distribution/sign-off
// records on a project, returns the subset who are NOT currently an active
// member of that project — i.e. they were removed at some point since. Used
// to annotate historical name displays with a "(removed from project)"
// marker without needing a dedicated removal-log table: since project_members
// is hard-deleted on removal (see team.ts) while users/people rows are never
// touched, "has history but no active row" is exactly "removed".
export async function removedFromProjectUserIds(projectId: string, userIds: string[]): Promise<Set<string>> {
  const distinct = [...new Set(userIds)];
  if (distinct.length === 0) return new Set();
  const active = await db.select({ userId: projectMembersTable.userId }).from(projectMembersTable)
    .where(and(eq(projectMembersTable.projectId, projectId), inArray(projectMembersTable.userId, distinct)));
  const activeIds = new Set(active.map(a => a.userId).filter((x): x is string => !!x));
  return new Set(distinct.filter(id => !activeIds.has(id)));
}
