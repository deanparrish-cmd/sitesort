import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  plantItemsTable, plantItemAttachmentsTable, plantItemDistributionsTable,
  projectsTable, usersTable, subcontractorsTable, notificationsTable,
} from "@workspace/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";
import { logActivity } from "../lib/activity";
import { CreatePlantItemBody, UpdatePlantItemBody, CreatePlantItemAttachmentBody } from "@workspace/api-zod";

const router: IRouter = Router();

const INTERNAL_ROLES = ["admin", "project_manager", "site_worker"];
const MANAGER_ROLES = ["admin", "project_manager"];

function requireInternal(req: import("express").Request, res: import("express").Response): boolean {
  if (!INTERNAL_ROLES.includes(req.user!.role)) {
    res.status(403).json({ error: "forbidden", message: "Not allowed to manage Plant & Materials" });
    return false;
  }
  return true;
}
function requireManager(req: import("express").Request, res: import("express").Response): boolean {
  if (!MANAGER_ROLES.includes(req.user!.role)) {
    res.status(403).json({ error: "forbidden", message: "Only an admin or project manager can delete Plant & Materials items" });
    return false;
  }
  return true;
}

async function loadOwnedProject(projectId: string, companyId: string) {
  const rows = await db.select().from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.companyId, companyId))).limit(1);
  return rows[0] ?? null;
}

type ItemRow = typeof plantItemsTable.$inferSelect;

async function serializeItems(items: ItemRow[]) {
  const updaterIds = [...new Set(items.map(i => i.lastUpdatedBy).filter((x): x is string => !!x))];
  const supplierIds = [...new Set(items.map(i => i.supplierContactId).filter((x): x is string => !!x))];
  const [updaters, suppliers] = await Promise.all([
    updaterIds.length ? db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, updaterIds)) : Promise.resolve([]),
    supplierIds.length ? db.select({ id: subcontractorsTable.id, name: subcontractorsTable.companyName }).from(subcontractorsTable).where(inArray(subcontractorsTable.id, supplierIds)) : Promise.resolve([]),
  ]);
  const updaterName = new Map(updaters.map(u => [u.id, u.name]));
  const supplierName = new Map(suppliers.map(s => [s.id, s.name]));
  return items.map(i => ({
    id: i.id,
    projectId: i.projectId,
    name: i.name,
    category: i.category,
    quantity: i.quantity ?? null,
    unit: i.unit ?? null,
    supplierOwnerText: i.supplierOwnerText ?? null,
    supplierContactId: i.supplierContactId ?? null,
    supplierContactName: i.supplierContactId ? (supplierName.get(i.supplierContactId) ?? null) : null,
    location: i.location ?? null,
    status: i.status,
    notes: i.notes ?? null,
    onSiteDate: i.onSiteDate ?? null,
    expectedOffHireDate: i.expectedOffHireDate ?? null,
    createdBy: i.createdBy,
    lastUpdatedByName: i.lastUpdatedBy ? (updaterName.get(i.lastUpdatedBy) ?? null) : null,
    lastUpdatedAt: i.lastUpdatedAt ? i.lastUpdatedAt.toISOString() : null,
    createdAt: i.createdAt.toISOString(),
  }));
}

// GET /api/projects/:projectId/plant-items
router.get("/projects/:projectId/plant-items", authenticate, async (req, res) => {
  try {
    const project = await loadOwnedProject(req.params.projectId, req.user!.companyId);
    if (!project) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }

    const filters = [eq(plantItemsTable.projectId, project.id)];
    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    if (category) filters.push(eq(plantItemsTable.category, category));
    if (status) filters.push(eq(plantItemsTable.status, status));

    const items = await db.select().from(plantItemsTable).where(and(...filters));
    res.json(await serializeItems(items));
  } catch (err) {
    req.log.error({ err }, "List plant items error");
    res.status(500).json({ error: "server_error", message: "Failed to list Plant & Materials items" });
  }
});

