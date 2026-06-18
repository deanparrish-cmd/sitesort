import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { shareLogsTable, usersTable, projectsTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";

const router: IRouter = Router();

// POST /share-logs — record a share action
router.post("/share-logs", authenticate, async (req, res) => {
  try {
    const { projectId, entityType, entityId, entityName, method, recipientInfo } = req.body;
    if (!entityType || !entityId || !entityName || !method) {
      res.status(400).json({ error: "validation_error", message: "entityType, entityId, entityName, method required" });
      return;
    }

    // If projectId provided, verify it belongs to this company
    if (projectId) {
      const project = await db.select({ id: projectsTable.id }).from(projectsTable)
        .where(and(eq(projectsTable.id, projectId), eq(projectsTable.companyId, req.user!.companyId)))
        .limit(1);
      if (!project[0]) {
        res.status(404).json({ error: "not_found", message: "Project not found" });
        return;
      }
    }

    const id = generateId();
    await db.insert(shareLogsTable).values({
      id,
      companyId: req.user!.companyId,
      projectId: projectId ?? null,
      entityType,
      entityId,
      entityName,
      method,
      recipientInfo: recipientInfo ?? null,
      sentByUserId: req.user!.id,
    });

    res.status(201).json({ id });
  } catch (err) {
    req.log.error({ err }, "Create share log error");
    res.status(500).json({ error: "server_error" });
  }
});

// GET /share-logs?projectId=X — all logs for a project
// GET /share-logs?entityType=X&entityId=Y — logs for a specific item
router.get("/share-logs", authenticate, async (req, res) => {
  try {
    const { projectId, entityType, entityId } = req.query as Record<string, string>;

    const rows = await db
      .select({
        id: shareLogsTable.id,
        entityType: shareLogsTable.entityType,
        entityId: shareLogsTable.entityId,
        entityName: shareLogsTable.entityName,
        method: shareLogsTable.method,
        recipientInfo: shareLogsTable.recipientInfo,
        createdAt: shareLogsTable.createdAt,
        sentByName: usersTable.name,
      })
      .from(shareLogsTable)
      .leftJoin(usersTable, eq(usersTable.id, shareLogsTable.sentByUserId))
      .where(
        and(
          eq(shareLogsTable.companyId, req.user!.companyId),
          projectId ? eq(shareLogsTable.projectId, projectId) : undefined,
          entityType ? eq(shareLogsTable.entityType, entityType) : undefined,
          entityId ? eq(shareLogsTable.entityId, entityId) : undefined,
        )
      )
      .orderBy(desc(shareLogsTable.createdAt))
      .limit(200);

    res.json(rows.map(r => ({
      id: r.id,
      entityType: r.entityType,
      entityId: r.entityId,
      entityName: r.entityName,
      method: r.method,
      recipientInfo: r.recipientInfo ?? null,
      sentByName: r.sentByName ?? "Unknown",
      createdAt: r.createdAt.toISOString(),
    })));
  } catch (err) {
    req.log.error({ err }, "List share logs error");
    res.status(500).json({ error: "server_error" });
  }
});

export default router;
