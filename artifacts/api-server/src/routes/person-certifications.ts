import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { personCertificationsTable, peopleTable } from "@workspace/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";
import { expiryStatus } from "../lib/expiry";
import { CreatePersonCertificationBody } from "@workspace/api-zod";

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
  };
}

router.get("/people/:personId/certifications", authenticate, async (req, res) => {
  try {
    const person = await loadOwnedPerson(req.params.personId, req.user!.companyId);
    if (!person) { res.status(404).json({ error: "not_found", message: "Person not found" }); return; }
    const certs = await db.select().from(personCertificationsTable)
      .where(and(eq(personCertificationsTable.personId, person.id), isNull(personCertificationsTable.archivedAt)));
    res.json(certs.map(serialize));
  } catch (err) {
    req.log.error({ err }, "List person certifications error");
    res.status(500).json({ error: "server_error", message: "Failed to list certifications" });
  }
});

router.post("/people/:personId/certifications", authenticate, async (req, res) => {
  try {
    if (!requireManager(req, res)) return;
    const person = await loadOwnedPerson(req.params.personId, req.user!.companyId);
    if (!person) { res.status(404).json({ error: "not_found", message: "Person not found" }); return; }

    const parsed = CreatePersonCertificationBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "validation_error", message: "name and expiryDate are required" }); return; }
    const { name, certNumber, expiryDate, documentUrl } = parsed.data;

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
    });
    const inserted = await db.select().from(personCertificationsTable).where(eq(personCertificationsTable.id, id)).limit(1);
    res.status(201).json(serialize(inserted[0]));
  } catch (err) {
    req.log.error({ err }, "Create person certification error");
    res.status(500).json({ error: "server_error", message: "Failed to add certification" });
  }
});

router.delete("/people/:personId/certifications/:certId", authenticate, async (req, res) => {
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