// POST /api/projects/:projectId/plant-items
router.post("/projects/:projectId/plant-items", authenticate, async (req, res) => {
  try {
    if (!requireInternal(req, res)) return;
    const project = await loadOwnedProject(req.params.projectId, req.user!.companyId);
    if (!project) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }

    const parsed = CreatePlantItemBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "validation_error", message: "name and category are required" }); return; }
    const data = parsed.data;

    const id = generateId();
    await db.insert(plantItemsTable).values({
      id,
      projectId: project.id,
      name: data.name,
      category: data.category,
      quantity: data.quantity ?? null,
      unit: data.unit ?? null,
      supplierOwnerText: data.supplierOwnerText ?? null,
      supplierContactId: data.supplierContactId ?? null,
      location: data.location ?? null,
      status: data.status ?? "on_site",
      notes: data.notes ?? null,
      onSiteDate: data.onSiteDate ?? null,
      expectedOffHireDate: data.expectedOffHireDate ?? null,
      createdBy: req.user!.id,
      lastUpdatedBy: req.user!.id,
      lastUpdatedAt: new Date(),
    });

    void logActivity({ userId: req.user!.id, projectId: project.id, companyId: req.user!.companyId, section: "plant-materials", action: "create", itemType: "plant_item", itemId: id, req });

    const inserted = await db.select().from(plantItemsTable).where(eq(plantItemsTable.id, id)).limit(1);
    res.status(201).json((await serializeItems(inserted))[0]);
  } catch (err) {
    req.log.error({ err }, "Create plant item error");
    res.status(500).json({ error: "server_error", message: "Failed to create item" });
  }
});

// PATCH /api/projects/:projectId/plant-items/:itemId
router.patch("/projects/:projectId/plant-items/:itemId", authenticate, async (req, res) => {
  try {
    if (!requireInternal(req, res)) return;
    const project = await loadOwnedProject(req.params.projectId, req.user!.companyId);
    if (!project) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }

    const existing = await db.select().from(plantItemsTable)
      .where(and(eq(plantItemsTable.id, req.params.itemId), eq(plantItemsTable.projectId, project.id))).limit(1);
    if (!existing[0]) { res.status(404).json({ error: "not_found", message: "Item not found" }); return; }

    const parsed = UpdatePlantItemBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "validation_error", message: "Invalid update" }); return; }
    const data = parsed.data;

    const fields = ["name", "category", "quantity", "unit", "supplierOwnerText", "supplierContactId", "location", "status", "notes", "onSiteDate", "expectedOffHireDate"] as const;
    const updates: Partial<typeof plantItemsTable.$inferInsert> = {};
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const f of fields) {
      const value = data[f];
      if (value !== undefined && value !== existing[0][f]) {
        (updates as Record<string, unknown>)[f] = value;
        diff[f] = { from: existing[0][f], to: value };
      }
    }
    if (Object.keys(updates).length > 0) {
      updates.lastUpdatedBy = req.user!.id;
      updates.lastUpdatedAt = new Date();
      await db.update(plantItemsTable).set(updates).where(eq(plantItemsTable.id, req.params.itemId));
      void logActivity({ userId: req.user!.id, projectId: project.id, companyId: req.user!.companyId, section: "plant-materials", action: "update", itemType: "plant_item", itemId: req.params.itemId, metadata: diff, req });
    }

    const updated = await db.select().from(plantItemsTable).where(eq(plantItemsTable.id, req.params.itemId)).limit(1);
    res.json((await serializeItems(updated))[0]);
  } catch (err) {
    req.log.error({ err }, "Update plant item error");
    res.status(500).json({ error: "server_error", message: "Failed to update item" });
  }
});

