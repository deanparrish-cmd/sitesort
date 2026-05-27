import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectsTable, projectMembersTable, documentsTable, subcontractorsTable, milestonesTable } from "@workspace/db/schema";
import { eq, and, gt, count } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/onboarding/status", authenticate, async (req, res) => {
  try {
    const cid = req.user!.companyId;

    const [[projectRow], [memberRow], [docRow], [subRow], [milestoneRow]] = await Promise.all([
      db.select({ n: count() }).from(projectsTable).where(eq(projectsTable.companyId, cid)),
      // Team member = any project_member that isn't the current user
      db.select({ n: count() }).from(projectMembersTable)
        .innerJoin(projectsTable, eq(projectsTable.id, projectMembersTable.projectId))
        .where(and(eq(projectsTable.companyId, cid), gt(projectMembersTable.id, ""))),
      db.select({ n: count() }).from(documentsTable)
        .innerJoin(projectsTable, eq(projectsTable.id, documentsTable.projectId))
        .where(eq(projectsTable.companyId, cid)),
      db.select({ n: count() }).from(subcontractorsTable).where(eq(subcontractorsTable.companyId, cid)),
      db.select({ n: count() }).from(milestonesTable)
        .innerJoin(projectsTable, eq(projectsTable.id, milestonesTable.projectId))
        .where(eq(projectsTable.companyId, cid)),
    ]);

    const projectCount = Number(projectRow.n);
    // A team member exists beyond the project creator when total members > number of projects
    // (each project auto-adds the creator as a member on creation)
    const memberCount = Number(memberRow.n);

    res.json({
      hasProject:      projectCount > 0,
      hasTeamMember:   memberCount > projectCount,
      hasDocument:     Number(docRow.n) > 0,
      hasSubcontractor: Number(subRow.n) > 0,
      hasMilestone:    Number(milestoneRow.n) > 0,
    });
  } catch (err) {
    req.log.error({ err }, "Onboarding status error");
    res.status(500).json({ error: "server_error", message: "Failed to get onboarding status" });
  }
});

export default router;
