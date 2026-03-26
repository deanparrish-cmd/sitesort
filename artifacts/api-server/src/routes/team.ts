import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectMembersTable, usersTable, subcontractorsTable, insuranceRecordsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { generateId } from "../lib/id";
import { authenticate } from "../middlewares/auth";

const router: IRouter = Router();

function getInsuranceStatus(records: Array<{ status: string }>): string {
  if (records.length === 0) return "none";
  if (records.some(r => r.status === "expired")) return "hold";
  if (records.some(r => r.status === "expiring_soon")) return "warning";
  return "ok";
}

router.get("/projects/:projectId/members", authenticate, async (req, res) => {
  try {
    const members = await db.select().from(projectMembersTable).where(eq(projectMembersTable.projectId, req.params.projectId));

    const result = await Promise.all(members.map(async (m) => {
      let name = "Unknown";
      let complianceStatus: string = "ok";

      if (m.userId) {
        const userRows = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, m.userId)).limit(1);
        name = userRows[0]?.name ?? "Unknown";
      } else if (m.subcontractorId) {
        const subRows = await db.select({ companyName: subcontractorsTable.companyName, paymentHold: subcontractorsTable.paymentHold }).from(subcontractorsTable).where(eq(subcontractorsTable.id, m.subcontractorId)).limit(1);
        name = subRows[0]?.companyName ?? "Unknown";
        if (subRows[0]?.paymentHold) {
          complianceStatus = "hold";
        } else {
          const insuranceRows = await db.select({ status: insuranceRecordsTable.status }).from(insuranceRecordsTable).where(eq(insuranceRecordsTable.subcontractorId, m.subcontractorId));
          complianceStatus = getInsuranceStatus(insuranceRows);
        }
      }

      return {
        id: m.id,
        projectId: m.projectId,
        userId: m.userId ?? null,
        subcontractorId: m.subcontractorId ?? null,
        name,
        role: m.role,
        complianceStatus,
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
