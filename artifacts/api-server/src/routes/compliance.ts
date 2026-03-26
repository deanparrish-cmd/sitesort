import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { insuranceRecordsTable, subcontractorsTable, permitsTable, projectsTable, documentDistributionsTable, documentsTable } from "@workspace/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { authenticate } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/compliance", authenticate, async (req, res) => {
  try {
    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const mySubs = await db.select().from(subcontractorsTable).where(eq(subcontractorsTable.companyId, req.user!.companyId));
    const subIds = mySubs.map(s => s.id);

    let expiringInsurance: Array<{
      subcontractorId: string;
      subcontractorName: string;
      insuranceType: string;
      expiryDate: string;
      status: string;
    }> = [];

    if (subIds.length > 0) {
      const allInsurance = await db.select().from(insuranceRecordsTable).where(inArray(insuranceRecordsTable.subcontractorId, subIds));
      for (const ins of allInsurance) {
        const expiry = new Date(ins.expiryDate);
        if (expiry <= in30Days) {
          const sub = mySubs.find(s => s.id === ins.subcontractorId);
          expiringInsurance.push({
            subcontractorId: ins.subcontractorId,
            subcontractorName: sub?.companyName ?? "Unknown",
            insuranceType: ins.type,
            expiryDate: ins.expiryDate,
            status: ins.status,
          });
        }
      }
    }

    const myProjects = await db.select().from(projectsTable).where(eq(projectsTable.companyId, req.user!.companyId));
    const projectIds = myProjects.map(p => p.id);

    let expiringPermits: Array<{
      permitId: string;
      projectId: string;
      projectName: string;
      permitType: string;
      expiryDate: string;
      status: string;
    }> = [];

    let pendingAcknowledgments: Array<{
      documentId: string;
      documentName: string;
      projectId: string;
      projectName: string;
      pendingCount: number;
    }> = [];

    if (projectIds.length > 0) {
      const allPermits = await db.select().from(permitsTable).where(inArray(permitsTable.projectId, projectIds));
      for (const permit of allPermits) {
        const expiry = new Date(permit.expiryDate);
        const proj = myProjects.find(p => p.id === permit.projectId);
        let status: string;
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const expiryDay = new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate());
        if (expiryDay < today) status = "expired";
        else if (expiryDay <= new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)) status = "expiring_today";
        else status = "active";

        if (expiry <= in7Days) {
          expiringPermits.push({
            permitId: permit.id,
            projectId: permit.projectId,
            projectName: proj?.name ?? "Unknown",
            permitType: permit.type,
            expiryDate: permit.expiryDate,
            status,
          });
        }
      }

      const allDocs = await db.select().from(documentsTable).where(and(inArray(documentsTable.projectId, projectIds), eq(documentsTable.status, "current")));
      for (const doc of allDocs) {
        const pending = await db.select().from(documentDistributionsTable)
          .where(and(eq(documentDistributionsTable.documentId, doc.id), eq(documentDistributionsTable.status, "pending")));
        if (pending.length > 0) {
          const proj = myProjects.find(p => p.id === doc.projectId);
          pendingAcknowledgments.push({
            documentId: doc.id,
            documentName: doc.name,
            projectId: doc.projectId,
            projectName: proj?.name ?? "Unknown",
            pendingCount: pending.length,
          });
        }
      }
    }

    res.json({ expiringInsurance, expiringPermits, pendingAcknowledgments });
  } catch (err) {
    req.log.error({ err }, "Compliance overview error");
    res.status(500).json({ error: "server_error", message: "Failed to get compliance overview" });
  }
});

export default router;
