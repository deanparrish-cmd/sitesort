import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { subcontractorsTable, insuranceRecordsTable, projectMembersTable, projectsTable, subcontractorNotesTable, usersTable } from "@workspace/db/schema";
import { eq, and, desc, or, isNull, isNotNull } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";

const router: IRouter = Router();

function computeInsuranceStatus(records: Array<{ status: string }>): "valid" | "expiring_soon" | "expired" | "none" {
  if (records.length === 0) return "none";
  if (records.some(r => r.status === "expired")) return "expired";
  if (records.some(r => r.status === "expiring_soon")) return "expiring_soon";
  return "valid";
}

function computeRecordStatus(expiryDate: string): "valid" | "expiring_soon" | "expired" {
  const expiry = new Date(expiryDate);
  const now = new Date();
  const daysUntilExpiry = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysUntilExpiry < 0) return "expired";
  if (daysUntilExpiry <= 30) return "expiring_soon";
  return "valid";
}

router.get("/subcontractors", authenticate, async (req, res) => {
  try {
    const subs = await db.select().from(subcontractorsTable).where(eq(subcontractorsTable.companyId, req.user!.companyId));
    const result = await Promise.all(subs.map(async (s) => {
      const insurance = await db.select().from(insuranceRecordsTable).where(eq(insuranceRecordsTable.subcontractorId, s.id));
      return {
        id: s.id,
        companyId: s.companyId,
        companyName: s.companyName,
        contactName: s.contactName,
        contactEmail: s.contactEmail,
        contactPhone: s.contactPhone ?? null,
        contactType: s.contactType ?? "subcontractor",
        trades: s.trades ?? [],
        reliabilityRating: s.reliabilityRating ? Number(s.reliabilityRating) : null,
        paymentHold: s.paymentHold,
        notes: s.notes ?? null,
        insuranceStatus: computeInsuranceStatus(insurance),
        insuranceRecords: insurance.map(r => ({ id: r.id, type: r.type, certificateUrl: r.certificateUrl, expiryDate: r.expiryDate, status: r.status })),
        createdAt: s.createdAt.toISOString(),
      };
    }));
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "List subcontractors error");
    res.status(500).json({ error: "server_error", message: "Failed to list subcontractors" });
  }
});

router.post("/subcontractors", authenticate, async (req, res) => {
  try {
    const { companyName, contactName, contactEmail, contactPhone, contactType, trades, notes } = req.body;
    if (!companyName || !contactName || !contactEmail) {
      res.status(400).json({ error: "validation_error", message: "companyName, contactName, contactEmail required" });
      return;
    }

    const id = generateId();
    await db.insert(subcontractorsTable).values({
      id,
      companyId: req.user!.companyId,
      companyName,
      contactName,
      contactEmail,
      contactPhone: contactPhone ?? null,
      contactType: contactType ?? "subcontractor",
      trades: trades ?? [],
      notes: notes ?? null,
      paymentHold: false,
    });

    res.status(201).json({ id, companyId: req.user!.companyId, companyName, contactName, contactEmail, contactPhone: contactPhone ?? null, contactType: contactType ?? "subcontractor", trades: trades ?? [], reliabilityRating: null, paymentHold: false, notes: notes ?? null, insuranceStatus: "none", insuranceRecords: [], createdAt: new Date().toISOString() });
  } catch (err) {
    req.log.error({ err }, "Create subcontractor error");
    res.status(500).json({ error: "server_error", message: "Failed to create subcontractor" });
  }
});

