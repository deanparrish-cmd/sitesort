import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { subcontractorsTable, subcontractorDocumentsTable, projectsTable, usersTable } from "@workspace/db/schema";
import { eq, and, desc, or, isNull, inArray } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";
import { CreateSubcontractorDocumentBody, UpdateSubcontractorDocumentBody } from "@workspace/api-zod";

const router: IRouter = Router();

const MANAGER_ROLES = ["admin", "project_manager"];

function requireManager(req: import("express").Request, res: import("express").Response): boolean {
  if (!MANAGER_ROLES.includes(req.user!.role)) {
    res.status(403).json({ error: "forbidden", message: "Only an admin or project manager can manage subcontractor documents." });
    return false;
  }
  return true;
}

type DocRow = typeof subcontractorDocumentsTable.$inferSelect;

// Batch-resolve uploader + project names to avoid an N+1 over the rows.
async function serializeDocs(docs: DocRow[]) {
  const uploaderIds = [...new Set(docs.map(d => d.uploadedBy))];
  const projectIds = [...new Set(docs.map(d => d.projectId).filter((x): x is string => !!x))];
  const [uploaders, projects] = await Promise.all([
    uploaderIds.length ? db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, uploaderIds)) : Promise.resolve([]),
    projectIds.length ? db.select({ id: projectsTable.id, name: projectsTable.name }).from(projectsTable).where(inArray(projectsTable.id, projectIds)) : Promise.resolve([]),
  ]);
  const uploaderName = new Map(uploaders.map(u => [u.id, u.name]));
  const projectName = new Map(projects.map(p => [p.id, p.name]));
  return docs.map(d => ({
    id: d.id,
    subcontractorId: d.subcontractorId,
    projectId: d.projectId ?? null,
    projectName: d.projectId ? (projectName.get(d.projectId) ?? null) : null,
    uploadedBy: d.uploadedBy,
    uploaderName: uploaderName.get(d.uploadedBy) ?? "Unknown",
    name: d.name,
    type: d.type,
    version: d.version,
    fileUrl: d.fileUrl,
    fileSize: d.fileSize,
    previousVersionId: d.previousVersionId ?? null,
    status: d.status,
    createdAt: d.createdAt.toISOString(),
  }));
}

async function loadOwnedSubcontractor(subcontractorId: string, companyId: string) {
  const rows = await db.select({ id: subcontractorsTable.id }).from(subcontractorsTable)
    .where(and(eq(subcontractorsTable.id, subcontractorId), eq(subcontractorsTable.companyId, companyId))).limit(1);
  return rows[0] ?? null;
}

// GET /api/subcontractors/:subcontractorId/documents
// ?projectId=<id> → base (company-wide) docs + that project's extras
// no projectId    → base docs only (contacts directory view)
router.get("/subcontractors/:subcontractorId/documents", authenticate, async (req, res) => {
  try {
    const sub = await loadOwnedSubcontractor(req.params.subcontractorId, req.user!.companyId);
    if (!sub) { res.status(404).json({ error: "not_found", message: "Subcontractor not found" }); return; }

    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : null;
    const scopeFilter = projectId
      ? or(isNull(subcontractorDocumentsTable.projectId), eq(subcontractorDocumentsTable.projectId, projectId))
      : isNull(subcontractorDocumentsTable.projectId);

    const docs = await db.select().from(subcontractorDocumentsTable)
      .where(and(eq(subcontractorDocumentsTable.subcontractorId, sub.id), scopeFilter))
      .orderBy(desc(subcontractorDocumentsTable.createdAt));

    res.json(await serializeDocs(docs));
  } catch (err) {
    req.log.error({ err }, "List subcontractor documents error");
    res.status(500).json({ error: "server_error", message: "Failed to list documents" });
  }
});

