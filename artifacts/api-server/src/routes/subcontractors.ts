import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { subcontractorsTable, insuranceRecordsTable, projectMembersTable, projectsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
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
        trades: s.trades ?? [],
        reliabilityRating: s.reliabilityRating ? Number(s.reliabilityRating) : null,
        paymentHold: s.paymentHold,
        insuranceStatus: computeInsuranceStatus(insurance),
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
    const { companyName, contactName, contactEmail, contactPhone, trades } = req.body;
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
      trades: trades ?? [],
      paymentHold: false,
    });

    res.status(201).json({ id, companyId: req.user!.companyId, companyName, contactName, contactEmail, contactPhone: contactPhone ?? null, trades: trades ?? [], reliabilityRating: null, paymentHold: false, insuranceStatus: "none", createdAt: new Date().toISOString() });
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
      trades: s.trades ?? [],
      reliabilityRating: s.reliabilityRating ? Number(s.reliabilityRating) : null,
      paymentHold: s.paymentHold,
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
    const { companyName, contactName, contactEmail, contactPhone, trades, reliabilityRating, paymentHold } = req.body;
    const updates: Record<string, unknown> = {};
    if (companyName !== undefined) updates.companyName = companyName;
    if (contactName !== undefined) updates.contactName = contactName;
    if (contactEmail !== undefined) updates.contactEmail = contactEmail;
    if (contactPhone !== undefined) updates.contactPhone = contactPhone;
    if (trades !== undefined) updates.trades = trades;
    if (reliabilityRating !== undefined) updates.reliabilityRating = reliabilityRating;
    if (paymentHold !== undefined) updates.paymentHold = paymentHold;

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

    res.json({ id: s.id, companyId: s.companyId, companyName: s.companyName, contactName: s.contactName, contactEmail: s.contactEmail, contactPhone: s.contactPhone ?? null, trades: s.trades ?? [], reliabilityRating: s.reliabilityRating ? Number(s.reliabilityRating) : null, paymentHold: s.paymentHold, insuranceStatus: computeInsuranceStatus(insurance), createdAt: s.createdAt.toISOString() });
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

export default router;
