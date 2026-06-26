import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectsTable, projectMembersTable, usersTable, documentsTable, documentDistributionsTable, permitsTable, notificationsTable, subcontractorsTable, companiesTable, milestonesTable } from "@workspace/db/schema";
import { eq, and, count, sql, asc } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";

const router: IRouter = Router();

async function computeProgress(projectId: string): Promise<number> {
  const rows = await db.select({ completedAt: milestonesTable.completedAt })
    .from(milestonesTable).where(eq(milestonesTable.projectId, projectId));
  if (rows.length === 0) return 0;
  const done = rows.filter(r => r.completedAt !== null).length;
  return Math.round((done / rows.length) * 100);
}

const PLAN_PROJECT_LIMITS: Record<string, number> = {
  free: 1,
  solo: 1,
  team: 5,
  pro: Infinity,
};

function planProjectLimit(tier: string, status: string): number {
  if (status === "cancelled") return 1;
  return PLAN_PROJECT_LIMITS[tier] ?? 1;
}

router.get("/projects", authenticate, async (req, res) => {
  try {
    const projects = await db.select().from(projectsTable).where(eq(projectsTable.companyId, req.user!.companyId));

    const result = await Promise.all(projects.map(async (p) => {
      const [memberCount] = await db.select({ count: count() }).from(projectMembersTable).where(eq(projectMembersTable.projectId, p.id));
      const [docAlerts] = await db.select({ count: count() }).from(documentDistributionsTable)
        .innerJoin(documentsTable, eq(documentsTable.id, documentDistributionsTable.documentId))
        .where(and(eq(documentsTable.projectId, p.id), eq(documentDistributionsTable.status, "pending")));

      const progressPercent = await computeProgress(p.id);
      return {
        id: p.id,
        companyId: p.companyId,
        name: p.name,
        address: p.address,
        status: p.status,
        startDate: p.startDate,
        targetEndDate: p.targetEndDate ?? null,
        createdAt: p.createdAt.toISOString(),
        memberCount: Number(memberCount.count),
        alertCount: Number(docAlerts.count),
        progressPercent,
      };
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "List projects error");
    res.status(500).json({ error: "server_error", message: "Failed to list projects" });
  }
});

router.post("/projects", authenticate, async (req, res) => {
  try {
    const { name, address, startDate, targetEndDate } = req.body;
    if (!name || !address || !startDate) {
      res.status(400).json({ error: "validation_error", message: "name, address, startDate required" });
      return;
    }

    const companyRows = await db
      .select({ subscriptionTier: companiesTable.subscriptionTier, subscriptionStatus: companiesTable.subscriptionStatus, betaAccess: companiesTable.betaAccess })
      .from(companiesTable)
      .where(eq(companiesTable.id, req.user!.companyId))
      .limit(1);
    const { subscriptionTier, subscriptionStatus, betaAccess } = companyRows[0] ?? { subscriptionTier: "free", subscriptionStatus: "active", betaAccess: false };
    // Beta companies are off-billing with full access — no plan cap applies.
    const limit = betaAccess ? Infinity : planProjectLimit(subscriptionTier, subscriptionStatus);

    if (limit !== Infinity) {
      const [{ total }] = await db.select({ total: count() }).from(projectsTable)
        .where(eq(projectsTable.companyId, req.user!.companyId));
      if (Number(total) >= limit) {
        res.status(403).json({
          error: "plan_limit",
          message: `Your ${subscriptionTier} plan allows up to ${limit} project${limit === 1 ? "" : "s"}. Upgrade to add more.`,
          limit,
          currentTier: subscriptionTier,
        });
        return;
      }
    }

    const id = generateId();
    await db.insert(projectsTable).values({
      id,
      companyId: req.user!.companyId,
      name,
      address,
      startDate,
      targetEndDate: targetEndDate || null,
      status: "active",
    });

    await db.insert(projectMembersTable).values({
      id: generateId(),
      projectId: id,
      userId: req.user!.id,
      role: "manager",
    });

    res.status(201).json({ id, companyId: req.user!.companyId, name, address, status: "active", startDate, targetEndDate: targetEndDate ?? null, createdAt: new Date().toISOString(), memberCount: 1, alertCount: 0, progressPercent: 0 });
  } catch (err) {
    req.log.error({ err }, "Create project error");
    res.status(500).json({ error: "server_error", message: "Failed to create project" });
  }
});

router.get("/projects/:projectId", authenticate, async (req, res) => {
  try {
    const projects = await db.select().from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);

    if (projects.length === 0) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    const p = projects[0];
    const [memberCount] = await db.select({ count: count() }).from(projectMembersTable).where(eq(projectMembersTable.projectId, p.id));
    const [docAlerts] = await db.select({ count: count() }).from(documentDistributionsTable)
      .innerJoin(documentsTable, eq(documentsTable.id, documentDistributionsTable.documentId))
      .where(and(eq(documentsTable.projectId, p.id), eq(documentDistributionsTable.status, "pending")));

    const progressPercent = await computeProgress(p.id);
    res.json({
      id: p.id,
      companyId: p.companyId,
      name: p.name,
      address: p.address,
      status: p.status,
      startDate: p.startDate,
      targetEndDate: p.targetEndDate ?? null,
      createdAt: p.createdAt.toISOString(),
      memberCount: Number(memberCount.count),
      alertCount: Number(docAlerts.count),
      progressPercent,
      trades: p.trades ?? [],
      recentActivity: [],
    });
  } catch (err) {
    req.log.error({ err }, "Get project error");
    res.status(500).json({ error: "server_error", message: "Failed to get project" });
  }
});

router.patch("/projects/:projectId", authenticate, async (req, res) => {
  try {
    const { name, address, status, targetEndDate } = req.body;
    const updates: Record<string, unknown> = {};
    if (name) updates.name = name;
    if (address) updates.address = address;
    if (status) updates.status = status;
    if (targetEndDate !== undefined) updates.targetEndDate = targetEndDate;

    await db.update(projectsTable).set(updates).where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)));

    const projects = await db.select().from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (projects.length === 0) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }
    const p = projects[0];
    res.json({ id: p.id, companyId: p.companyId, name: p.name, address: p.address, status: p.status, startDate: p.startDate, targetEndDate: p.targetEndDate ?? null, createdAt: p.createdAt.toISOString(), memberCount: 0, alertCount: 0, progressPercent: 0 });
  } catch (err) {
    req.log.error({ err }, "Update project error");
    res.status(500).json({ error: "server_error", message: "Failed to update project" });
  }
});