// POST /api/subcontractors/:subcontractorId/documents — upload a document.
// Auto-supersedes an existing current doc with the same name AND scope
// (same subcontractor + same projectId, including both-null) unless an
// explicit supersededDocumentId is given.
router.post("/subcontractors/:subcontractorId/documents", authenticate, async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    const sub = await loadOwnedSubcontractor(req.params.subcontractorId, req.user!.companyId);
    if (!sub) { res.status(404).json({ error: "not_found", message: "Subcontractor not found" }); return; }

    const parsed = CreateSubcontractorDocumentBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "validation_error", message: "name, type, fileUrl, fileSize required" }); return; }
    const { name, type, fileUrl, fileSize, projectId, supersededDocumentId } = parsed.data;
    const scopeProjectId = projectId ?? null;

    let previousVersionId: string | null = null;
    let newVersion = 1;

    if (supersededDocumentId) {
      const toSupersede = await db.select().from(subcontractorDocumentsTable)
        .where(and(
          eq(subcontractorDocumentsTable.id, supersededDocumentId),
          eq(subcontractorDocumentsTable.subcontractorId, sub.id),
          eq(subcontractorDocumentsTable.status, "current"),
        ))
        .limit(1);
      if (toSupersede[0]) {
        previousVersionId = toSupersede[0].id;
        newVersion = toSupersede[0].version + 1;
        await db.update(subcontractorDocumentsTable).set({ status: "superseded" }).where(eq(subcontractorDocumentsTable.id, toSupersede[0].id));
      }
    } else {
      const scopeFilter = scopeProjectId ? eq(subcontractorDocumentsTable.projectId, scopeProjectId) : isNull(subcontractorDocumentsTable.projectId);
      const existing = await db.select().from(subcontractorDocumentsTable)
        .where(and(
          eq(subcontractorDocumentsTable.subcontractorId, sub.id),
          eq(subcontractorDocumentsTable.name, name),
          eq(subcontractorDocumentsTable.status, "current"),
          scopeFilter,
        ))
        .limit(1);
      if (existing[0]) {
        previousVersionId = existing[0].id;
        newVersion = existing[0].version + 1;
        await db.update(subcontractorDocumentsTable).set({ status: "superseded" }).where(eq(subcontractorDocumentsTable.id, existing[0].id));
      }
    }

    const id = generateId();
    await db.insert(subcontractorDocumentsTable).values({
      id,
      subcontractorId: sub.id,
      projectId: scopeProjectId,
      uploadedBy: req.user!.id,
      name,
      type,
      version: newVersion,
      fileUrl,
      fileSize: fileSize ?? 0,
      previousVersionId,
      status: "current",
    });

    const inserted = await db.select().from(subcontractorDocumentsTable).where(eq(subcontractorDocumentsTable.id, id)).limit(1);
    res.status(201).json((await serializeDocs(inserted))[0]);
  } catch (err) {
    req.log.error({ err }, "Create subcontractor document error");
    res.status(500).json({ error: "server_error", message: "Failed to upload document" });
  }
});

// PATCH /api/subcontractors/:subcontractorId/documents/:documentId — correct
// name/type/status. Manager-gated, tenant-scoped.
router.patch("/subcontractors/:subcontractorId/documents/:documentId", authenticate, async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    const sub = await loadOwnedSubcontractor(req.params.subcontractorId, req.user!.companyId);
    if (!sub) { res.status(404).json({ error: "not_found", message: "Subcontractor not found" }); return; }

    const existing = await db.select().from(subcontractorDocumentsTable)
      .where(and(eq(subcontractorDocumentsTable.id, req.params.documentId), eq(subcontractorDocumentsTable.subcontractorId, sub.id)))
      .limit(1);
    if (!existing[0]) { res.status(404).json({ error: "not_found", message: "Document not found" }); return; }

    const parsed = UpdateSubcontractorDocumentBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "validation_error", message: "Invalid update" }); return; }
    const { name, type, status } = parsed.data;
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (type !== undefined) updates.type = type;
    if (status !== undefined) updates.status = status;

    await db.update(subcontractorDocumentsTable).set(updates).where(eq(subcontractorDocumentsTable.id, req.params.documentId));
    const updated = await db.select().from(subcontractorDocumentsTable).where(eq(subcontractorDocumentsTable.id, req.params.documentId)).limit(1);
    res.json((await serializeDocs(updated))[0]);
  } catch (err) {
    req.log.error({ err }, "Update subcontractor document error");
    res.status(500).json({ error: "server_error", message: "Failed to update document" });
  }
});

// GET /api/subcontractors/:subcontractorId/documents/:documentId/revisions —
// walk the supersede chain (previousVersionId), newest first. Cycle-guarded.
router.get("/subcontractors/:subcontractorId/documents/:documentId/revisions", authenticate, async (req, res) => {
  try {
    const sub = await loadOwnedSubcontractor(req.params.subcontractorId, req.user!.companyId);
    if (!sub) { res.status(404).json({ error: "not_found", message: "Subcontractor not found" }); return; }

    const start = await db.select().from(subcontractorDocumentsTable)
      .where(and(eq(subcontractorDocumentsTable.id, req.params.documentId), eq(subcontractorDocumentsTable.subcontractorId, sub.id)))
      .limit(1);
    if (!start[0]) { res.status(404).json({ error: "not_found", message: "Document not found" }); return; }

    const chain: DocRow[] = [];
    let current: DocRow | undefined = start[0];
    const seen = new Set<string>();
    while (current && !seen.has(current.id) && chain.length < 100) {
      seen.add(current.id);
      chain.push(current);
      if (!current.previousVersionId) break;
      const prev = await db.select().from(subcontractorDocumentsTable).where(eq(subcontractorDocumentsTable.id, current.previousVersionId)).limit(1);
      current = prev[0];
    }

    res.json(await serializeDocs(chain));
  } catch (err) {
    req.log.error({ err }, "List subcontractor document revisions error");
    res.status(500).json({ error: "server_error", message: "Failed to list revisions" });
  }
});

export default router;
