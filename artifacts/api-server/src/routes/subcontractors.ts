import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { subcontractorsTable, insuranceRecordsTable, projectMembersTable, projectsTable, subcontractorNotesTable, usersTable, peopleTable, subcontractorDocumentsTable } from "@workspace/db/schema";
import { eq, and, desc, or, isNull, isNotNull, inArray } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";
import { expiryStatus } from "../lib/expiry";
import { isOverdue } from "../lib/accountability";
import { activeProjectsForSubcontractor, hasAnyHistoricalFootprint } from "../lib/contact-removal";
import { CreateSubcontractorBody, UpdateSubcontractorBody } from "@workspace/api-zod";

const router: IRouter = Router();

function computeInsuranceStatus(records: Array<{ expiryDate: string }>): "valid" | "expiring_soon" | "expired" | "none" {
  if (records.length === 0) return "none";
  const statuses = records.map(r => computeRecordStatus(r.expiryDate));
  if (statuses.some(s => s === "expired")) return "expired";
  if (statuses.some(s => s === "expiring_soon")) return "expiring_soon";
  return "valid";
}

// Insurance uses "valid" where the shared helper says "active"; otherwise the
// bands (expiring_soon ≤30d, expired) are identical. Reuse the one canonical
// helper (F1) so certs agree with permits/compliance/QR on the thresholds.
function computeRecordStatus(expiryDate: string): "valid" | "expiring_soon" | "expired" {
  const s = expiryStatus(expiryDate);
  return s === "active" ? "valid" : s;
}

type InsuranceRow = typeof insuranceRecordsTable.$inferSelect;

// Serialize insurance records with assignee name + derived overdue flag. Names
// are resolved in a single batched query to avoid an N+1 over the records.
async function serializeInsuranceRecords(records: InsuranceRow[]) {
  const assigneeIds = [...new Set(records.map(r => r.assignedToUserId).filter((x): x is string => !!x))];
  const nameById = new Map<string, string>();
  if (assigneeIds.length > 0) {
    const users = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable)
      .where(inArray(usersTable.id, assigneeIds));
    for (const u of users) nameById.set(u.id, u.name);
  }
  return records.map(r => ({
    id: r.id,
    subcontractorId: r.subcontractorId,
    type: r.type,
    certificateUrl: r.certificateUrl,
    expiryDate: r.expiryDate,
    status: computeRecordStatus(r.expiryDate),
    assignedToUserId: r.assignedToUserId ?? null,
    assignedToUserName: r.assignedToUserId ? (nameById.get(r.assignedToUserId) ?? "Unknown") : null,
    dueDate: r.dueDate ?? null,
    // A cert is "done" (no longer overdue) once archived/renewed.
    overdue: isOverdue(r.dueDate, !!r.archivedAt),
    createdAt: r.createdAt.toISOString(),
  }));
}