// DELETE /api/projects/:projectId/plant-items/:itemId — manager-only (members can never delete)
router.delete("/projects/:projectId/plant-items/:itemId", authenticate, async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    const project = await loadOwnedProject(req.params.projectId, req.user!.companyId);
    if (!project) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }

    const existing = await db.select({ id: plantItemsTable.id }).from(plantItemsTable)
      .where(and(eq(plantItemsTable.id, req.params.itemId), eq(plantItemsTable.projectId, project.id))).limit(1);
    if (!existing[0]) { res.status(404).json({ error: "not_found", message: "Item not found" }); return; }

    // plant_item_distributions has no cascade (mirrors document_distributions),
    // but unlike documents — which are never hard-deleted — plant items ARE
    // deletable, so any existing allocation rows must be cleared first or the
    // FK blocks the delete.
    await db.delete(plantItemDistributionsTable).where(eq(plantItemDistributionsTable.plantItemId, req.params.itemId));
    await db.delete(plantItemsTable).where(eq(plantItemsTable.id, req.params.itemId));
    void logActivity({ userId: req.user!.id, projectId: project.id, companyId: req.user!.companyId, section: "plant-materials", action: "delete", itemType: "plant_item", itemId: req.params.itemId, req });
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete plant item error");
    res.status(500).json({ error: "server_error", message: "Failed to delete item" });
  }
});

type AttachmentRow = typeof plantItemAttachmentsTable.$inferSelect;
async function serializeAttachments(rows: AttachmentRow[]) {
  const uploaderIds = [...new Set(rows.map(r => r.uploadedBy))];
  const uploaders = uploaderIds.length
    ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, uploaderIds))
    : [];
  const uploaderName = new Map(uploaders.map(u => [u.id, u.name]));
  return rows.map(r => ({
    id: r.id, plantItemId: r.plantItemId, uploadedBy: r.uploadedBy,
    uploaderName: uploaderName.get(r.uploadedBy) ?? "Unknown",
    name: r.name, kind: r.kind, fileUrl: r.fileUrl, fileSize: r.fileSize,
    createdAt: r.createdAt.toISOString(),
  }));
}

// GET /api/projects/:projectId/plant-items/:itemId/attachments
router.get("/projects/:projectId/plant-items/:itemId/attachments", authenticate, async (req, res) => {
  try {
    const project = await loadOwnedProject(req.params.projectId, req.user!.companyId);
    if (!project) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }
    const item = await db.select({ id: plantItemsTable.id }).from(plantItemsTable)
      .where(and(eq(plantItemsTable.id, req.params.itemId), eq(plantItemsTable.projectId, project.id))).limit(1);
    if (!item[0]) { res.status(404).json({ error: "not_found", message: "Item not found" }); return; }

    const rows = await db.select().from(plantItemAttachmentsTable).where(eq(plantItemAttachmentsTable.plantItemId, req.params.itemId));
    res.json(await serializeAttachments(rows));
  } catch (err) {
    req.log.error({ err }, "List plant item attachments error");
    res.status(500).json({ error: "server_error", message: "Failed to list attachments" });
  }
});

// POST /api/projects/:projectId/plant-items/:itemId/attachments — file already
// uploaded via the generic /api/upload endpoint (dashboard side, not portal).
router.post("/projects/:projectId/plant-items/:itemId/attachments", authenticate, async (req, res) => {
  try {
    if (!requireInternal(req, res)) return;
    const project = await loadOwnedProject(req.params.projectId, req.user!.companyId);
    if (!project) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }
    const item = await db.select({ id: plantItemsTable.id }).from(plantItemsTable)
      .where(and(eq(plantItemsTable.id, req.params.itemId), eq(plantItemsTable.projectId, project.id))).limit(1);
    if (!item[0]) { res.status(404).json({ error: "not_found", message: "Item not found" }); return; }

    const parsed = CreatePlantItemAttachmentBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "validation_error", message: "name, kind and fileUrl required" }); return; }
    const { name, kind, fileUrl, fileSize } = parsed.data;

    const id = generateId();
    await db.insert(plantItemAttachmentsTable).values({
      id, plantItemId: req.params.itemId, uploadedBy: req.user!.id, name, kind, fileUrl, fileSize: fileSize ?? 0,
    });
    void logActivity({ userId: req.user!.id, projectId: project.id, companyId: req.user!.companyId, section: "plant-materials", action: "create", itemType: "plant_item_attachment", itemId: id, req });

    const inserted = await db.select().from(plantItemAttachmentsTable).where(eq(plantItemAttachmentsTable.id, id)).limit(1);
    res.status(201).json((await serializeAttachments(inserted))[0]);
  } catch (err) {
    req.log.error({ err }, "Create plant item attachment error");
    res.status(500).json({ error: "server_error", message: "Failed to attach file" });
  }
});

