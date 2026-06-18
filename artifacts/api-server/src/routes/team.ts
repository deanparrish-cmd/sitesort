import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectMembersTable, usersTable, subcontractorsTable, insuranceRecordsTable, projectsTable } from "@workspace/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";

const router: IRouter = Router();

function computeRecordStatus(expiryDate: string): "valid" | "expiring_soon" | "expired" {
  const expiry = new Date(expiryDate);
  const now = new Date();
  const daysUntilExpiry = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysUntilExpiry < 0) return "expired";
  if (daysUntilExpiry <= 30) return "expiring_soon";
  return "valid";
}

function getInsuranceStatus(records: Array<{ expiryDate: string }>): string {
  if (records.length === 0) return "none";
  const statuses = records.map(r => computeRecordStatus(r.expiryDate));
  if (statuses.some(s => s === "expired")) return "hold";
  if (statuses.some(s => s === "expiring_soon")) return "warning";
  return "ok";
}

router.get("/projects/:projectId/members", authenticate, async (req, res) => {
  try {
    const project = await db.select().from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    const members = await db.select().from(projectMembersTable).where(eq(projectMembersTable.projectId, req.params.projectId));

    const result = await Promise.all(members.map(async (m) => {
      let name = "Unknown";
      let complianceStatus: string = "ok";
      let email: string | null = null;
      let phone: string | null = null;
      let contactName: string | null = null;
      let trades: string[] = [];
      let avatarUrl: string | null = null;
      let pliCertUrl: string | null = null;
      let pliExpiryDate: string | null = null;

      if (m.userId) {
        const userRows = await db.select({ name: usersTable.name, email: usersTable.email, phone: usersTable.phone, avatarUrl: usersTable.avatarUrl }).from(usersTable).where(eq(usersTable.id, m.userId)).limit(1);
        name = userRows[0]?.name ?? "Unknown";
        email = userRows[0]?.email ?? null;
        phone = userRows[0]?.phone ?? null;
        avatarUrl = userRows[0]?.avatarUrl ?? null;
      } else if (m.subcontractorId) {
        const subRows = await db.select({
          companyName: subcontractorsTable.companyName,
          contactName: subcontractorsTable.contactName,
          contactEmail: subcontractorsTable.contactEmail,
          contactPhone: subcontractorsTable.contactPhone,
          trades: subcontractorsTable.trades,
          paymentHold: subcontractorsTable.paymentHold,
          avatarUrl: subcontractorsTable.avatarUrl,
        }).from(subcontractorsTable).where(eq(subcontractorsTable.id, m.subcontractorId)).limit(1);
        name = subRows[0]?.companyName ?? "Unknown";
        contactName = subRows[0]?.contactName ?? null;
        email = subRows[0]?.contactEmail ?? null;
        phone = subRows[0]?.contactPhone ?? null;
        trades = subRows[0]?.trades ?? [];
        avatarUrl = subRows[0]?.avatarUrl ?? null;
        if (subRows[0]?.paymentHold) {
          complianceStatus = "hold";
        } else {
          const insuranceRows = await db.select({ expiryDate: insuranceRecordsTable.expiryDate }).from(insuranceRecordsTable).where(and(eq(insuranceRecordsTable.subcontractorId, m.subcontractorId), isNull(insuranceRecordsTable.archivedAt)));
          complianceStatus = getInsuranceStatus(insuranceRows);
        }
        const pliRows = await db.select({ certificateUrl: insuranceRecordsTable.certificateUrl, expiryDate: insuranceRecordsTable.expiryDate })
          .from(insuranceRecordsTable)
          .where(and(eq(insuranceRecordsTable.subcontractorId, m.subcontractorId), eq(insuranceRecordsTable.type, "public_liability"), isNull(insuranceRecordsTable.archivedAt)))
          .limit(1);
        pliCertUrl = pliRows[0]?.certificateUrl ?? null;
        pliExpiryDate = pliRows[0]?.expiryDate ?? null;
      }

      return {
        id: m.id,
        projectId: m.projectId,
        userId: m.userId ?? null,
        subcontractorId: m.subcontractorId ?? null,
        name,
        contactName,
        email,
        phone,
        trades,
        avatarUrl,
        pliCertUrl,
        pliExpiryDate,
        role: m.role,
        complianceStatus,
        scheduledDays: m.scheduledDays ?? [],
        siteStartTime: m.siteStartTime ?? null,
        siteEndTime: m.siteEndTime ?? null,
        addedAt: m.addedAt.toISOString(),
      };
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "List members error");
    res.status(500).json({ error: "server_error", message: "Failed to list members" });
  }
});

router.post("/projects/:projectId/members", authenticate, async (req, res) => {
  try {
    const { userId, subcontractorId, role } = req.body;
    if (!role) {
      res.status(400).json({ error: "validation_error", message: "role is required" });
      return;
    }

    const project = await db.select().from(projectsTable)
      .where(and(eq(projectsTable.id, req.params.projectId), eq(projectsTable.companyId, req.user!.companyId)))
      .limit(1);
    if (!project[0]) {
      res.status(404).json({ error: "not_found", message: "Project not found" });
      return;
    }

    if (userId) {
      const existing = await db.select().from(projectMembersTable)
        .where(and(eq(projectMembersTable.projectId, req.params.projectId), eq(projectMembersTable.userId, userId)))
        .limit(1);
      if (existing.length > 0) {
        res.status(409).json({ error: "conflict", message: "User is already a member of this project" });
        return;
      }
    } else if (subcontractorId) {
      const existing = await db.select().from(projectMembersTable)
        .where(and(eq(projectMembersTable.projectId, req.params.projectId), eq(projectMembersTable.subcontractorId, subcontractorId)))
        .limit(1);
      if (existing.length > 0) {
        res.status(409).json({ error: "conflict", message: "Subcontractor is already a member of this project" });
        return;
      }
    }

    const id = generateId();
    await db.insert(projectMembersTable).values({
      id,
      projectId: req.params.projectId,
      userId: userId ?? null,
      subcontractorId: subcontractorId ?? null,
      role,
    });

    let name = "Unknown";
    if (userId) {
      const userRows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      name = userRows[0]?.name ?? "Unknown";
    } else if (subcontractorId) {
      const subRows = await db.select({ companyName: subcontractorsTable.companyName }).from(subcontractorsTable).where(eq(subcontractorsTable.id, subcontractorId)).limit(1);
      name = subRows[0]?.companyName ?? "Unknown";
    }

    res.status(201).json({ id, projectId: req.params.projectId, userId: userId ?? null, subcontractorId: subcontractorId ?? null, name, role, complianceStatus: "ok", addedAt: new Date().toISOString() });
  } catch (err) {
    req.log.error({ err }, "Add member error");
    res.status(500).json({ error: "server_error", message: "Failed to add member" });
  }
});

router.post("/projects/:projectId/members/:memberId/insurance-cert", authenticate, async (req, res) => {
  try {
    const { certificateUrl, expiryDate } = req.body;
    if (!certificateUrl || !expiryDate) {
      res.status(400).json({ error: "validation_error", message: "certificateUrl and expiryDate are required" }); return;
    }
    const memberRows = await db.select().from(projectMembersTable)
      .where(and(eq(projectMembersTable.id, req.params.memberId), eq(projectMembersTable.projectId, req.params.projectId)))
      .limit(1);
    if (!memberRows.length || !memberRows[0].subcontractorId) {
      res.status(404).json({ error: "not_found", message: "Subcontractor member not found" }); return;
    }
    const subId = memberRows[0].subcontractorId;
    // Upsert: update existing PLI record or insert new one
    const existing = await db.select().from(insuranceRecordsTable)
      .where(and(eq(insuranceRecordsTable.subcontractorId, subId), eq(insuranceRecordsTable.type, "public_liability")))
      .limit(1);
    if (existing.length) {
      await db.update(insuranceRecordsTable)
        .set({ certificateUrl, expiryDate, status: "valid" })
        .where(eq(insuranceRecordsTable.id, existing[0].id));
    } else {
      await db.insert(insuranceRecordsTable).values({
        id: generateId(), subcontractorId: subId, type: "public_liability",
        certificateUrl, expiryDate, status: "valid",
      });
    }
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Insurance cert error");
    res.status(500).json({ error: "server_error", message: "Failed to save certificate" });
  }
});

router.patch("/projects/:projectId/members/:memberId/contact", authenticate, async (req, res) => {
  try {
    const { phone } = req.body;
    const memberRows = await db.select().from(projectMembersTable)
      .where(and(eq(projectMembersTable.id, req.params.memberId), eq(projectMembersTable.projectId, req.params.projectId)))
      .limit(1);
    if (!memberRows.length) { res.status(404).json({ error: "not_found", message: "Member not found" }); return; }
    const m = memberRows[0];
    if (m.userId) {
      await db.update(usersTable).set({ phone: phone || null }).where(eq(usersTable.id, m.userId));
    } else if (m.subcontractorId) {
      await db.update(subcontractorsTable).set({ contactPhone: phone || null }).where(eq(subcontractorsTable.id, m.subcontractorId));
    }
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Update contact error");
    res.status(500).json({ error: "server_error", message: "Failed to update contact" });
  }
});

router.patch("/projects/:projectId/members/:memberId/avatar", authenticate, async (req, res) => {
  try {
    const { avatarUrl } = req.body;
    if (!avatarUrl) { res.status(400).json({ error: "validation_error", message: "avatarUrl required" }); return; }

    const memberRows = await db.select().from(projectMembersTable)
      .where(and(eq(projectMembersTable.id, req.params.memberId), eq(projectMembersTable.projectId, req.params.projectId)))
      .limit(1);
    if (!memberRows.length) { res.status(404).json({ error: "not_found", message: "Member not found" }); return; }

    const m = memberRows[0];
    if (m.userId) {
      await db.update(usersTable).set({ avatarUrl }).where(eq(usersTable.id, m.userId));
    } else if (m.subcontractorId) {
      await db.update(subcontractorsTable).set({ avatarUrl }).where(eq(subcontractorsTable.id, m.subcontractorId));
    }
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Update avatar error");
    res.status(500).json({ error: "server_error", message: "Failed to update avatar" });
  }
});

router.patch("/projects/:projectId/members/:memberId/schedule", authenticate, async (req, res) => {
  try {
    const { scheduledDays, siteStartTime, siteEndTime } = req.body;
    await db.update(projectMembersTable)
      .set({
        scheduledDays: scheduledDays ?? [],
        siteStartTime: siteStartTime || null,
        siteEndTime: siteEndTime || null,
      })
      .where(and(eq(projectMembersTable.id, req.params.memberId), eq(projectMembersTable.projectId, req.params.projectId)));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Update member schedule error");
    res.status(500).json({ error: "server_error", message: "Failed to update schedule" });
  }
});

router.delete("/projects/:projectId/members/:memberId", authenticate, async (req, res) => {
  try {
    await db.delete(projectMembersTable).where(and(eq(projectMembersTable.id, req.params.memberId), eq(projectMembersTable.projectId, req.params.projectId)));
    res.json({ success: true, message: "Member removed" });
  } catch (err) {
    req.log.error({ err }, "Remove member error");
    res.status(500).json({ error: "server_error", message: "Failed to remove member" });
  }
});

export default router;
