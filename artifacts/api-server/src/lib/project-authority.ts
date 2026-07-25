import { db } from "@workspace/db";
import { projectMembersTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";

const COMPANY_MANAGER_ROLES = ["admin", "project_manager"];

// True if this user has PM-equivalent authority on this specific project —
// either company-wide (admin/project_manager role, unchanged default) or via
// an explicit per-project grant (project_members.isProjectManager), so a
// company admin can give someone PM cover on one project without changing
// their company-wide role. Always re-checks the DB (not JWT-cached) so a
// revoked grant takes effect immediately, matching requireAdmin's pattern.
export async function isProjectApprover(user: { id: string; role: string }, projectId: string): Promise<boolean> {
  if (COMPANY_MANAGER_ROLES.includes(user.role)) return true;
  const rows = await db.select({ id: projectMembersTable.id }).from(projectMembersTable)
    .where(and(
      eq(projectMembersTable.projectId, projectId),
      eq(projectMembersTable.userId, user.id),
      eq(projectMembersTable.isProjectManager, true),
    ))
    .limit(1);
  return rows.length > 0;
}

export { COMPANY_MANAGER_ROLES };
