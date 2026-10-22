import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { personCertificationsTable, peopleTable, subcontractorsTable } from "@workspace/db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";
import { allow, COMPANY_MANAGER, INTERNAL_STAFF } from "../lib/authz";
import { expiryStatus } from "../lib/expiry";
import { CreatePersonCertificationBody, ConfirmPersonCertificationTypeBody } from "@workspace/api-zod";
import { suggestCertType } from "../lib/insurance";

const router: IRouter = Router();

const MANAGER_ROLES = ["admin", "project_manager"];

function requireManager(req: import("express").Request, res: import("express").Response): boolean {
  if (!MANAGER_ROLES.includes(req.user!.role)) {
    res.status(403).json({ error: "forbidden", message: "Only an admin or project manager can manage certifications." });
    return false;
  }
  return true;
}

async function loadOwnedPerson(personId: string, companyId: string) {
  const rows = await db.select().from(peopleTable)
    .where(and(eq(peopleTable.id, personId), eq(peopleTable.companyId, companyId))).limit(1);
  return rows[0] ?? null;
}

function computeStatus(expiryDate: string): "valid" | "expiring_soon" | "expired" {
  const s = expiryStatus(expiryDate);
  return s === "active" ? "valid" : s;
}

type CertRow = typeof personCertificationsTable.$inferSelect;
function serialize(c: CertRow) {
  return {
    id: c.id,
    personId: c.personId,
    name: c.name,
    certNumber: c.certNumber ?? null,
    expiryDate: c.expiryDate,
    status: computeStatus(c.expiryDate),
    documentUrl: c.documentUrl ?? null,
    createdAt: c.createdAt.toISOString(),
    // Null = no manager has confirmed what this is: it never counts as
    // insurance at the gate (lib/insurance.ts). suggestedType is only a hint.
    certType: c.certType ?? null,
    suggestedType: c.certType ? null : suggestCertType(c.name),
  };
}

router.get("/people/:personId/certifications", authenticate, allow(INTERNAL_STAFF), async (req, res) => {
  try {
    const person = await loadOwnedPerson(req.params.personId, req.user!.companyId);
    if (!person) { res.status(404).json({ error: "not_found", message: "Person not found" }); return; }
    const certs = await db.select().from(personCertificationsTable)
      .where(and(eq(personCertificationsTable.personId, person.id), isNull(personCertificationsTable.archivedAt)))
      .orderBy(desc(personCertificationsTable.createdAt));
    res.json(certs.map(serialize));
  } catch (err) {
    req.log.error({ err }, "List person certifications error");
    res.status(500).json({ error: "server_error", message: "Failed to list certifications" });
  }
});

router.post("/people/:personId/certifications", authenticate, allow(COMPANY_MANAGER), async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    const person = await loadOwnedPerson(req.params.personId, req.user!.companyId);
    if (!person) { res.status(404).json({ error: "not_found", message: "Person not found" }); return; }

    const parsed = CreatePersonCertificationBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "validation_error", message: "Name, expiry date and type are required. Pick what the certificate is: public liability, employer's liability, other insurance, or a qualification or card." }); return; }
    const { name, certNumber, expiryDate, documentUrl, certType } = parsed.data;

    // Auto-archive a prior non-archived cert of the same name for this person
    // (renewal), same convention as insurance_records/permits (Feature #47).
    await db.update(personCertificationsTable)
      .set({ archivedAt: new Date() })
      .where(and(
        eq(personCertificationsTable.personId, person.id),
        eq(personCertificationsTable.name, name),
        isNull(personCertificationsTable.archivedAt),
      ));

    const id = generateId();
    await db.insert(personCertificationsTable).values({
      id,
      personId: person.id,
      name,
      certNumber: certNumber ?? null,
      expiryDate,
      documentUrl: documentUrl ?? null,
      createdBy: req.user!.id,
      // A manager picked the type while adding it: confirmed.
      certType, typeConfirmedAt: new Date(), typeConfirmedBy: req.user!.id,
    });
    const inserted = await db.select().from(personCertificationsTable).where(eq(personCertificationsTable.id, id)).limit(1);
    res.status(201).json(serialize(inserted[0]));
  } catch (err) {
    req.log.error({ err }, "Create person certification error");
    res.status(500).json({ error: "server_error", message: "Failed to add certification" });
  }
});