// ?archived=true → only archived contacts (for the Contacts "Archived" filter);
// default → active contacts only (archivedAt IS NULL).
router.get("/subcontractors", authenticate, async (req, res) => {
  try {
    const wantArchived = req.query.archived === "true";
    const subs = await db.select().from(subcontractorsTable)
      .where(and(
        eq(subcontractorsTable.companyId, req.user!.companyId),
        wantArchived ? isNotNull(subcontractorsTable.archivedAt) : isNull(subcontractorsTable.archivedAt),
      ));
    const result = await Promise.all(subs.map(async (s) => {
      const insurance = await db.select().from(insuranceRecordsTable)
        .where(and(eq(insuranceRecordsTable.subcontractorId, s.id), isNull(insuranceRecordsTable.archivedAt)));
      return {
        id: s.id,
        companyId: s.companyId,
        companyName: s.companyName,
        contactName: s.contactName,
        contactFirstName: s.contactFirstName ?? null,
        contactLastName: s.contactLastName ?? null,
        contactEmail: s.contactEmail,
        contactPhone: s.contactPhone ?? null,
        contactType: s.contactType ?? "subcontractor",
        trades: s.trades ?? [],
        reliabilityRating: s.reliabilityRating ? Number(s.reliabilityRating) : null,
        paymentHold: s.paymentHold,
        notes: s.notes ?? null,
        archivedAt: s.archivedAt ? s.archivedAt.toISOString() : null,
        insuranceStatus: computeInsuranceStatus(insurance),
        insuranceRecords: await serializeInsuranceRecords(insurance),
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
    const parsed = CreateSubcontractorBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "validation_error", message: "A first name and surname (2+ chars each) and contactEmail are required" }); return; }
    const { contactFirstName, contactLastName, contactEmail, contactPhone, contactType, trades, notes } = parsed.data;
    const firstName = contactFirstName.trim();
    const lastName = contactLastName.trim();
    const contactName = `${firstName} ${lastName}`.trim();
    const type = contactType ?? "subcontractor";
    // Self-employed: the person IS the entity — companyName is optional client-side;
    // stays populated server-side (mirrors the contact's own name) so it remains a
    // display fallback for any legacy reader, but new person-first UI shows
    // "Self-employed" in its place for this contactType.
    const companyName = parsed.data.companyName?.trim() || (type === "self_employed" ? contactName : undefined);
    if (!companyName) { res.status(400).json({ error: "validation_error", message: "companyName is required unless contactType is self_employed" }); return; }

    const id = generateId();
    const personId = generateId();
    await db.insert(subcontractorsTable).values({
      id,
      companyId: req.user!.companyId,
      companyName,
      contactName,
      contactFirstName: firstName,
      contactLastName: lastName,
      contactEmail,
      contactPhone: contactPhone ?? null,
      contactType: type,
      trades: trades ?? [],
      notes: notes ?? null,
      paymentHold: false,
    });
    // Every subcontractor gets a real primary-contact `people` row (Feature:
    // person-first cards) so it's addressable everywhere a person is needed
    // (project team, portal invites, certifications) instead of a UI-only
    // pseudo-person derived from these subcontructors columns.
    await db.insert(peopleTable).values({
      id: personId,
      companyId: req.user!.companyId,
      subcontractorId: id,
      name: contactName,
      firstName,
      lastName,
      email: contactEmail,
      phone: contactPhone ?? null,
      isPrimaryContact: true,
    });

    res.status(201).json({ id, personId, companyId: req.user!.companyId, companyName, contactName, contactFirstName: firstName, contactLastName: lastName, contactEmail, contactPhone: contactPhone ?? null, contactType: type, trades: trades ?? [], reliabilityRating: null, paymentHold: false, notes: notes ?? null, archivedAt: null, insuranceStatus: "none", insuranceRecords: [], createdAt: new Date().toISOString() });
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
    const insurance = await db.select().from(insuranceRecordsTable)
      .where(and(eq(insuranceRecordsTable.subcontractorId, s.id), isNull(insuranceRecordsTable.archivedAt)));
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
      contactFirstName: s.contactFirstName ?? null,
      contactLastName: s.contactLastName ?? null,
      contactEmail: s.contactEmail,
      contactPhone: s.contactPhone ?? null,
      contactType: s.contactType ?? "subcontractor",
      trades: s.trades ?? [],
      reliabilityRating: s.reliabilityRating ? Number(s.reliabilityRating) : null,
      paymentHold: s.paymentHold,
      notes: s.notes ?? null,
      archivedAt: s.archivedAt ? s.archivedAt.toISOString() : null,
      insuranceStatus: computeInsuranceStatus(insurance),
      createdAt: s.createdAt.toISOString(),
      insuranceRecords: await serializeInsuranceRecords(insurance),
      assignedProjects: assignedProjects.filter(Boolean),
    });
  } catch (err) {
    req.log.error({ err }, "Get subcontractor error");
    res.status(500).json({ error: "server_error", message: "Failed to get subcontractor" });
  }
});