router.get("/subcontractors/:subcontractorId", authenticate, async (req, res) => {
  try {
    const subs = await db.select().from(subcontractorsTable)
      .where(and(eq(subcontractorsTable.id, req.params.subcontractorId), eq(subcontractorsTable.companyId, req.user!.companyId)))
      .limit(1);

    if (subs.length === 0) {
      res.status(404).json({ error: "not_found", message: "Subcontractor not found" });
      return;
    }

    const s = subs[0];
    const insurance = await db.select().from(insuranceRecordsTable).where(eq(insuranceRecordsTable.subcontractorId, s.id));
    const memberRows = await db.select({ projectId: projectMembersTable.projectId }).from(projectMembersTable).where(eq(projectMembersTable.subcontractorId, s.id));
    const assignedProjects = await Promise.all(memberRows.map(async (m) => {
      const proj = await db.select({ id: projectsTable.id, name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, m.projectId)).limit(1);
      return proj[0] ?? null;
    }));

    res.json({
      id: s.id,
      companyId: s.companyId,
      companyName: s.companyName,
      contactName: s.contactName,
      contactEmail: s.contactEmail,
      contactPhone: s.contactPhone ?? null,
      contactType: s.contactType ?? "subcontractor",
      trades: s.trades ?? [],
      reliabilityRating: s.reliabilityRating ? Number(s.reliabilityRating) : null,
      paymentHold: s.paymentHold,
      notes: s.notes ?? null,
      insuranceStatus: computeInsuranceStatus(insurance),
      createdAt: s.createdAt.toISOString(),
      insuranceRecords: insurance.map(r => ({ ...r, expiryDate: r.expiryDate, createdAt: r.createdAt.toISOString() })),
      assignedProjects: assignedProjects.filter(Boolean),
    });
  } catch (err) {
    req.log.error({ err }, "Get subcontractor error");
    res.status(500).json({ error: "server_error", message: "Failed to get subcontractor" });
  }
});