// POST /api/projects/:projectId/plant-items/:itemId/distribute — "Allocate",
// mirrors documents.ts's distribute handler exactly (pending/viewed/acknowledged
// tracking), retargeted at plant_item_distributions.
router.post("/projects/:projectId/plant-items/:itemId/distribute", authenticate, async (req, res) => {
  try {
    if (!requireInternal(req, res)) return;
    const { userIds } = req.body;
    if (!userIds || !Array.isArray(userIds)) {
      res.status(400).json({ error: "validation_error", message: "userIds array required" });
      return;
    }
    const project = await loadOwnedProject(req.params.projectId, req.user!.companyId);
    if (!project) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }
    const item = await db.select({ id: plantItemsTable.id, name: plantItemsTable.name }).from(plantItemsTable)
      .where(and(eq(plantItemsTable.id, req.params.itemId), eq(plantItemsTable.projectId, project.id))).limit(1);
    if (!item[0]) { res.status(404).json({ error: "not_found", message: "Item not found" }); return; }

    for (const userId of userIds) {
      const existing = await db.select().from(plantItemDistributionsTable)
        .where(and(eq(plantItemDistributionsTable.plantItemId, req.params.itemId), eq(plantItemDistributionsTable.userId, userId)))
        .limit(1);
      if (existing.length === 0) {
        await db.insert(plantItemDistributionsTable).values({ id: generateId(), plantItemId: req.params.itemId, userId, status: "pending" });
        await db.insert(notificationsTable).values({
          id: generateId(), userId, type: "document_uploaded",
          title: `Plant & Materials item allocated: ${item[0].name}`,
          message: `${item[0].name} has been shared with you.`,
          relatedEntityId: req.params.itemId, relatedEntityType: "plant_item", read: false,
        });
      }
    }
    res.json({ success: true, message: "Item distributed" });
  } catch (err) {
    req.log.error({ err }, "Distribute plant item error");
    res.status(500).json({ error: "server_error", message: "Failed to distribute item" });
  }
});

// GET /api/projects/:projectId/plant-items/:itemId/distributions
router.get("/projects/:projectId/plant-items/:itemId/distributions", authenticate, async (req, res) => {
  try {
    const project = await loadOwnedProject(req.params.projectId, req.user!.companyId);
    if (!project) { res.status(404).json({ error: "not_found", message: "Project not found" }); return; }
    const item = await db.select({ id: plantItemsTable.id }).from(plantItemsTable)
      .where(and(eq(plantItemsTable.id, req.params.itemId), eq(plantItemsTable.projectId, project.id))).limit(1);
    if (!item[0]) { res.status(404).json({ error: "not_found", message: "Item not found" }); return; }

    const dists = await db.select().from(plantItemDistributionsTable).where(eq(plantItemDistributionsTable.plantItemId, req.params.itemId));
    const result = await Promise.all(dists.map(async (dist) => {
      const userRows = await db.select({ name: usersTable.name, role: usersTable.role }).from(usersTable).where(eq(usersTable.id, dist.userId)).limit(1);
      return {
        id: dist.id, plantItemId: dist.plantItemId, userId: dist.userId,
        userName: userRows[0]?.name ?? "Unknown", userRole: userRows[0]?.role ?? "site_worker",
        status: dist.status, distributedAt: dist.distributedAt.toISOString(),
        viewedAt: dist.viewedAt?.toISOString() ?? null, acknowledgedAt: dist.acknowledgedAt?.toISOString() ?? null,
      };
    }));
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Get plant item distributions error");
    res.status(500).json({ error: "server_error", message: "Failed to get distributions" });
  }
});

export default router;
