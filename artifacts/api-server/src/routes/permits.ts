import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { permitsTable, usersTable, projectsTable } from "@workspace/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";

const router: IRouter = Router();

function computePermitStatus(expiryDate: string): "active" | "expiring_today" | "expired" {
  const expiry = new Date(expiryDate);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const expiryDay = new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate());
  if (expiryDay < today) return "expired";
  if (expiryDay.getTime() === today.getTime()) return "expiring_today";
  return "active";
}

async function formatPermit(p: { id: string; projectId: string; type: string; description: string; responsibleUserId: string; startDate: string; expiryDate: string; documentUrl: string | null; createdAt: Date; archivedAt?: Date | null }) {
  const userRows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, p.responsibleUserId)).limit(1);
  return {
    id: p.id,
    projectId: p.projectId,
    type: p.type,
    description: p.description,
    responsibleUserId: p.responsibleUserId,
    responsibleUserName: userRows[0]?.name ?? "Unknown",
    startDate: p.startDate,
    expiryDate: p.expiryDate,
    status: computePermitStatus(p.expiryDate),
    documentUrl: p.documentUrl ?? null,
    createdAt: p.createdAt.toISOString(),
    archivedAt: p.archivedAt?.toISOString() ?? null,
  };
}

router.get("/projects/:projectId/permits", authenticate, async (req, res) => {
  try {
    const project = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    const permits = await db.select().from(permitsTable).where(eq(permitsTable.projectId, req.params.projectId));
    const result = await Promise.all(permits.map(formatPermit));
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "List permits error");
    res.status(500).json({ error: "server_error", message: "Failed to list permits" });
  }
});

router.post("/projects/:projectId/permits", authenticate, async (req, res) => {
  try {
    const project = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    const { type, description, responsibleUserId, startDate, expiryDate, documentUrl } = req.body;
    if (!type || !description || !responsibleUserId || !startDate || !expiryDate) {
      res.status(400).json({ error: "validation_error", message: "type, description, responsibleUserId, startDate, expiryDate required" });
      return;
    }

    // Archive any existing non-archived permit of the same type for this project
    await db.update(permitsTable)
      .set({ archivedAt: new Date() })
      .where(and(
        eq(permitsTable.projectId, req.params.projectId),
        eq(permitsTable.type, type),
        isNull(permitsTable.archivedAt),
      ));

    const id = generateId();
    await db.insert(permitsTable).values({
      id,
      projectId: req.params.projectId,
      type,
      description,
      responsibleUserId,
      startDate,
      expiryDate,
      documentUrl: documentUrl ?? null,
    });

    const p = { id, projectId: req.params.projectId, type, description, responsibleUserId, startDate, expiryDate, documentUrl: documentUrl ?? null, createdAt: new Date(), archivedAt: null };
    res.status(201).json(await formatPermit(p));
  } catch (err) {
    req.log.error({ err }, "Create permit error");
    res.status(500).json({ error: "server_error", message: "Failed to create permit" });
  }
});

router.patch("/permits/:permitId", authenticate, async (req, res) => {
  try {
    const existing = await db.select().from(permitsTable).where(eq(permitsTable.id, req.params.permitId)).limit(1);
    if (!existing[0]) {
      res.status(404).json({ error: "not_found", message: "Permit not found" });
      return;
    }

    const project = await db.select().from(projectsTable)
      .where(and(eq(projectsTable.id, existing[0].projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Permit not found" });
      return;
    }

    const { description, responsibleUserId, expiryDate, documentUrl } = req.body;
    const updates: Record<string, unknown> = {};
    if (description !== undefined) updates.description = description;
    if (responsibleUserId !== undefined) updates.responsibleUserId = responsibleUserId;
    if (expiryDate !== undefined) updates.expiryDate = expiryDate;
    if (documentUrl !== undefined) updates.documentUrl = documentUrl;

    await db.update(permitsTable).set(updates).where(eq(permitsTable.id, req.params.permitId));
    const updated = await db.select().from(permitsTable).where(eq(permitsTable.id, req.params.permitId)).limit(1);
    res.json(await formatPermit(updated[0]));
  } catch (err) {
    req.log.error({ err }, "Update permit error");
    res.status(500).json({ error: "server_error", message: "Failed to update permit" });
  }
});

router.delete("/permits/:permitId", authenticate, async (req, res) => {
  try {
    const existing = await db.select().from(permitsTable).where(eq(permitsTable.id, req.params.permitId)).limit(1);
    if (!existing[0]) {
      res.status(404).json({ error: "not_found", message: "Permit not found" });
      return;
    }
    const project = await db.select().from(projectsTable)
      .where(and(eq(projectsTable.id, existing[0].projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Permit not found" });
      return;
    }
    await db.delete(permitsTable).where(eq(permitsTable.id, req.params.permitId));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete permit error");
    res.status(500).json({ error: "server_error", message: "Failed to delete permit" });
  }
});

export default router;