router.patch("/subcontractors/:subcontractorId", authenticate, async (req, res) => {
  try {
    const parsed = UpdateSubcontractorBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "validation_error", message: "Invalid update — a first name and surname must be at least 2 characters each." }); return; }
    const { companyName, contactFirstName, contactLastName, contactEmail, contactPhone, contactType, trades, reliabilityRating, paymentHold, notes } = parsed.data;
    // Name is stored as two parts + a derived display string; if only one of
    // first/last is given, require the other too so contactName never drifts
    // out of sync with the parts.
    if ((contactFirstName !== undefined) !== (contactLastName !== undefined)) {
      res.status(400).json({ error: "validation_error", message: "Provide both first name and surname together." });
      return;
    }
    const updates: Record<string, unknown> = {};
    if (companyName !== undefined) updates.companyName = companyName;
    if (contactFirstName !== undefined && contactLastName !== undefined) {
      const firstName = contactFirstName.trim();
      const lastName = contactLastName.trim();
      updates.contactFirstName = firstName;
      updates.contactLastName = lastName;
      updates.contactName = `${firstName} ${lastName}`.trim();
    }
    if (contactEmail !== undefined) updates.contactEmail = contactEmail;
    if (contactPhone !== undefined) updates.contactPhone = contactPhone;
    if (contactType !== undefined) updates.contactType = contactType;
    if (trades !== undefined) updates.trades = trades;
    if (reliabilityRating !== undefined) updates.reliabilityRating = reliabilityRating;
    if (paymentHold !== undefined) updates.paymentHold = paymentHold;
    if (notes !== undefined) updates.notes = notes;

    await db.update(subcontractorsTable).set(updates)
      .where(and(eq(subcontractorsTable.id, req.params.subcontractorId), eq(subcontractorsTable.companyId, req.user!.companyId)));

    // Mirror name/email/phone changes onto the linked primary-contact `people`
    // row so it never drifts from these subcontructors columns (Feature:
    // person-first cards — other pages still read subcontructors.contactName
    // etc. directly, this row is what the Team tab/portal read instead).
    const personUpdates: Record<string, unknown> = {};
    if (contactFirstName !== undefined && contactLastName !== undefined) {
      personUpdates.firstName = contactFirstName.trim();
      personUpdates.lastName = contactLastName.trim();
      personUpdates.name = `${contactFirstName.trim()} ${contactLastName.trim()}`.trim();
    }
    if (contactEmail !== undefined) personUpdates.email = contactEmail;
    if (contactPhone !== undefined) personUpdates.phone = contactPhone;
    if (Object.keys(personUpdates).length > 0) {
      await db.update(peopleTable).set(personUpdates)
        .where(and(eq(peopleTable.subcontractorId, req.params.subcontractorId), eq(peopleTable.isPrimaryContact, true)));
    }

    const subs = await db.select().from(subcontractorsTable)
      .where(and(eq(subcontractorsTable.id, req.params.subcontractorId), eq(subcontractorsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!subs[0]) {
      res.status(404).json({ error: "not_found", message: "Subcontractor not found" });
      return;
    }
    const s = subs[0];
    const insurance = await db.select().from(insuranceRecordsTable)
      .where(and(eq(insuranceRecordsTable.subcontractorId, s.id), isNull(insuranceRecordsTable.archivedAt)));

    res.json({ id: s.id, companyId: s.companyId, companyName: s.companyName, contactName: s.contactName, contactFirstName: s.contactFirstName ?? null, contactLastName: s.contactLastName ?? null, contactEmail: s.contactEmail, contactPhone: s.contactPhone ?? null, contactType: s.contactType ?? "subcontractor", trades: s.trades ?? [], reliabilityRating: s.reliabilityRating ? Number(s.reliabilityRating) : null, paymentHold: s.paymentHold, notes: s.notes ?? null, archivedAt: s.archivedAt ? s.archivedAt.toISOString() : null, insuranceStatus: computeInsuranceStatus(insurance), insuranceRecords: await serializeInsuranceRecords(insurance), createdAt: s.createdAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Update subcontractor error");
    res.status(500).json({ error: "server_error", message: "Failed to update subcontractor" });
  }
});

router.post("/subcontractors/:subcontractorId/insurance", authenticate, async (req, res) => {
  try {
    const { type, certificateUrl, expiryDate, assignedToUserId, dueDate } = req.body;
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
      assignedToUserId: assignedToUserId || null,
      dueDate: dueDate || null,
    });

    const inserted = await db.select().from(insuranceRecordsTable).where(eq(insuranceRecordsTable.id, id)).limit(1);
    res.status(201).json((await serializeInsuranceRecords(inserted))[0]);
  } catch (err) {
    req.log.error({ err }, "Add insurance error");
    res.status(500).json({ error: "server_error", message: "Failed to add insurance record" });
  }
});

