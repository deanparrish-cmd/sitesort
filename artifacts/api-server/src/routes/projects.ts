import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectsTable, projectMembersTable, usersTable, documentsTable, documentDistributionsTable, permitsTable, notificationsTable } from "@workspace/db/schema";
import { eq, and, count, sql } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/projects", authenticate, async (req, res) => {
  try {
    const projects = await db.select().from(projectsTable).where(eq(projectsTable.companyId, req.user!.companyId));

    const result = await Promise.all(projects.map(async (p) => {
      const [memberCount] = await db.select({ count: count() }).from(projectMembersTable).where(eq(projectMembersTable.projectId, p.id));
      const [docAlerts] = await db.select({ count: count() }).from(documentDistributionsTable)
        .innerJoin(documentsTable, eq(documentsTable.id, documentDistributionsTable.documentId))
        .where(and(eq(documentsTable.projectId, p.id), eq(documentDistributionsTable.status, "pending")));

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
        progressPercent: p.status === "complete" ? 100 : p.status === "on_hold" ? 50 : 30,
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
      progressPercent: p.status === "complete" ? 100 : p.status === "on_hold" ? 50 : 30,
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

    const projects = await db.select().from(projectsTable).where(eq(projectsTable.id, req.params.projectId)).limit(1);
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

export default router;