router.post("/projects/:projectId/trades", authenticate, async (req, res) => {
  try {
    const { trade } = req.body;
    if (!trade?.trim()) { res.status(400).json({ error: "validation_error", message: "trade is required" }); return; }
    const rows = await db.select({ trades: projectsTable.trades }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId))).limit(1);
    if (!rows.length) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }
    const existing = rows[0].trades ?? [];
    const normalised = trade.trim().toLowerCase();
    if (!existing.map((t: string) => t.toLowerCase()).includes(normalised)) {
      await db.update(projectsTable).set({ trades: [...existing, trade.trim()] })
        .where(eq(projectsTable.id, req.params.projectId));
    }
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Add trade error");
    res.status(500).json({ error: "server_error", message: "Failed to add trade" });
  }
});

router.post("/projects/:projectId/members/link", authenticate, async (req, res) => {
  try {
    const { subcontractorId } = req.body;
    if (!subcontractorId) {
      res.status(400).json({ error: "validation_error", message: "subcontractorId required" });
      return;
    }

    const sub = await db.select().from(subcontractorsTable)
      .where(and(eq(subcontractorsTable.id, subcontractorId), eq(subcontractorsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!sub[0]) {
      res.status(404).json({ error: "not_found", message: "Subcontractor not found" });
      return;
    }

    const proj = await db.select().from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!proj[0]) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    const existing = await db.select().from(projectMembersTable)
      .where(and(eq(projectMembersTable.projectId, req.params.projectId), eq(projectMembersTable.subcontractorId, subcontractorId)))
      .limit(1);
    if (existing[0]) {
      res.status(409).json({ error: "conflict", message: "Subcontractor is already on this project" });
      return;
    }

    const memberId = generateId();
    await db.insert(projectMembersTable).values({
      id: memberId,
      projectId: req.params.projectId,
      subcontractorId,
      role: "subcontractor",
    });

    res.status(201).json({ success: true, memberId });
  } catch (err) {
    req.log.error({ err }, "Link subcontractor error");
    res.status(500).json({ error: "server_error", message: "Failed to link subcontractor" });
  }
});

router.post("/projects/:projectId/tradespeople", authenticate, async (req, res) => {
  try {
    const { trade, companyName, contactName, contactEmail, contactPhone } = req.body;
    if (!trade || !companyName || !contactName) {
      res.status(400).json({ error: "validation_error", message: "trade, companyName and contactName are required" }); return;
    }
    const subId = generateId();
    await db.insert(subcontractorsTable).values({
      id: subId,
      companyId: req.user!.companyId,
      companyName,
      contactName,
      contactEmail: contactEmail || "",
      contactPhone: contactPhone || null,
      trades: [trade],
    });
    const memberId = generateId();
    await db.insert(projectMembersTable).values({
      id: memberId,
      projectId: req.params.projectId,
      subcontractorId: subId,
      role: "subcontractor",
    });
    // Also ensure the trade exists on the project
    const rows = await db.select({ trades: projectsTable.trades }).from(projectsTable).where(eq(projectsTable.id, req.params.projectId)).limit(1);
    const existing = rows[0]?.trades ?? [];
    if (!existing.map((t: string) => t.toLowerCase()).includes(trade.toLowerCase())) {
      await db.update(projectsTable).set({ trades: [...existing, trade] }).where(eq(projectsTable.id, req.params.projectId));
    }
    res.status(201).json({ success: true, memberId });
  } catch (err) {
    req.log.error({ err }, "Add tradesperson error");
    res.status(500).json({ error: "server_error", message: "Failed to add tradesperson" });
  }
});

// ── Milestones ──────────────────────────────────────────────────────────────

router.get("/projects/:projectId/milestones", authenticate, async (req, res) => {
  try {
    const project = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId))).limit(1);
    if (!project.length) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }

    const rows = await db.select().from(milestonesTable)
      .where(eq(milestonesTable.projectId, req.params.projectId))
      .orderBy(asc(milestonesTable.order), asc(milestonesTable.dueDate));

    res.json(rows.map(m => ({
      id: m.id, projectId: m.projectId, title: m.title, dueDate: m.dueDate,
      completedAt: m.completedAt ? m.completedAt.toISOString() : null, order: m.order,
    })));
  } catch (err) {
    req.log.error({ err }, "List milestones error");
    res.status(500).json({ error: "server_error", message: "Failed to list milestones" });
  }
});