// Edit / reassign an insurance record (assignee, due date, expiry, certificate).
// Tenant-scoped: the record's subcontractor must belong to the caller's company.
router.patch("/subcontractors/:subcontractorId/insurance/:recordId", authenticate, async (req, res) => {
  try {
    const sub = await db.select({ id: subcontractorsTable.id }).from(subcontractorsTable)
      .where(and(eq(subcontractorsTable.id, req.params.subcontractorId), eq(subcontractorsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!sub[0]) {
      res.status(404).json({ error: "not_found", message: "Subcontractor not found" });
      return;
    }

    const existing = await db.select().from(insuranceRecordsTable)
      .where(and(eq(insuranceRecordsTable.id, req.params.recordId), eq(insuranceRecordsTable.subcontractorId, req.params.subcontractorId)))
      .limit(1);
    if (!existing[0]) {
      res.status(404).json({ error: "not_found", message: "Insurance record not found" });
      return;
    }

    const { type, certificateUrl, expiryDate, assignedToUserId, dueDate } = req.body;
    const updates: Record<string, unknown> = {};
    if (type !== undefined) updates.type = type;
    if (certificateUrl !== undefined) updates.certificateUrl = certificateUrl;
    if (expiryDate !== undefined) { updates.expiryDate = expiryDate; updates.status = computeRecordStatus(expiryDate); }
    // null/"" clears the field; a value sets it; undefined leaves as-is.
    if (assignedToUserId !== undefined) updates.assignedToUserId = assignedToUserId || null;
    if (dueDate !== undefined) updates.dueDate = dueDate || null;

    await db.update(insuranceRecordsTable).set(updates).where(eq(insuranceRecordsTable.id, req.params.recordId));
    const updated = await db.select().from(insuranceRecordsTable).where(eq(insuranceRecordsTable.id, req.params.recordId)).limit(1);
    res.json((await serializeInsuranceRecords(updated))[0]);
  } catch (err) {
    req.log.error({ err }, "Update insurance error");
    res.status(500).json({ error: "server_error", message: "Failed to update insurance record" });
  }
});

// List timestamped notes for a subcontractor (most recent first)
// ?projectId=<id> → returns general notes + notes scoped to that project
// no projectId   → returns general notes only (contacts directory view)
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
      : isNull(subcontractorNotesTable.projectId);

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

// DELETE /api/subcontractors/:id — remove a subcontractor from the directory.
// Manager-gated + tenant-scoped. Blocked outright if the firm (or any of its
// people) is on an ACTIVE project. Otherwise: zero footprint anywhere (never
// on any project, no activity/distribution/sign-off history) → hard-delete,
// same cascade cleanup as before; any footprint → archive instead, so past
// records (which key off users.id, never touched here) keep resolving names.
router.delete("/subcontractors/:id", authenticate, async (req, res) => {
  try {
    if (!["admin", "project_manager"].includes(req.user!.role)) {
      res.status(403).json({ error: "forbidden", message: "Only an admin or project manager can delete a subcontractor." });
      return;
    }
    const sub = await db.select({ id: subcontractorsTable.id }).from(subcontractorsTable)
      .where(and(eq(subcontractorsTable.id, req.params.id), eq(subcontractorsTable.companyId, req.user!.companyId))).limit(1);
    if (!sub[0]) { res.status(404).json({ error: "not_found", message: "Subcontractor not found" }); return; }

    const activeProjects = await activeProjectsForSubcontractor(req.params.id);
    if (activeProjects.length > 0) {
      res.status(400).json({ error: "on_active_project", message: `Remove them from ${activeProjects.join(", ")} first.`, projects: activeProjects });
      return;
    }

    const people = await db.select({ id: peopleTable.id, userId: peopleTable.userId }).from(peopleTable)
      .where(eq(peopleTable.subcontractorId, req.params.id));
    const footprint = await hasAnyHistoricalFootprint({
      personIds: people.map(p => p.id),
      subcontractorId: req.params.id,
      userIds: people.map(p => p.userId).filter((x): x is string => !!x),
    });

    if (footprint) {
      await db.update(subcontractorsTable).set({ archivedAt: new Date() }).where(eq(subcontractorsTable.id, req.params.id));
      res.json({ success: true, archived: true });
      return;
    }

    await db.delete(insuranceRecordsTable).where(eq(insuranceRecordsTable.subcontractorId, req.params.id));
    await db.delete(subcontractorNotesTable).where(eq(subcontractorNotesTable.subcontractorId, req.params.id));
    await db.delete(subcontractorDocumentsTable).where(eq(subcontractorDocumentsTable.subcontractorId, req.params.id));
    await db.delete(projectMembersTable).where(eq(projectMembersTable.subcontractorId, req.params.id));
    await db.delete(peopleTable).where(eq(peopleTable.subcontractorId, req.params.id));
    await db.delete(subcontractorsTable).where(eq(subcontractorsTable.id, req.params.id));
    res.json({ success: true, archived: false });
  } catch (err) {
    req.log.error({ err }, "Delete subcontractor error");
    res.status(500).json({ error: "server_error", message: "Failed to delete subcontractor" });
  }
});

// PATCH /api/subcontractors/:id/restore — un-archive a previously archived
// subcontractor. Manager-gated + tenant-scoped.
router.patch("/subcontractors/:id/restore", authenticate, async (req, res) => {
  try {
    if (!["admin", "project_manager"].includes(req.user!.role)) {
      res.status(403).json({ error: "forbidden", message: "Only an admin or project manager can restore a subcontractor." });
      return;
    }
    const sub = await db.select({ id: subcontractorsTable.id }).from(subcontractorsTable)
      .where(and(eq(subcontractorsTable.id, req.params.id), eq(subcontractorsTable.companyId, req.user!.companyId))).limit(1);
    if (!sub[0]) { res.status(404).json({ error: "not_found", message: "Subcontractor not found" }); return; }
    await db.update(subcontractorsTable).set({ archivedAt: null }).where(eq(subcontractorsTable.id, req.params.id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Restore subcontractor error");
    res.status(500).json({ error: "server_error", message: "Failed to restore subcontractor" });
  }
});

export default router;