router.patch("/subcontractors/:subcontractorId", authenticate, async (req, res) => {
  try {
    const { companyName, contactName, contactEmail, contactPhone, contactType, trades, reliabilityRating, paymentHold, notes } = req.body;
    const updates: Record<string, unknown> = {};
    if (companyName !== undefined) updates.companyName = companyName;
    if (contactName !== undefined) updates.contactName = contactName;
    if (contactEmail !== undefined) updates.contactEmail = contactEmail;
    if (contactPhone !== undefined) updates.contactPhone = contactPhone;
    if (contactType !== undefined) updates.contactType = contactType;
    if (trades !== undefined) updates.trades = trades;
    if (reliabilityRating !== undefined) updates.reliabilityRating = reliabilityRating;
    if (paymentHold !== undefined) updates.paymentHold = paymentHold;
    if (notes !== undefined) updates.notes = notes;

    await db.update(subcontractorsTable).set(updates)
      .where(and(eq(subcontractorsTable.id, req.params.subcontractorId), eq(subcontractorsTable.companyId, req.user!.companyId)));

    const subs = await db.select().from(subcontractorsTable)
      .where(and(eq(subcontractorsTable.id, req.params.subcontractorId), eq(subcontractorsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!subs[0]) {
      res.status(404).json({ error: "not_found", message: "Subcontractor not found" });
      return;
    }
    const s = subs[0];
    const insurance = await db.select().from(insuranceRecordsTable).where(eq(insuranceRecordsTable.subcontractorId, s.id));

    res.json({ id: s.id, companyId: s.companyId, companyName: s.companyName, contactName: s.contactName, contactEmail: s.contactEmail, contactPhone: s.contactPhone ?? null, contactType: s.contactType ?? "subcontractor", trades: s.trades ?? [], reliabilityRating: s.reliabilityRating ? Number(s.reliabilityRating) : null, paymentHold: s.paymentHold, notes: s.notes ?? null, insuranceStatus: computeInsuranceStatus(insurance), insuranceRecords: insurance.map(r => ({ id: r.id, type: r.type, certificateUrl: r.certificateUrl, expiryDate: r.expiryDate, status: r.status })), createdAt: s.createdAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Update subcontractor error");
    res.status(500).json({ error: "server_error", message: "Failed to update subcontractor" });
  }
});

router.post("/subcontractors/:subcontractorId/insurance", authenticate, async (req, res) => {
  try {
    const { type, certificateUrl, expiryDate } = req.body;
    if (!type || !certificateUrl || !expiryDate) {
      res.status(400).json({ error: "validation_error", message: "type, certificateUrl, expiryDate required" });
      return;
    }

    const sub = await db.select().from(subcontractorsTable)
      .where(and(eq(subcontractorsTable.id, req.params.subcontractorId), eq(subcontractorsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!sub[0]) {
      res.status(404).json({ error: "not_found", message: "Subcontractor not found" });
      return;
    }

    // Archive any existing non-archived record of the same type for this subcontractor
    await db.update(insuranceRecordsTable)
      .set({ archivedAt: new Date() })
      .where(and(
        eq(insuranceRecordsTable.subcontractorId, req.params.subcontractorId),
        eq(insuranceRecordsTable.type, type),
        isNull(insuranceRecordsTable.archivedAt),
      ));

    const status = computeRecordStatus(expiryDate);
    const id = generateId();
    await db.insert(insuranceRecordsTable).values({
      id,
      subcontractorId: req.params.subcontractorId,
      type,
      certificateUrl,
      expiryDate,
      status,
    });

    res.status(201).json({ id, subcontractorId: req.params.subcontractorId, type, certificateUrl, expiryDate, status, createdAt: new Date().toISOString() });
  } catch (err) {
    req.log.error({ err }, "Add insurance error");
    res.status(500).json({ error: "server_error", message: "Failed to add insurance record" });
  }
});

// List timestamped notes for a subcontractor (most recent first)
// ?projectId=<id> → returns general notes + notes scoped to that project
// no projectId   → returns all notes (directory overview)
router.get("/subcontractors/:subcontractorId/notes", authenticate, async (req, res) => {
  try {
    const sub = await db.select({ id: subcontractorsTable.id }).from(subcontractorsTable)
      .where(and(eq(subcontractorsTable.id, req.params.subcontractorId), eq(subcontractorsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!sub[0]) {
      res.status(404).json({ error: "not_found", message: "Subcontractor not found" });
      return;
    }

    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : null;

    const scopeFilter = projectId
      ? or(isNull(subcontractorNotesTable.projectId), eq(subcontractorNotesTable.projectId, projectId))
      : undefined;

    const notes = await db
      .select({
        id: subcontractorNotesTable.id,
        body: subcontractorNotesTable.body,
        createdAt: subcontractorNotesTable.createdAt,
        projectId: subcontractorNotesTable.projectId,
        authorName: usersTable.name,
        projectName: projectsTable.name,
      })
      .from(subcontractorNotesTable)
      .leftJoin(usersTable, eq(usersTable.id, subcontractorNotesTable.authorId))
      .leftJoin(projectsTable, eq(projectsTable.id, subcontractorNotesTable.projectId))
      .where(and(eq(subcontractorNotesTable.subcontractorId, req.params.subcontractorId), scopeFilter))
      .orderBy(desc(subcontractorNotesTable.createdAt));

    res.json(notes.map(n => ({
      id: n.id,
      body: n.body,
      authorName: n.authorName ?? "Unknown",
      projectId: n.projectId ?? null,
      projectName: n.projectName ?? null,
      createdAt: n.createdAt.toISOString(),
    })));
  } catch (err) {
    req.log.error({ err }, "List subcontractor notes error");
    res.status(500).json({ error: "server_error", message: "Failed to list notes" });
  }
});

// Add a timestamped note to a subcontractor
router.post("/subcontractors/:subcontractorId/notes", authenticate, async (req, res) => {
  try {
    const sub = await db.select({ id: subcontractorsTable.id }).from(subcontractorsTable)
      .where(and(eq(subcontractorsTable.id, req.params.subcontractorId), eq(subcontractorsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!sub[0]) {
      res.status(404).json({ error: "not_found", message: "Subcontractor not found" });
      return;
    }

    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!body) {
      res.status(400).json({ error: "validation_error", message: "Note text is required" });
      return;
    }
    const projectId = typeof req.body?.projectId === "string" ? req.body.projectId : null;

    const id = generateId();
    const inserted = await db.insert(subcontractorNotesTable).values({
      id,
      subcontractorId: req.params.subcontractorId,
      authorId: req.user!.id,
      body,
      projectId,
    }).returning({ createdAt: subcontractorNotesTable.createdAt });

    const [author, project] = await Promise.all([
      db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1),
      projectId ? db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1) : Promise.resolve([]),
    ]);
    res.status(201).json({
      id,
      body,
      authorName: author[0]?.name ?? "Unknown",
      projectId,
      projectName: (project as any)[0]?.name ?? null,
      createdAt: (inserted[0]?.createdAt ?? new Date()).toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Add subcontractor note error");
    res.status(500).json({ error: "server_error", message: "Failed to add note" });
  }
});

export default router;