// PATCH /api/people/:personId/certifications/:certId/type: a manager says what
// a certificate is (or confirms the suggestion). Only this makes a
// certificate count as insurance at the gate.
router.patch("/people/:personId/certifications/:certId/type", authenticate, allow(COMPANY_MANAGER), async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    const person = await loadOwnedPerson(req.params.personId, req.user!.companyId);
    if (!person) { res.status(404).json({ error: "not_found", message: "Person not found" }); return; }
    const parsed = ConfirmPersonCertificationTypeBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "validation_error", message: "Pick what the certificate is." }); return; }
    const [updated] = await db.update(personCertificationsTable)
      .set({ certType: parsed.data.certType, typeConfirmedAt: new Date(), typeConfirmedBy: req.user!.id })
      .where(and(eq(personCertificationsTable.id, req.params.certId), eq(personCertificationsTable.personId, person.id)))
      .returning();
    if (!updated) { res.status(404).json({ error: "not_found", message: "Certification not found" }); return; }
    res.json(serialize(updated));
  } catch (err) {
    req.log.error({ err }, "Confirm certification type error");
    res.status(500).json({ error: "server_error", message: "Failed to save the type" });
  }
});

// GET /api/certifications/unconfirmed: this company's certificates nobody has
// typed yet (they don't count at the gate), each with a suggestion.
router.get("/certifications/unconfirmed", authenticate, allow(COMPANY_MANAGER), async (req, res) => {
  try {
    const rows = await db.select({
      id: personCertificationsTable.id, personId: personCertificationsTable.personId, personName: peopleTable.name,
      firm: subcontractorsTable.companyName, name: personCertificationsTable.name, expiryDate: personCertificationsTable.expiryDate,
      documentUrl: personCertificationsTable.documentUrl,
    }).from(personCertificationsTable)
      .innerJoin(peopleTable, eq(peopleTable.id, personCertificationsTable.personId))
      .leftJoin(subcontractorsTable, eq(subcontractorsTable.id, peopleTable.subcontractorId))
      .where(and(eq(peopleTable.companyId, req.user!.companyId), isNull(personCertificationsTable.archivedAt),
        isNull(personCertificationsTable.certType), isNull(peopleTable.archivedAt)))
      .orderBy(desc(personCertificationsTable.createdAt));
    res.json(rows.map(r => ({ ...r, firm: r.firm ?? null, documentUrl: r.documentUrl ?? null, suggestedType: suggestCertType(r.name) })));
  } catch (err) {
    req.log.error({ err }, "List unconfirmed certifications error");
    res.status(500).json({ error: "server_error", message: "Failed to list certificates" });
  }
});

router.delete("/people/:personId/certifications/:certId", authenticate, allow(COMPANY_MANAGER), async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    const person = await loadOwnedPerson(req.params.personId, req.user!.companyId);
    if (!person) { res.status(404).json({ error: "not_found", message: "Person not found" }); return; }

    const existing = await db.select().from(personCertificationsTable)
      .where(and(eq(personCertificationsTable.id, req.params.certId), eq(personCertificationsTable.personId, person.id))).limit(1);
    if (!existing[0]) { res.status(404).json({ error: "not_found", message: "Certification not found" }); return; }

    await db.delete(personCertificationsTable).where(eq(personCertificationsTable.id, req.params.certId));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete person certification error");
    res.status(500).json({ error: "server_error", message: "Failed to delete certification" });
  }
});

export default router;