router.post("/projects/:projectId/milestones", authenticate, async (req, res) => {
  try {
    const project = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId))).limit(1);
    if (!project.length) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }

    const { title, dueDate } = req.body;
    if (!title?.trim() || !dueDate) { res.status(400).json({ error: "validation_error", message: "title and dueDate required" }); return; }

    const [{ maxOrder }] = await db.select({ maxOrder: sql<number>`coalesce(max("order"), -1)` })
      .from(milestonesTable).where(eq(milestonesTable.projectId, req.params.projectId));

    const id = generateId();
    await db.insert(milestonesTable).values({ id, projectId: req.params.projectId, title: title.trim(), dueDate, order: Number(maxOrder) + 1 });
    res.status(201).json({ id, projectId: req.params.projectId, title: title.trim(), dueDate, completedAt: null, order: Number(maxOrder) + 1 });
  } catch (err) {
    req.log.error({ err }, "Create milestone error");
    res.status(500).json({ error: "server_error", message: "Failed to create milestone" });
  }
});

router.patch("/projects/:projectId/milestones/:milestoneId", authenticate, async (req, res) => {
  try {
    const project = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId))).limit(1);
    if (!project.length) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }

    const { title, dueDate, completed } = req.body;
    const updates: Record<string, unknown> = {};
    if (title !== undefined) updates.title = title.trim();
    if (dueDate !== undefined) updates.dueDate = dueDate;
    if (completed === true) updates.completedAt = new Date();
    if (completed === false) updates.completedAt = null;

    await db.update(milestonesTable).set(updates)
      .where(and(eq(milestonesTable.id, req.params.milestoneId), eq(milestonesTable.projectId, req.params.projectId)));

    const rows = await db.select().from(milestonesTable)
      .where(eq(milestonesTable.id, req.params.milestoneId)).limit(1);
    if (!rows.length) { res.status(404).json({ error: "not_found", message: "Milestone not found" }); return; }
    const m = rows[0];
    res.json({ id: m.id, projectId: m.projectId, title: m.title, dueDate: m.dueDate, completedAt: m.completedAt ? m.completedAt.toISOString() : null, order: m.order });
  } catch (err) {
    req.log.error({ err }, "Update milestone error");
    res.status(500).json({ error: "server_error", message: "Failed to update milestone" });
  }
});

router.delete("/projects/:projectId/milestones/:milestoneId", authenticate, async (req, res) => {
  try {
    const project = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId))).limit(1);
    if (!project.length) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }

    await db.delete(milestonesTable)
      .where(and(eq(milestonesTable.id, req.params.milestoneId), eq(milestonesTable.projectId, req.params.projectId)));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete milestone error");
    res.status(500).json({ error: "server_error", message: "Failed to delete milestone" });
  }
});

export default router;
